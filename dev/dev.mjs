/**
 * Standalone dev page: renders dev/sample-scene.json with the same renderer, toolbar and pointer
 * interaction the module uses inside Foundry. Map, tile and token art are generated on a canvas
 * so the repo carries no images. The page plays the Foundry side: it owns the documents, answers
 * the interaction callbacks and computes fog with the pure line-of-sight code.
 *
 * URL params: ?topdown=1  ?player=1  ?az=<deg>  ?paint=1  ?cutaway=1 (The Sims cutaway)  ?cut=up|cutaway|down  ?select=<tokenId>  ?selftest=1
 *             ?walls=map|texture|flat  ?camera=tactics  ?sprites=camera|billboard|standee
 */
import * as THREE from "../vendor/three/three.module.js";
import { View3D } from "../scripts/render/view3d.mjs";
import { createHud } from "../scripts/ui/hud.mjs";
import { createInteraction } from "../scripts/ui/interact.mjs";
import { modelFromJSON } from "../scripts/core/scene-model.mjs";
import { getHeight } from "../scripts/core/heights.mjs";
import { drawDungeon, drawToken, drawBalcony, drawRug, drawRoof, drawBricks, drawPlanks, drawSpriteSheet } from "./art.mjs";
import { losVisibilityTest, visibleCells, fogStates, FOG, computeLOS, pointInPolygon } from "../scripts/core/vision.mjs";
import { lightLevels } from "../scripts/core/lighting.mjs";
import { reachable, attackRing, wallBlocker, diagonalCostFor } from "../scripts/core/movement.mjs";
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
for (const tok of model.tokens) {
  tok.src = drawToken(tok);
  if (tok.sheet) tok.sheet.src = drawSpriteSheet("#8e44ad");
}

const overlay = document.getElementById("f3d-overlay");
let playerView = params.has("player");
const wallArt = {
  "gen:brick": drawBricks(),
  "gen:planks": drawPlanks(),
  // A 2:1 wall strip (baseboard and moulding) for the rectangular-texture check.
  "gen:wide": (() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "#8a7558";
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = "#4b3a2a";
    g.fillRect(0, 100, 256, 28);
    g.fillRect(0, 0, 256, 12);
    return c.toDataURL();
  })(),
};
const wallMode = params.get("walls") ?? "map";
const view = new View3D(overlay.querySelector(".f3d-viewport"), {
  isGM: !playerView,
  preserveDrawingBuffer: true,
  wallMode,
  wallTexture: "gen:brick",
  doorTexture: wallMode === "texture" ? "gen:planks" : "",
  resolveSrc: (src) => wallArt[src] ?? src,
  cameraMode: params.get("camera") ?? "free",
  spriteFacing: params.get("sprites") ?? "camera",
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

/** Light map like Foundry's: scene lights + token lights, clipped by walls with our line of sight. */
function computeLightMap(states) {
  const g = model.grid;
  if (!(model.darkness >= 0.05) || params.has("nolightmap")) return view.setLightMap(null);
  const groundWalls = model.walls.filter((w) => (w.levelIndex ?? 0) === 0);
  const bounds = { x: g.sceneX, y: g.sceneY, width: g.sceneWidth, height: g.sceneHeight };
  const px = (units) => (units / g.distance) * g.size;
  const sources = model.lights.map((l) => {
    let x = l.x, y = l.y;
    if (l.tokenId) {
      const tok = model.tokens.find((tk) => tk.id === l.tokenId);
      if (!tok) return null;
      ({ x, y } = tokenCenter(g, tok));
    }
    const poly = computeLOS({ x, y }, groundWalls, { radius: px(Math.max(l.dim, l.bright)), bounds });
    return { x, y, bright: px(l.bright), dim: px(l.dim), contains: (cx, cy) => pointInPolygon(cx, cy, poly) };
  }).filter(Boolean);
  const vision = states ? Uint8Array.from(states, (s) => (s === FOG.VISIBLE ? 1 : 0)) : null;
  view.setLightMap(lightLevels(g, sources), { vision });
}

function refreshVisibility() {
  const g = model.grid;
  const states = playerView ? computeFog() : null;
  view.setFog(states);
  computeLightMap(states);
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

function moveToken(id, cell, path = null) {
  const tok = model.tokens.find((tk) => tk.id === id);
  tok.x = model.grid.sceneX + cell.col * model.grid.size;
  tok.y = model.grid.sceneY + cell.row * model.grid.size;
  if (path && path.length > 1) view.moveTokenAlong(id, path); // walk square by square
  else view.moveToken(id, { x: tok.x, y: tok.y });
  refreshVisibility();
  setTimeout(() => interaction?.refresh(), 0);
}

/** Fire Emblem-style range for the dev page (same rules as in Foundry). */
function computeRange(id) {
  const g = model.grid;
  const tok = model.tokens.find((tk) => tk.id === id);
  if (!tok) return null;
  const start = canvasToCell(g, tok.x + g.size / 2, tok.y + g.size / 2);
  const occupied = new Set();
  for (const o of model.tokens) {
    if (o.id === id || o.hidden || o.disposition === tok.disposition || (o.levelIndex ?? 0) !== (tok.levelIndex ?? 0)) continue;
    const c = canvasToCell(g, o.x + g.size / 2, o.y + g.size / 2);
    if (c) occupied.add(c.row * g.cols + c.col);
  }
  const blocked = wallBlocker(model.walls.filter((w) => (w.levelIndex ?? 0) === 0), g);
  const reach = reachable(g, start, 6, {
    blocked,
    heights: model.heights,
    climbUnits: 2.5 + 1e-6,
    diagonalCost: diagonalCostFor(DIAGONALS.ALTERNATING_1),
    occupied,
  });
  return { reach, attack: attackRing(g, reach, 1, { blocked }) };
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
  initial: { cutMode: params.get("cut") ?? (params.has("cutaway") ? "cutaway" : "up"), showRoofs: true, cameraMode: params.get("camera") ?? "free", spriteFacing: params.get("sprites") ?? "camera" },
  getWalls: () => model.walls.filter((w) => (w.levelIndex ?? 0) === 0),
  onHeightsChanged: (h) => (model.heights = h),
  onToggleMove: () => interaction?.toggleMoveMode(),
});

// eslint-disable-next-line prefer-const
let interaction = null;
interaction = createInteraction(view, {
  isBusy: () => hud.state.painting,
  getControlled: () => [...controlled],
  canControl: (id) => !playerView || isFriendly(model.tokens.find((tk) => tk.id === id)),
  onSelectToken: (id, additive) => {
    if (!additive) controlled.clear();
    controlled.add(id);
    refreshVisibility();
    interaction.refresh();
  },
  onReleaseAll: () => {
    controlled.clear();
    refreshVisibility();
    interaction.refresh();
  },
  onMoveToken: moveToken,
  onToggleDoor: toggleDoor,
  computeRange,
  canMoveAnywhere: () => !playerView,
  onBlocked: () => (document.getElementById("dev-status").textContent = "Out of range"),
  onMoveModeChange: (on) => hud.setMoveActive(on),
  measure: (a, b) => {
    const dh = getHeight(model.heights, b.col, b.row) - getHeight(model.heights, a.col, a.row);
    return formatDistance(gridSquares(a, b, DIAGONALS.ALTERNATING_1), model.grid.distance, "ft", dh);
  },
});

if (params.has("az")) view.rotateBy(Number(params.get("az")), { animate: false });
if (params.has("topdown")) hud.button("topDown").click();
if (params.has("paint")) hud.button("painting").click();
if (params.has("select")) {
  controlled.add(params.get("select"));
  refreshVisibility();
}
if (params.has("select")) interaction.refresh();
if (params.has("select") && params.has("hover")) interaction.setMoveMode(params.get("select"));
if (params.has("hover")) {
  // Screenshot helper: cursor + path arrow from the selected token, e.g. ?select=hero&hover=8,7
  const [col, row] = params.get("hover").split(",").map(Number);
  const { pathTo } = await import("../scripts/core/movement.mjs");
  view.setCursor({ col, row });
  if (interaction.range) view.showPath(pathTo(model.grid, interaction.range.reach, { col, row }));
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
  r.selectDoesNotShowRange = !interaction.moveMode && !view.moveMesh?.visible;
  const heroX0 = model.tokens.find((tk) => tk.id === "hero").x;
  click(cellScreen(7, 7));
  r.floorClickOutsideMoveModeIgnored = model.tokens.find((tk) => tk.id === "hero").x === heroX0;
  click(heroPt); // second click on the selected token: move mode
  r.secondClickEntersMoveMode = interaction.moveMode === "hero" && view.moveMesh?.visible && hud.button("move").classList.contains("active");
  click(cellScreen(7, 7));
  r.clickMovesToken = model.tokens.find((tk) => tk.id === "hero").x === model.grid.sceneX + 7 * model.grid.size;
  r.moveModeEndsAfterMove = !interaction.moveMode && !view.moveMesh?.visible && !hud.button("move").classList.contains("active");
  await frames(40);
  interaction.setHovering(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM", key: "m", bubbles: true }));
  r.mKeyEntersMoveMode = interaction.moveMode === "hero";
  pointer("pointermove", cellScreen(3, 3));
  r.rulerShown = view.rulerLabel.style.display === "block" && /ft/.test(view.rulerLabel.textContent);
  r.rulerLabel = view.rulerLabel.textContent;
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
  r.escLeavesMoveModeKeepsSelection = !interaction.moveMode && controlled.has("hero");
  hud.button("move").click();
  r.toolbarMoveButton = interaction.moveMode === "hero";
  click(cellScreen(7, 7), 2);
  r.rightClickLeavesMoveMode = !interaction.moveMode && controlled.has("hero");
  interaction.setHovering(false);
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

  // 5. walls: up -> cutaway (The Sims: front walls of each room) -> down -> up
  view.resetCamera();
  hud.button("cutaway").click();
  await frames(40);
  const cuts = [...view.walls.values()].map((w) => w.cut);
  r.cutawayLowersSome = view.cutMode === "cutaway" && cuts.some((c) => c < 0.5) && cuts.some((c) => c > 0.99);
  r.cutawayCapsDrawn = (view.capMesh?.count ?? 0) > 0;
  const cutA = new Set([...view.walls].filter(([, w]) => w.cut < 0.5).map(([id]) => id));
  view.rotateBy(180, { animate: false });
  await frames(40);
  const cutB = new Set([...view.walls].filter(([, w]) => w.cut < 0.5).map(([id]) => id));
  // Turning around: walls that were in front are now at the back and come back up
  r.cutawayFollowsCamera = cutB.size > 0 && [...cutA].some((id) => !cutB.has(id)) && [...cutB].some((id) => !cutA.has(id));
  view.rotateBy(-180, { animate: false });
  hud.button("cutaway").click();
  await frames(40);
  r.wallsDownAll = view.cutMode === "down" && [...view.walls.values()].every((w) => w.height * w.cut <= view.options.cutawayHeight + 0.02);
  hud.button("cutaway").click();
  await frames(40);
  r.cutawayRestores = view.cutMode === "up" && [...view.walls.values()].every((w) => w.cut > 0.95);
  r.capsGoneWhenUp = (view.capMesh?.count ?? 0) === 0;

  // 6. tiles and roofs: the roof over room C fades when a focus token stands under it
  r.tilesBuilt = view.tiles.size === 5;
  const tree = view.tiles.get("tree1");
  r.modelTileBuilt = !!tree?.isModel && !!tree.mesh && tree.mesh.children.length >= 3;
  r.modelOnRaisedGround = Math.abs(tree.group.position.y - 1) < 1e-6; // outside rock is 5 ft high
  r.carStretchedToFootprint = Math.abs(view.tiles.get("car1").group.scale.z - 2) < 1e-6;
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
  r.wallsTextured = view.wallMaterialKeyOf("w1") === "tex:repeat:1:gen:brick" && view.wallMaterialKeyOf("w15") === "door:fit:gen:planks";
  const w2 = model.walls.find((w) => w.id === "w2");
  view.upsertWall({ ...w2, texture: "gen:planks" });
  r.perWallTexture = view.wallMaterialKeyOf("w2") === "tex:repeat:1:gen:planks" && view.wallMaterialKeyOf("w1") === "tex:repeat:1:gen:brick";
  // a wall texture flag on a door doesn't change the door; its own door texture does
  const w15 = model.walls.find((w) => w.id === "w15");
  view.upsertWall({ ...w15, texture: "gen:brick" });
  r.doorIgnoresWallTexture = view.wallMaterialKeyOf("w15") === "door:fit:gen:planks";
  view.upsertWall({ ...w15, doorTexture: "gen:brick", doorTextureMode: "repeat" });
  r.doorOwnTexture = view.wallMaterialKeyOf("w15") === "door:repeat:gen:brick";
  view.upsertWall({ ...w15 });
  // rectangular texture: the tile keeps the image's proportions (2:1 image -> twice as wide)
  view.upsertWall({ ...w2, texture: "gen:wide", textureFit: "height" });
  r.rectTextureKey = view.wallMaterialKeyOf("w2") === "tex:height:1:gen:wide";
  await new Promise((ok) => setTimeout(ok, 50));
  frames(2);
  r.wallTextureLoaded = !!view.wallMaterials.get("tex:repeat:1:gen:brick")?.map;
  const wideP = view.wallMaterials.get("tex:height:1:gen:wide")?.userData.texUniforms?.f3dTexP.value;
  r.rectTextureKeepsProportions = !!wideP && Math.abs(wideP.y / wideP.x - 2) < 1e-6 && wideP.z === 1;
  view.upsertWall({ ...w2 });
  view.setWallStyle({ wallMode: "flat", doorTexture: "" });
  r.wallsFlat = view.wallMaterialKeyOf("w1") === "flat" && view.wallMaterialKeyOf("w15") === "door";
  r.defaultDoorTexture = !!view.walls.get("w15").mesh.material.map;
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

  // 8d. tactics camera, sprite facing modes, directional sprite sheet
  hud.button("tactics").click();
  r.tacticsIsOrthographic = view.camera.isOrthographicCamera === true && view.cameraMode === "tactics";
  const yawDeg = () => ((view.cameraYaw() * 180) / Math.PI + 360) % 360;
  r.tacticsOnDiagonal = Math.abs(((yawDeg() - 45) % 90 + 90) % 90) < 0.5;
  const mage = view.tokens.get("mage");
  frames(2);
  const rowBefore = mage.sheetRow;
  const y0 = yawDeg();
  view.rotateBy(90);
  frames(40); // animated turn
  r.tacticsTurns90 = Math.abs(((yawDeg() - y0 + 360) % 360) - 90) < 0.5;
  view.rotateBy(90);
  frames(40);
  r.sheetRowChangesWithView = mage.sheetRow !== rowBefore && mage.sheetRow >= 0;
  r.sheetCellSized = Math.abs(mage.sheetTex.repeat.x - 0.5) < 1e-6 && Math.abs(mage.sheetTex.repeat.y - 0.25) < 1e-6;
  const seenCols = new Set();
  for (let i = 0; i < 20; i++) {
    frames(1);
    seenCols.add(mage.sheetCol);
  }
  r.sheetAnimates = seenCols.size === 2; // 2 frames at 4 fps over ~0.66 s
  view.setSpriteFacing("billboard");
  frames(2);
  r.billboardTilts = Math.abs(mage.pivot.rotation.x + (Math.PI / 2 - (90 - 30) * Math.PI / 180)) < 0.02;
  view.setSpriteFacing("standee");
  frames(2);
  r.standeeFollowsRotation = Math.abs(mage.yaw.rotation.y - (-270 * Math.PI / 180)) < 1e-6;
  view.setSpriteFacing("camera");
  r.raycastWorksInTactics = !!view.pickCell(canvas.getBoundingClientRect().width / 2, canvas.getBoundingClientRect().height / 2);
  hud.button("tactics").click();
  r.backToPerspective = view.camera.isPerspectiveCamera === true;

  // 8e. Foundry-like light map
  r.lightMapOn = view.lightMapOn === true && view.fogUniforms.f3dLightOn.value === 1;
  const lg = model.grid;
  const cellOf = (col, row) => view.lightLevels[row * lg.cols + col];
  r.brazierLitBright = cellOf(19, 4) === 255; // brazier on the dais
  r.farCornerDark = cellOf(23, 15) === 0; // rock far from every light
  r.wallBlocksLight = cellOf(10, 9) === 0; // outside room A, behind its wall from the hero's torch
  model.darkness = 0;
  view.setLights(model.lights, 0);
  refreshVisibility();
  r.daylightNoLightMap = view.lightMapOn === false;
  model.darkness = 0.55;
  view.setLights(model.lights, 0.55);
  refreshVisibility();

  // 8f. Fire Emblem-style movement
  view.setTopDown(false);
  view.resetCamera();
  frames(5);
  const heroTok = model.tokens.find((tk) => tk.id === "hero");
  const heroCell0 = canvasToCell(model.grid, heroTok.x + 50, heroTok.y + 50);
  controlled.clear();
  controlled.add("hero");
  interaction.refresh();
  interaction.setMoveMode("hero");
  r.feBlueAndRedShown = view.moveMesh?.visible && view.moveMesh.count > 10 && view.attackMesh?.count > 0;
  r.feRangeBlockedByWalls = !interaction.range.reach.has(heroCell0.row * model.grid.cols + 12); // corridor door closed / walls
  interaction.setHovering(true);
  pointer("pointermove", cellScreen(4, 5)); // start the cursor in the middle of room A
  const key = (code) => window.dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true }));
  const cursorBefore = { ...(interaction.cursor ?? heroCell0) };
  key("ArrowRight");
  const c1 = interaction.cursor;
  r.feKeyboardCursorMoves = !!c1 && Math.abs(c1.col - cursorBefore.col) + Math.abs(c1.row - cursorBefore.row) === 1;
  // "up" follows the camera: rotate 180° and "up" must go the other way
  key("ArrowUp");
  const up1 = { ...interaction.cursor };
  key("ArrowDown");
  view.rotateBy(180, { animate: false });
  key("ArrowUp");
  const up2 = { ...interaction.cursor };
  key("ArrowDown");
  r.feCursorRelativeToCamera = (up1.col - c1.col) === -(up2.col - c1.col) && (up1.row - c1.row) === -(up2.row - c1.row);
  view.rotateBy(-180, { animate: false });
  // move the cursor two squares right of the hero and confirm with Enter
  for (let i = 0; i < 1; i++) key("ArrowRight");
  r.fePathArrowShown = !!view.pathMesh;
  const target = { ...interaction.cursor };
  key("Enter");
  r.feEnterMovesToken = heroTok.x === model.grid.sceneX + target.col * model.grid.size && heroTok.y === model.grid.sceneY + target.row * model.grid.size;
  const heroEntry = view.tokens.get("hero");
  r.feWalksSquareBySquare = Array.isArray(heroEntry.queue) && heroEntry.queue.length >= 1;
  frames(60);
  r.feArrivesAtTarget = !heroEntry.queue?.length;
  // A move the range didn't hear about (missed hook): the next hover recomputes from the new square
  interaction.setMoveMode("hero");
  const hc = canvasToCell(model.grid, heroTok.x + 50, heroTok.y + 50);
  const moved = { col: hc.col - 1, row: hc.row };
  heroTok.x -= model.grid.size;
  view.moveToken("hero", { x: heroTok.x, y: heroTok.y }, { snap: true });
  const staleBefore = interaction.range.start.col !== moved.col;
  await new Promise((ok) => setTimeout(ok, 300)); // past the heal throttle
  pointer("pointermove", cellScreen(4, 4));
  r.staleRangeHeals = staleBefore && interaction.range.start.col === moved.col && interaction.range.start.row === moved.row;
  interaction.setMoveMode(null);
  heroTok.x += model.grid.size;
  view.moveToken("hero", { x: heroTok.x, y: heroTok.y }, { snap: true });

  // players can't leave the blue squares
  setPlayerView(true);
  controlled.clear();
  controlled.add("hero");
  interaction.refresh();
  interaction.setMoveMode("hero");
  const xBefore = heroTok.x, yBefore = heroTok.y;
  view.setTopDown(true);
  frames(20);
  click(cellScreen(23, 15)); // far outside the blue squares
  r.feOutOfRangeRefused = heroTok.x === xBefore && heroTok.y === yBefore && /Out of range/.test(document.getElementById("dev-status").textContent);
  view.setTopDown(false);
  setPlayerView(false);
  controlled.clear();
  interaction.refresh();
  interaction.setHovering(false);
  r.feClearedOnRelease = !view.moveMesh.visible;

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

