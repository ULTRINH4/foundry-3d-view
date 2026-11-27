/**
 * Mock-Foundry harness page: boots fake Foundry globals, loads the real module (scripts/main.mjs)
 * and drives it through Foundry-style hooks and document updates.
 * URL params: ?gm=0 (player)  ?levels=1 (v14-like levels)  ?selftest=1  ?open=1
 */
import { bootMockFoundry } from "./foundry-mock.mjs";
import { modelFromJSON } from "../scripts/core/scene-model.mjs";
import { drawDungeon, drawToken, drawBalcony, drawRug, drawRoof } from "./art.mjs";
import { createHeightMap, setHeight } from "../scripts/core/heights.mjs";

const params = new URLSearchParams(location.search);
const json = await fetch("./sample-scene.json").then((r) => r.json());
const m = modelFromJSON(json);
const dungeon = drawDungeon(m);
const balcony = drawBalcony(m);
const tileArt = { rug: drawRug(), roofC: drawRoof() };
const env = await bootMockFoundry({
  art: {
    dungeon,
    token: (t) => drawToken({ ...t, src: `gen:${t._id}` }),
    tile: (t) => tileArt[t._id],
    level: (l) => (l.id === "balcony" ? balcony : dungeon),
  },
});

const api = () => game.modules.get("foundry-3d-view").api;
const status = (s) => (document.getElementById("status").textContent = s);
const controls = document.getElementById("controls");
const addBtn = (label, fn) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  controls.appendChild(b);
};
addBtn("Toggle 3D (API)", () => api().toggle());
addBtn("Door w15 (updateWall)", () => {
  const w = canvas.scene.walls.get("w15");
  w.update({ ds: w.ds === 1 ? 0 : 1 });
});
addBtn("Move goblin (updateToken)", () => {
  const d = canvas.scene.tokens.get("goblin");
  d.update({ x: d.x + 100 });
});
status(`mock Foundry: ${game.user.isGM ? "GM" : "player"} - module API ${api() ? "ready" : "missing"}`);
if (params.has("open")) await api().open();

if (params.has("selftest")) {
  run().catch((e) => ({ error: String(e?.stack ?? e) })).then((r) => {
    document.body.dataset.selftest = JSON.stringify(r);
    status("selftest " + JSON.stringify(r));
  });
}

async function run() {
  const r = {};
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const isGM = game.user.isGM;

  // Registration
  r.settingsRegistered = ["wallHeight", "heightStep", "showGrid", "fog3d", "cutaway", "showRoofs", "windowed", "wallMode", "wallTexture", "doorTexture", "wallTextureScale"]
    .every((k) => env.settings.has(`foundry-3d-view.${k}`));
  r.keybindingRegistered = !!game.keybindings.registry["foundry-3d-view.toggle"];
  const controlsV13 = { tokens: { name: "tokens", tools: {} } };
  Hooks.callAll("getSceneControlButtons", controlsV13);
  const tool = controlsV13.tokens.tools.f3dToggle;
  r.sceneControlToolV13 = !!tool && typeof tool.onChange === "function";
  const controlsV12 = [{ name: "token", tools: [] }];
  Hooks.callAll("getSceneControlButtons", controlsV12);
  r.sceneControlToolArray = controlsV12[0].tools.some((x) => x.name === "f3dToggle" && typeof x.onClick === "function");
  r.v13ToolHasNoLegacyOnClick = tool.onClick === undefined; // v13 would call both and toggle twice

  // Open via the scene control button
  tool.onChange();
  for (let i = 0; i < 50 && !api().isOpen; i++) await wait(50);
  await wait(300);
  r.opens = api().isOpen && !!document.getElementById("f3d-overlay");
  r.overlayAfterBoard = document.getElementById("board").nextElementSibling?.id === "f3d-overlay";
  const view = window.__f3dView = findView();
  r.viewBuilt = !!view && view.walls.size > 0 && view.tokens.size === 6 && view.tiles.size === 2;
  r.lightsLoaded = view.lights.length === 4; // 3 ambient + hero torch
  r.darknessApplied = Math.abs(view.darkness - json.darkness) < 1e-6;

  // Wall look follows the module settings; a wall flag overrides it
  r.wallsInheritMapByDefault = view.wallMaterialKeyOf("w1") === "map";
  await game.settings.set("foundry-3d-view", "wallTexture", "textures/stone.webp");
  await game.settings.set("foundry-3d-view", "wallMode", "texture");
  r.wallModeSettingApplies = view.wallMaterialKeyOf("w1") === "tex:textures/stone.webp";
  await canvas.scene.walls.get("w2").update({ flags: { "foundry-3d-view": { texture: "textures/brick.webp" } } });
  r.wallFlagOverrides = view.wallMaterialKeyOf("w2") === "tex:textures/brick.webp";
  await game.settings.set("foundry-3d-view", "wallMode", "map");
  r.wallFlagSurvivesModeChange = view.wallMaterialKeyOf("w2") === "tex:textures/brick.webp" && view.wallMaterialKeyOf("w1") === "map";

  // Door updates through the document
  const door = canvas.scene.walls.get("w15");
  const before = view.walls.get("w15").door.target;
  await door.update({ ds: 1 });
  r.updateWallSwingsDoor = Math.abs(view.walls.get("w15").door.target - before - Math.PI / 2) < 1e-6;
  await door.update({ ds: 0 });

  // Token movement through the document
  const gob = canvas.scene.tokens.get("goblin");
  await gob.update({ x: gob.x + 100 });
  r.updateTokenMovesStandee = Math.abs(view.tokens.get("goblin").target.x - ((gob.x + 50 - 1400) / 100)) < 1e-6;

  // Wall/tile/light create + delete
  const nw = { _id: "wNew", c: [300, 300, 500, 300], move: 20, sight: 20, door: 0, ds: 0 };
  const wdoc = new (door.constructor)("Wall", nw, canvas.scene);
  canvas.scene.walls.set(wdoc);
  Hooks.callAll("createWall", wdoc, {}, "user");
  r.createWall = view.walls.has("wNew");
  canvas.scene.walls.delete("wNew");
  Hooks.callAll("deleteWall", wdoc, {}, "user");
  r.deleteWall = !view.walls.has("wNew");
  const lightDoc = canvas.scene.lights.get("torchB");
  await lightDoc.update({ config: { dim: 50 } });
  r.updateLight = view.lights.find((l) => l.id === "torchB")?.dim === 50;
  const tileDoc = canvas.scene.tiles.get("rug");
  await tileDoc.update({ rotation: 45 });
  await wait(50);
  r.updateTile = view.tiles.get("rug")?.data.rotation === 45;

  // Darkness change
  await canvas.scene.update({ environment: { darknessLevel: 0.9 } });
  canvas.environment.darknessLevel = 0.9;
  Hooks.callAll("lightingRefresh");
  r.darknessUpdates = Math.abs(view.darkness - 0.9) < 1e-6;

  // Selection + move from the 3D view
  const hero = canvas.tokens.get("hero");
  hero.control();
  r.selectionRing = view.tokens.get("hero").ring.visible;
  const ctrl = findController();
  await ctrl._moveToken("hero", { col: 6, row: 6 });
  r.moveFromView = canvas.scene.tokens.get("hero").x === 200 + 600 && canvas.scene.tokens.get("hero").y === 200 + 600;
  r.measureLabel = ctrl._measure({ col: 6, row: 6 }, { col: 9, row: 8 });
  r.measureUsesFoundry = r.measureLabel.startsWith("20 ft");

  if (!isGM) {
    // Players cannot walk through walls, cannot open locked doors.
    const n = env.notes.length;
    await ctrl._moveToken("hero", { col: 6, row: 12 }); // through room A's south wall
    r.playerBlockedByWall = canvas.scene.tokens.get("hero").y === 800 && env.notes.length > n;
    await canvas.scene.walls.get("w15").update({ ds: 2 });
    await ctrl._toggleDoor("w15");
    r.playerCannotOpenLocked = canvas.scene.walls.get("w15").ds === 2;
    await canvas.scene.walls.get("w15").update({ ds: 0 });
    await ctrl._toggleDoor("w15");
    r.playerOpensDoor = canvas.scene.walls.get("w15").ds === 1;
    await canvas.scene.walls.get("w15").update({ ds: 0 });
    // Fog of war and token visibility
    ctrl._updateFog();
    r.fogOnForPlayer = view.fogUniforms.f3dFogOn.value === 1;
    ctrl.syncVisibility();
    r.enemyBehindWallHidden = !view.tokens.get("goblin").group.visible;
    r.hiddenTokenHidden = !view.tokens.get("ghost").group.visible;
    r.secretDoorIsWall = !view.walls.get("w7").door;
  } else {
    // GM: paint heights, saved to scene flags and reapplied from the hook
    let h = createHeightMap(view.grid.cols, view.grid.rows);
    h = setHeight(h, 10, 10, 5);
    ctrl._queueSaveHeights(h);
    ctrl._flushHeights();
    await wait(20);
    r.heightsSavedToFlags = canvas.scene.flags["foundry-3d-view"].heights.data[10 * view.grid.cols + 10] === 5;
    r.heightsApplied = view.getHeights().data[10 * view.grid.cols + 10] === 5;
    ctrl._updateFog();
    r.noFogForGM = view.fogUniforms.f3dFogOn.value === 0;
    r.gmSeesHiddenAsGhost = view.tokens.get("ghost").group.visible && view.tokens.get("ghost").card.material.opacity < 1;
    // HUD toggles persist to client settings
    document.querySelector('[data-key="cutaway"]').click();
    r.cutawaySettingSaved = game.settings.get("foundry-3d-view", "cutaway") === true;
    document.querySelector('[data-key="cutaway"]').click();
  }
  if (params.has("levels")) {
    r.levelsBuilt = view.levelFloors.length === 1 && !!document.querySelector(".f3d-level");
    r.archerOnLevel2 = view.tokens.get("archer").data.levelIndex === 1;
  }

  // Scene redraw reloads; closing removes everything and unhooks
  const modelBefore = findController().model;
  Hooks.callAll("canvasReady", canvas);
  for (let i = 0; i < 40 && findController().model === modelBefore; i++) await wait(50);
  await wait(300);
  r.reloadOnCanvasReady = api().isOpen && findController().model !== modelBefore && findView().walls.size > 0 &&
    document.querySelectorAll(".f3d-hud").length === 1;
  // Closing in the middle of a reload must not throw
  Hooks.callAll("canvasReady", canvas);
  api().close();
  await wait(400);
  r.closeDuringReloadSafe = !api().isOpen && !document.getElementById("f3d-overlay");
  await api().open();
  await wait(200);
  const hooksBefore = Hooks.count("updateWall");
  api().close();
  r.closes = !api().isOpen && !document.getElementById("f3d-overlay");
  r.unhooks = Hooks.count("updateWall") < hooksBefore;
  // Keybinding toggles too
  game.keybindings.registry["foundry-3d-view.toggle"].onDown();
  for (let i = 0; i < 50 && !api().isOpen; i++) await wait(50);
  r.keybindingOpens = api().isOpen;
  api().close();
  r.warnings = JSON.stringify(env.notes);
  return r;
}

function findController() {
  return api()._controller;
}
function findView() {
  return api()._controller?.view;
}
