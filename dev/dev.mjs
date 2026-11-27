/**
 * Standalone dev page: renders dev/sample-scene.json with the same renderer, toolbar and pointer
 * interaction the module uses inside Foundry. Map, tile and token art are generated on a canvas
 * so the repo carries no images. The page plays the Foundry side: it owns the documents, answers
 * the interaction callbacks and computes fog with the pure line-of-sight code.
 *
 * URL params: ?topdown=1  ?player=1  ?az=<deg>  ?paint=1  ?cutaway=1  ?select=<tokenId>  ?selftest=1
 *             ?walls=map|texture|flat
 */
import * as THREE from "../vendor/three/three.module.js";
import { View3D } from "../scripts/render/view3d.mjs";
import { createHud } from "../scripts/ui/hud.mjs";
import { createInteraction } from "../scripts/ui/interact.mjs";
import { modelFromJSON } from "../scripts/core/scene-model.mjs";
import { getHeight } from "../scripts/core/heights.mjs";
import { drawDungeon, drawToken, drawBalcony, drawRug, drawRoof, drawBricks, drawPlanks } from "./art.mjs";
import { losVisibilityTest, visibleCells, fogStates, FOG } from "../scripts/core/vision.mjs";
import { gridSquares, DIAGONALS, formatDistance } from "../scripts/core/scene-extras.mjs";
import { canvasToWorld, canvasToCell, tokenCenter } from "../scripts/core/coords.mjs";

const params = new URLSearchParams(location.search);
const [json, lang] = await Promise.all([
  fetch("./sample-scene.json").then((r) => r.json()),
  fetch("../lang/en.json").then((r) => r.json()),
]);
const t = (k) => lang[k] ?? k;

const model = modelFromJSON(json);
const art = {
  "gen:dungeon": () => drawDungeon(model),
  "gen:balcony": () => drawBalcony(model),
  "gen:rug": () => drawRug(),
  "gen:roof": () => drawRoof(),
};
const groundArt = art["gen:dungeon"]();
model.background.src = groundArt;
for (const lv of model.levels) lv.background.src = lv.background.src === "gen:dungeon" ? groundArt : art[lv.background.src]?.() ?? null;
for (const tile of model.tiles) tile.src = art[tile.src]?.() ?? null;
for (const tok of model.tokens) tok.src = drawToken(tok);

const overlay = document.getElementById("f3d-overlay");
let playerView = params.has("player");
const wallArt = { "gen:brick": drawBricks(), "gen:planks": drawPlanks() };
const wallMode = params.get("walls") ?? "map";
const view = new View3D(overlay.querySelector(".f3d-viewport"), {
  isGM: !playerView,
  preserveDrawingBuffer: true,
  wallMode,
  wallTexture: "gen:brick",
  doorTexture: wallMode === "texture" ? "gen:planks" : "",
  resolveSrc: (src) => wallArt[src] ?? src,
});
await view.load(model);

/* --- the "Foundry" side ---------------------------------------------------------------------- */

const controlled = new Set();
let explored = null;
const isFriendly = (tok) => tok?.disposition === 1;

/** Vision: friendly tokens see by line of sight; in the dark only within 12 squares. */
function computeFog() {
  const g = model.grid;
  const sources = model.tokens.filter(isFriendly).map((tok) => {
    const c = tokenCenter(g, tok);
    return { x: c.x, y: c.y, radius: model.darkness > 0.5 ? 12 * g.size : Infinity };
  });
  const test = losVisibilityTest(sources, model.walls.filter((w) => (w.levelIndex ?? 0) === 0), g);
  const fog = fogStates(explored, visibleCells(g, test));
  explored = fog.explored;
  return fog.states;
}

function refreshVisibility() {
  const g = model.grid;
  const states = playerView ? computeFog() : null;
  view.setFog(states);
  for (const tok of model.tokens) {
    let visible = true;
    if (playerView) {
      const cell = canvasToCell(g, tok.x + g.size / 2, tok.y + g.size / 2);
      const seen = cell && states[cell.row * g.cols + cell.col] === FOG.VISIBLE;
      visible = !tok.hidden && (isFriendly(tok) || seen);
    }
    view.setTokenVisibility(tok.id, visible, !playerView && tok.hidden);
    view.setTokenSelected(tok.id, controlled.has(tok.id));
  }
  const focus = model.tokens.filter((tok) => (playerView ? isFriendly(tok) : controlled.has(tok.id)));
  view.setRoofFocus(focus.map((tok) => tokenCenter(g, tok)));
  document.getElementById("dev-status").textContent = playerView ? "Viewing as player (fog on)" : "Viewing as GM";
}

function setPlayerView(on) {
  playerView = on;
  view.options.isGM = !on;
  for (const w of model.walls) view.upsertWall({ ...w });
  refreshVisibility();
}

function moveToken(id, cell) {
  const tok = model.tokens.find((tk) => tk.id === id);
  tok.x = model.grid.sceneX + cell.col * model.grid.size;
  tok.y = model.grid.sceneY + cell.row * model.grid.size;
  view.moveToken(id, { x: tok.x, y: tok.y });
  refreshVisibility();
}

function toggleDoor(id) {
  const door = model.walls.find((w) => w.id === id);
  if (!door || !door.door) return;
  if (door.ds === 2 && playerView) return; // locked
  door.ds = door.ds === 1 ? 0 : 1;
  view.upsertWall({ ...door });
  refreshVisibility();
}

refreshVisibility();

const hud = createHud(overlay, {
  view,
  t,
  isGM: true,
  step: 2.5,
  unitLabel: "ft",
  levels: model.levels,
  initial: { cutaway: params.has("cutaway"), showRoofs: true },
  getWalls: () => model.walls.filter((w) => (w.levelIndex ?? 0) === 0),
  onHeightsChanged: (h) => (model.heights = h),
});

const interaction = createInteraction(view, {
  isBusy: () => hud.state.painting,
  getControlled: () => [...controlled],
  canControl: (id) => !playerView || isFriendly(model.tokens.find((tk) => tk.id === id)),
  onSelectToken: (id, additive) => {
    if (!additive) controlled.clear();
    controlled.add(id);
    refreshVisibility();
  },
  onReleaseAll: () => {
    controlled.clear();
    refreshVisibility();
  },
  onMoveToken: moveToken,
  onToggleDoor: toggleDoor,
  measure: (a, b) => {
    const dh = getHeight(model.heights, b.col, b.row) - getHeight(model.heights, a.col, a.row);
    return formatDistance(gridSquares(a, b, DIAGONALS.ALTERNATING_1), model.grid.distance, "ft", dh);
  },
});

if (params.has("az")) view.rotateBy(Number(params.get("az")));
if (params.has("topdown")) hud.button("topDown").click();
if (params.has("paint")) hud.button("painting").click();
if (params.has("select")) {
  controlled.add(params.get("select"));
  refreshVisibility();
}
if (params.has("hover")) {
  // Screenshot helper: show the ruler from the selected token to a cell, e.g. ?select=hero&hover=8,7
  const [col, row] = params.get("hover").split(",").map(Number);
  const id = [...controlled][0];
  const tok = model.tokens.find((tk) => tk.id === id);
  if (tok) {
    const from = canvasToCell(model.grid, tok.x + 1, tok.y + 1);
    const { lineCells } = await import("../scripts/core/scene-extras.mjs");
    view.highlightCell({ col, row });
    view.showRuler(lineCells(from, { col, row }), formatDistance(gridSquares(from, { col, row }, DIAGONALS.ALTERNATING_1), 5, "ft"));
  }
}

/* --- dev panel (simulated hooks) ------------------------------------------------------------- */
document.getElementById("dev-door").addEventListener("click", () => toggleDoor("w15"));
let heroStep = 0;
document.getElementById("dev-move").addEventListener("click", () => {
  const path = [[6, 5], [7, 6], [8, 5], [5, 5]];
  const [col, row] = path[heroStep++ % path.length];
  moveToken("hero", { col, row });
});
document.getElementById("dev-player").addEventListener("click", () => setPlayerView(!playerView));
const WALL_MODES_CYCLE = ["map", "texture", "flat"];
document.getElementById("dev-walls").addEventListener("click", () => {
  const next = WALL_MODES_CYCLE[(WALL_MODES_CYCLE.indexOf(view.options.wallMode) + 1) % 3];
  view.setWallStyle({ wallMode: next, doorTexture: next === "texture" ? "gen:planks" : "" });
  document.getElementById("dev-status").textContent = `Walls: ${next}`;
});
document.getElementById("dev-dark").addEventListener("click", () => {
  model.darkness = model.darkness > 0.5 ? 0 : 0.8;
  view.setLights(model.lights, model.darkness);
  refreshVisibility();
});

window.__f3d = { view, model, hud, interaction, controlled };

/* --- self test ------------------------------------------------------------------------------- */
if (params.has("selftest")) {
  runSelfTest()
    .catch((e) => ({ error: String(e && e.stack || e) }))
    .then((results) => {
      document.body.dataset.selftest = JSON.stringify(results);
      document.getElementById("dev-status").textContent = "selftest " + JSON.stringify(results);
    });
}

/** Exercises live updates and pointer interaction the way a user would (synthetic clicks). */
async function runSelfTest() {
  const r = {};
  // Step the render loop by hand (headless rAF timing is unreliable) - 33 ms per frame.
  const frames = async (n = 30) => {
    for (let i = 0; i < n; i++) view._loop(view._last + 33);
  };
  const canvas = view.renderer.domElement;
  canvas.setPointerCapture = canvas.releasePointerCapture = () => {}; // synthetic events have no real pointer
  const screenOf = (v) => {
    view.camera.updateMatrixWorld();
    const p = v.clone().project(view.camera);
    const b = canvas.getBoundingClientRect();
    return { x: b.left + ((p.x + 1) / 2) * b.width, y: b.top + ((1 - p.y) / 2) * b.height };
  };
  const pointer = (type, { x, y }, button = 0) => canvas.dispatchEvent(new PointerEvent(type, {
    clientX: x, clientY: y, button, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true,
  }));
  const click = (pt, button = 0) => {
    pointer("pointerdown", pt, button);
    pointer("pointerup", pt, button);
  };
  const cellScreen = (col, row) => {
    const g = model.grid;
    const w = canvasToWorld(g, g.sceneX + (col + 0.5) * g.size, g.sceneY + (row + 0.5) * g.size);
    return screenOf(new THREE.Vector3(w.x, getHeight(model.heights, col, row) / g.distance, w.z));
  };

  // 1. door via hook
  const before = view.walls.get("w15").door.target;
  toggleDoor("w15");
  r.doorSwingsOnUpdate = Math.abs(view.walls.get("w15").door.target - before - Math.PI / 2) < 1e-6;
  toggleDoor("w15");

  // 2. select the hero by clicking its standee, move it by clicking a square, ruler on hover
  hud.button("topDown").click();
  await frames(30);
  const hero = view.tokens.get("hero");
  const heroPt = screenOf(hero.group.position.clone().add(new THREE.Vector3(0, 0.1, 0)));
  click(heroPt);
  r.clickSelectsToken = controlled.has("hero") && hero.ring.visible;
  click(cellScreen(7, 7));
  r.clickMovesToken = model.tokens.find((tk) => tk.id === "hero").x === model.grid.sceneX + 7 * model.grid.size;
  pointer("pointermove", cellScreen(3, 3));
  r.rulerShown = view.rulerLabel.style.display === "block" && /ft/.test(view.rulerLabel.textContent);
  r.rulerLabel = view.rulerLabel.textContent;
  click(cellScreen(7, 7), 2);
  r.rightClickReleases = controlled.size === 0 && !hero.ring.visible;

  // 3. click the closed door to open it
  const doorPos = new THREE.Vector3();
  view.walls.get("w15").mesh.getWorldPosition(doorPos);
  click(screenOf(doorPos));
  r.clickOpensDoor = model.walls.find((w) => w.id === "w15").ds === 1;
  toggleDoor("w15");

  // 4. paint heights with a 3x3 brush, then undo
  hud.button("painting").click();
  hud.button("brush").click();
  const h0 = model.heights;
  click(cellScreen(11, 9));
  r.brushPaints9 = model.heights.data.filter((v, i) => v !== h0.data[i]).length === 9;
  hud.button("undo").click();
  r.undoRestores = model.heights.data.every((v, i) => v === h0.data[i]);
  hud.button("painting").click();
  hud.button("topDown").click();

  // 5. cutaway lowers walls on the camera side only
  view.resetCamera();
  hud.button("cutaway").click();
  await frames(40);
  const cuts = [...view.walls.values()].map((w) => w.cut);
  r.cutawayLowersSome = cuts.some((c) => c < 0.5) && cuts.some((c) => c > 0.99);
  hud.button("cutaway").click();
  await frames(40);
  r.cutawayRestores = [...view.walls.values()].every((w) => w.cut > 0.95);

  // 6. tiles and roofs: the roof over room C fades when a focus token stands under it
  r.tilesBuilt = view.tiles.size === 2;
  view.setRoofFocus([{ x: model.grid.sceneX + 5.5 * model.grid.size, y: model.grid.sceneY + 11.5 * model.grid.size }]);
  await frames(40);
  r.roofFadesOverToken = view.tiles.get("roofC").group.visible === false;
  view.setRoofFocus([]);
  await frames(40);
  r.roofBackWithoutToken = view.tiles.get("roofC").group.visible === true;

  // 7. levels: hiding the balcony level hides its floor, railing and archer
  view.setLevelCutoff(0);
  const railing = model.walls.find((w) => w.levelIndex === 1);
  r.levelCutoffHides = !view.tokens.get("archer").group.visible && view.levelFloors.length === 1 &&
    view.levelFloors.every((f) => !f.mesh.visible) && !view.isWallShown(railing.id);
  view.setLevelCutoff(Infinity);
  r.archerOnBalcony = Math.abs(view.tokens.get("archer").target.y - 2) < 1e-6;

  // 8. lights and darkness
  view._updateLights();
  r.lightsActive = view.lightPool.filter((l) => l.intensity > 0).length >= 3;

  // 8b. wall looks: map (default) -> texture (+ per-wall override) -> flat
  r.wallsInheritMap = view.wallMaterialKeyOf("w1") === "map";
  view.setWallStyle({ wallMode: "texture", doorTexture: "gen:planks" });
  r.wallsTextured = view.wallMaterialKeyOf("w1") === "tex:gen:brick" && view.wallMaterialKeyOf("w15") === "tex:gen:planks";
  const w2 = model.walls.find((w) => w.id === "w2");
  view.upsertWall({ ...w2, texture: "gen:planks" });
  r.perWallTexture = view.wallMaterialKeyOf("w2") === "tex:gen:planks" && view.wallMaterialKeyOf("w1") === "tex:gen:brick";
  await new Promise((ok) => setTimeout(ok, 50));
  frames(2);
  r.wallTextureLoaded = !!view.wallMaterials.get("tex:gen:brick")?.map;
  view.upsertWall({ ...w2 });
  view.setWallStyle({ wallMode: "flat", doorTexture: "" });
  r.wallsFlat = view.wallMaterialKeyOf("w1") === "flat" && view.wallMaterialKeyOf("w15") === "door";
  view.setWallStyle({ wallMode: "map" });
  r.wallsBackToMap = view.wallMaterialKeyOf("w1") === "map" && [...view.walls.values()].filter((w) => w.instanced).length > 20;

  // 8c. wall kinds: window opening, invisible glass, half wall
  const win = view.walls.get("w21");
  r.windowHasOpening = !!win?.isWindow && win.object.children.length === 3;
  const inv = view.walls.get("w27");
  r.invisibleWallIsGlass = !!inv && inv.materialKey === "glass" && inv.mesh.material.transparent;
  const half = view.walls.get("w26");
  r.halfWallIsHalf = !!half && Math.abs(half.height - 0.5) < 1e-6;
  view.setWallStyle({ invisibleWalls: "hide", windowOpenings: false });
  r.invisibleCanBeHidden = !view.walls.has("w27");
  r.windowCanBeSolid = view.walls.get("w21")?.instanced === true;
  view.setWallStyle({ invisibleWalls: "glass", windowOpenings: true });
  r.wallKindsRestored = view.walls.has("w27") && !!view.walls.get("w21")?.isWindow;

  // 9. player view: fog + vision
  setPlayerView(true);
  const g = model.grid;
  const st = view.fogStates;
  r.fogOn = view.fogUniforms.f3dFogOn.value === 1;
  r.heroRoomVisible = st[7 * g.cols + 7] === FOG.VISIBLE;
  r.closedRoomUnseen = st[10 * g.cols + 19] === FOG.UNSEEN; // room B, behind the closed door
  r.enemyBehindDoorHidden = !view.tokens.get("goblin").group.visible;
  r.secretDoorLooksLikeWall = !view.walls.get("w7").door;
  toggleDoor("w15"); // open: room B becomes visible from the corridor (mage)
  r.openDoorRevealsRoom = view.fogStates[10 * g.cols + 19] === FOG.VISIBLE || view.fogStates[5 * g.cols + 15] === FOG.VISIBLE;
  toggleDoor("w15"); // close again: what was seen stays explored
  r.exploredRemembered = view.fogStates[5 * g.cols + 15] === FOG.EXPLORED;
  setPlayerView(false);
  r.gmNoFog = view.fogUniforms.f3dFogOn.value === 0;
  return r;
}

