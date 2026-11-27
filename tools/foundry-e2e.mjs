// End-to-end test against a REAL Foundry VTT server (v13), driven by headless Edge/Chrome through
// playwright-core. It never touches your own worlds: point it at a throwaway data folder.
//
//   1. Start Foundry with a separate data path that has your license, a game system and this module
//      (symlinked into Data/modules/foundry-3d-view). Example (Windows, portable build):
//        node <Foundry>/App/resources/app/main.mjs --dataPath=<testdata> --port=30013 --noupnp --noupdate
//   2. FOUNDRY_URL=http://localhost:30013 FOUNDRY_SYSTEM=<systemId> npm run e2e
//
// The script creates (or reuses) a world "f3d-test", enables the module, builds the sample dungeon as
// a real scene (walls, doors, actors + tokens, lights, tiles, heights), then tests the 3D view as the
// GM and as a player in a second browser session, with real mouse and keyboard input.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL = process.env.FOUNDRY_URL ?? "http://localhost:30013";
const WORLD = process.env.FOUNDRY_WORLD ?? "f3d-test";
const SYSTEM = process.env.FOUNDRY_SYSTEM ?? "ordemparanormal";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "dev", "screenshots");
mkdirSync(shots, { recursive: true });
const browserPath = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean).find((p) => existsSync(p));

const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});

function watchConsole(page, label) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    errors.push(t);
    if (/foundry-3d-view|f3d|view3d|three/i.test(t)) console.log(`[${label} console.error] ${t.slice(0, 400)}`);
  });
  page.on("pageerror", (e) => {
    errors.push(String(e));
    console.log(`[${label} pageerror] ${String(e).slice(0, 400)}`);
  });
  return errors;
}

async function post(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, text: (await r.text()).slice(0, 300) };
  }, { path, body });
}

async function ensureWorldRunning(page) {
  await page.goto(`${URL}/`, { waitUntil: "networkidle" });
  if (page.url().includes("/setup")) {
    const exists = await page.evaluate((w) => game.worlds?.has(w), WORLD);
    if (!exists) {
      const r = await post(page, "/setup", { action: "createWorld", id: WORLD, title: "F3D Test", system: SYSTEM });
      if (r.status !== 200) throw new Error("createWorld failed: " + r.text);
    }
    const r = await post(page, "/setup", { action: "launchWorld", world: WORLD });
    if (r.status !== 200 || r.text.includes("error")) throw new Error("launchWorld failed: " + r.text);
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      await page.goto(`${URL}/`, { waitUntil: "networkidle" });
      if (page.url().includes("/join") || page.url().includes("/game")) break;
    }
  }
}

async function joinAs(page, userName) {
  await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
  // v13 renders the join form after load.
  await page.waitForFunction((name) => [...document.querySelectorAll("select[name=userid] option")].some((o) => o.textContent.trim() === name), userName, { timeout: 30000 }).catch(() => {});
  const userid = await page.evaluate((name) => {
    const opt = [...document.querySelectorAll("select[name=userid] option")].find((o) => o.textContent.trim() === name);
    return opt?.value;
  }, userName);
  if (!userid) {
    const opts = await page.evaluate(() => [...document.querySelectorAll("select[name=userid] option")].map((o) => o.textContent.trim()));
    throw new Error(`user ${userName} not found on /join (options: ${JSON.stringify(opts)})`);
  }
  const r = await post(page, "/join", { action: "join", userid, password: "" });
  if (r.status !== 200) throw new Error("join failed: " + r.text);
  await page.goto(`${URL}/game`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.game?.ready === true && canvas?.ready, null, { timeout: 120000 });
  await sleep(1500);
  await closePopups(page);
}

/** Close system welcome dialogs and similar popups (v1 windows) so they don't cover the board. */
async function closePopups(page) {
  // Headless browsers get a permanent "no hardware acceleration" notification at the top centre;
  // hide notifications so they don't swallow test clicks.
  await page.addStyleTag({ content: "#notifications { display: none !important; }" });
  await page.evaluate(async () => {
    for (const w of Object.values(ui.windows ?? {})) await w.close?.().catch?.(() => {});
    for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (app.hasFrame && app.rendered && app.options?.window?.frame !== false && !app.id?.startsWith?.("sidebar")) {
        await app.close?.().catch?.(() => {});
      }
    }
  });
}

/* ------------------------------------------------------------------------------------------ */
/* GM session: enable module, build the scene                                                  */
/* ------------------------------------------------------------------------------------------ */
const gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const gm = await gmCtx.newPage();
const gmErrors = watchConsole(gm, "gm");
await ensureWorldRunning(gm);
await joinAs(gm, "Gamemaster");
check("GM joined world", await gm.evaluate(() => game.user.isGM));

const enabled = await gm.evaluate(async () => {
  const cfg = game.settings.get("core", "moduleConfiguration");
  if (cfg["foundry-3d-view"]) return true;
  const req = [...(game.system.relationships?.requires ?? [])].map((r) => r.id);
  const next = { ...cfg, "foundry-3d-view": true };
  for (const id of req) next[id] = true;
  await game.settings.set("core", "moduleConfiguration", next);
  return false;
});
if (!enabled) {
  await gm.reload({ waitUntil: "domcontentloaded" });
  await gm.waitForFunction(() => globalThis.game?.ready === true && canvas?.ready, null, { timeout: 120000 });
  await sleep(1500);
}
check("module active", await gm.evaluate(() => game.modules.get("foundry-3d-view")?.active && !!game.modules.get("foundry-3d-view").api));

const ids = await gm.evaluate(async () => {
  const MOD = "/modules/foundry-3d-view";
  const { modelFromJSON } = await import(`${MOD}/scripts/core/scene-model.mjs`);
  const art = await import(`${MOD}/dev/art.mjs`);
  const json = await fetch(`${MOD}/dev/sample-scene.json`).then((r) => r.json());
  const FP = foundry.applications.apps.FilePicker.implementation;
  try {
    await FP.createDirectory("data", "f3d-assets");
  } catch {
    /* exists */
  }
  const upload = async (canvasEl, name) => {
    const blob = await new Promise((ok) => canvasEl.toBlob(ok, "image/png"));
    await FP.upload("data", "f3d-assets", new File([blob], name, { type: "image/png" }), {}, { notify: false });
    return `f3d-assets/${name}`;
  };
  const m = modelFromJSON(json);
  const bg = await upload(art.drawDungeon(m), "dungeon.png");
  const imgs = {};
  for (const t of json.tokens) imgs[t._id] = await upload(art.drawToken({ ...t, src: `gen:${t._id}` }), `token-${t._id}.png`);
  const rug = await upload(art.drawRug(), "rug.png");
  const roof = await upload(art.drawRoof(), "roof.png");

  // Player user
  let player = game.users.getName("Player");
  if (!player) player = await User.create({ name: "Player", role: CONST.USER_ROLES.PLAYER });

  // Clean previous run
  const old = game.scenes.getName("F3D Sample");
  if (old) await old.delete();
  for (const a of game.actors.filter((a) => a.getFlag("foundry-3d-view", "e2e"))) await a.delete();

  const actorType = game.documentTypes.Actor.find((t) => t !== "base");
  const g = json.grid;
  const scene = await Scene.create({
    name: "F3D Sample",
    background: { src: bg },
    width: g.sceneWidth,
    height: g.sceneHeight,
    padding: 0.08,
    grid: { size: g.size, type: 1, distance: g.distance, units: "ft" },
    tokenVision: true,
    fog: { exploration: true },
    environment: { darknessLevel: 0.3, globalLight: { enabled: true } },
    foregroundElevation: 20,
    flags: { "foundry-3d-view": { heights: json.heights } },
  });
  // The sample is authored with 200px padding; Foundry decides the real padding, so shift by it.
  const dim = scene.getDimensions?.() ?? scene.dimensions;
  const dx = dim.sceneX - g.sceneX, dy = dim.sceneY - g.sceneY;
  const sx = (c) => [c[0] + dx, c[1] + dy, c[2] + dx, c[3] + dy];
  const walls = await scene.createEmbeddedDocuments("Wall", json.walls.filter((w) => !w.level).map((w) => ({
    c: sx(w.c), door: w.door ?? 0, ds: w.ds ?? 0, move: 20, sight: 20, light: 20, sound: 20, flags: w.flags ?? {},
  })));
  const tokens = [];
  for (const t of json.tokens.filter((t) => !t.level)) {
    const friendly = t.disposition === 1;
    let actorId = null;
    if (friendly) {
      const actor = await Actor.create({
        name: t.name, type: actorType, img: imgs[t._id],
        ownership: { default: 0, [player.id]: 3 },
        prototypeToken: { actorLink: true, sight: { enabled: true }, texture: { src: imgs[t._id] } },
        flags: { "foundry-3d-view": { e2e: true } },
      });
      actorId = actor.id;
    }
    tokens.push({
      name: t.name, x: t.x + dx, y: t.y + dy, width: t.width ?? 1, height: t.height ?? 1, elevation: t.elevation ?? 0,
      hidden: !!t.hidden, disposition: t.disposition, actorId, actorLink: friendly,
      texture: { src: imgs[t._id] }, sight: { enabled: friendly }, light: t.light ?? {},
      flags: { "foundry-3d-view": { key: t._id } },
    });
  }
  const tokenDocs = await scene.createEmbeddedDocuments("Token", tokens);
  await scene.createEmbeddedDocuments("Tile", [
    { x: json.tiles[0].x + dx, y: json.tiles[0].y + dy, width: json.tiles[0].width, height: json.tiles[0].height, rotation: 15, texture: { src: rug }, elevation: 0, sort: 1 },
    { x: json.tiles[1].x + dx, y: json.tiles[1].y + dy, width: json.tiles[1].width, height: json.tiles[1].height, texture: { src: roof }, elevation: 20, sort: 2 },
  ]);
  await scene.createEmbeddedDocuments("AmbientLight", json.lights.map((l) => ({ x: l.x + dx, y: l.y + dy, config: l.config })));
  await scene.activate();
  const byKey = Object.fromEntries(tokenDocs.map((d) => [d.getFlag("foundry-3d-view", "key"), d.id]));
  const wallAt = (c) => walls.find((w) => w.c.join() === sx(c).join())?.id;
  return {
    scene: scene.id,
    corridorDoor: wallAt([1500, 700, 1500, 800]), // w15: corridor -> room B
    secretDoor: wallAt([700, 1100, 800, 1100]), // w7: room A -> room C
    tokens: byKey,
    player: player.id,
    sceneX: dim.sceneX,
    sceneY: dim.sceneY,
  };
});
await gm.waitForFunction((id) => canvas.ready && canvas.scene?.id === id, ids.scene, { timeout: 60000 });
await sleep(2500);
check("scene built in Foundry", true, `scene ${ids.scene}, ${Object.keys(ids.tokens).length} tokens`);

/* ------------------------------------------------------------------------------------------ */
/* GM tests                                                                                    */
/* ------------------------------------------------------------------------------------------ */
const toolSel = '[data-tool="f3dToggle"]';
await gm.evaluate(() => ui.controls.activate?.({ control: "tokens" }));
await sleep(500);
const toolVisible = await gm.locator(toolSel).count();
check("cube button in Token controls (v13 getSceneControlButtons)", toolVisible > 0);
if (toolVisible) await gm.locator(toolSel).first().click();
else await gm.evaluate(() => game.modules.get("foundry-3d-view").api.open());
await gm.waitForFunction(() => game.modules.get("foundry-3d-view").api.isOpen, null, { timeout: 30000 });
await gm.waitForFunction(() => !!game.modules.get("foundry-3d-view").api._controller?.interaction, null, { timeout: 60000 });
await sleep(1500);

const gmState = await gm.evaluate(() => {
  const c = game.modules.get("foundry-3d-view").api._controller;
  const v = c.view;
  const sidebar = document.getElementById("sidebar");
  const r = sidebar?.getBoundingClientRect();
  const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + 80) : null;
  const ctrl = document.querySelector("#scene-controls, #controls");
  const btn = ctrl?.querySelector("button, [data-control]");
  const cr = btn?.getBoundingClientRect();
  const hitCtrl = cr ? document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2) : null;
  return {
    overlayAfterBoard: document.getElementById("board")?.nextElementSibling?.id === "f3d-overlay",
    walls: v.walls.size, tokens: v.tokens.size, tiles: v.tiles.size, lights: v.lights.length,
    bgLoaded: !!v.bgTexture, darkness: v.darkness,
    sidebarOnTop: !!hit && !!sidebar?.contains(hit),
    controlsOnTop: !!hitCtrl && !!ctrl?.contains(hitCtrl),
    hud: !!document.querySelector(".f3d-hud"),
  };
});
check("3D overlay opened right after #board", gmState.overlayAfterBoard && gmState.hud);
check("scene loaded into 3D (walls/tokens/tiles/lights/background)", gmState.walls > 20 && gmState.tokens === 5 && gmState.tiles === 2 && gmState.lights >= 4 && gmState.bgLoaded,
  JSON.stringify({ walls: gmState.walls, tokens: gmState.tokens, tiles: gmState.tiles, lights: gmState.lights, bg: gmState.bgLoaded }));
check("Foundry sidebar stays clickable above the overlay", gmState.sidebarOnTop);
check("Foundry scene controls stay clickable above the overlay", gmState.controlsOnTop);
check("darkness read from Foundry", Math.abs(gmState.darkness - 0.3) < 0.05, `darkness ${gmState.darkness}`);
await gm.screenshot({ path: join(shots, "foundry-real-gm.png") });

// Door: update in Foundry -> door swings in 3D
const doorSwing = await gm.evaluate(async (id) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const e = v.walls.get(id);
  if (!e?.door) return "entry=" + JSON.stringify(e && { instanced: e.instanced, data: e.data }) + " doc=" + JSON.stringify(canvas.scene.walls.get(id)?.toObject());
  const before = v.walls.get(id).door.target;
  await canvas.scene.walls.get(id).update({ ds: 1 });
  const after = v.walls.get(id).door.target;
  await canvas.scene.walls.get(id).update({ ds: 0 });
  return Math.abs(after - before - Math.PI / 2) < 1e-6;
}, ids.corridorDoor);
check("updateWall: door swings in 3D", doorSwing === true, typeof doorSwing === "string" ? doorSwing : "");

// Token animation: standee follows refreshToken during Foundry's movement animation
const anim = await gm.evaluate(async (id) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const doc = canvas.scene.tokens.get(id);
  const startX = v.tokens.get(id).target.x;
  // A long explicit animation: headless browsers render few frames, so give Foundry time.
  const p = doc.update({ x: doc.x + 300 }, { animation: { duration: 2500 } });
  const samples = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    samples.push(v.tokens.get(id).target.x);
  }
  await p;
  await new Promise((r) => setTimeout(r, 1200));
  const end = v.tokens.get(id).target.x;
  const mid = samples.some((x) => x > startX + 0.2 && x < startX + 2.8);
  await doc.update({ x: doc.x - 300 }, { animate: false });
  return { startX, end, mid, samples: samples.map((x) => Math.round(x * 100) / 100) };
}, ids.tokens.goblin);
check("updateToken: standee ends on the new square", Math.abs(anim.end - anim.startX - 3) < 0.01, `start ${anim.startX} end ${anim.end}`);
check("refreshToken: standee follows the movement animation", anim.mid, anim.samples.join(","));

// Real mouse: click the hero standee to control it, click a square to move, hover ruler, right-click release
const screenOf = (kind, arg) => gm.evaluate(({ kind, arg }) => {
  const c = game.modules.get("foundry-3d-view").api._controller;
  const v = c.view;
  v.camera.updateMatrixWorld();
  const project = (x, y, z) => {
    const vec = v.camera.position.clone().set(x, y, z).project(v.camera);
    const r = v.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((vec.x + 1) / 2) * r.width, y: r.top + ((1 - vec.y) / 2) * r.height };
  };
  if (kind === "token") {
    const p = v.tokens.get(arg).group.position;
    return project(p.x, p.y + 0.1, p.z);
  }
  if (kind === "door") {
    const m = v.walls.get(arg).mesh;
    const p = m.getWorldPosition(m.position.clone());
    return project(p.x, p.y + 0.4, p.z);
  }
  const g = v.grid;
  const wx = (g.sceneX + (arg.col + 0.5) * g.size - g.centerX) / g.size;
  const wz = (g.sceneY + (arg.row + 0.5) * g.size - g.centerY) / g.size;
  const h = (v.getHeights().data[arg.row * g.cols + arg.col] || 0) / g.distance;
  return project(wx, h, wz);
}, { kind, arg });

// Top-down makes clicks unambiguous.
await gm.locator('.f3d-btn[data-key="topDown"]').click();
await gm.evaluate(() => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  v.resetCamera({ x: 900, y: 800 });
});
await sleep(1500);
let pt = await screenOf("token", ids.tokens.hero);
await gm.mouse.click(pt.x, pt.y);
await sleep(500);
check("click on standee controls the Foundry token", await gm.evaluate((id) => canvas.tokens.get(id)?.controlled, ids.tokens.hero));
check("selection ring shown", await gm.evaluate((id) => game.modules.get("foundry-3d-view").api._controller.view.tokens.get(id).ring.visible, ids.tokens.hero));
pt = await screenOf("cell", { col: 3, row: 3 });
await gm.mouse.move(pt.x, pt.y);
await gm.mouse.move(pt.x + 2, pt.y + 1);
await sleep(400);
const ruler = await gm.evaluate(() => document.querySelector(".f3d-ruler-label")?.textContent ?? "");
check("hover ruler uses Foundry measurement", /ft/.test(ruler), ruler);
await gm.screenshot({ path: join(shots, "foundry-real-ruler.png") });
pt = await screenOf("cell", { col: 7, row: 7 });
await gm.mouse.click(pt.x, pt.y);
await sleep(2500);
const heroPos = await gm.evaluate((id) => ({ x: canvas.scene.tokens.get(id).x, y: canvas.scene.tokens.get(id).y }), ids.tokens.hero);
check("click on a square moves the token in Foundry", heroPos.x === ids.sceneX + 700 && heroPos.y === ids.sceneY + 700, JSON.stringify(heroPos));
await gm.mouse.click(pt.x, pt.y, { button: "right" });
await sleep(400);
check("right-click releases control", await gm.evaluate(() => canvas.tokens.controlled.length === 0));

// Frame the whole map (still top-down) for the next clicks.
await gm.evaluate(() => game.modules.get("foundry-3d-view").api._controller.view.resetCamera());
await sleep(1200);
// Click the corridor door in 3D
pt = await screenOf("door", ids.corridorDoor);
await gm.mouse.click(pt.x, pt.y);
await sleep(800);
check("click on a door opens it in Foundry", await gm.evaluate((id) => canvas.scene.walls.get(id).ds === 1, ids.corridorDoor));
await gm.evaluate((id) => canvas.scene.walls.get(id).update({ ds: 0 }), ids.corridorDoor);

// Paint heights with the real mouse, check the scene flag
await gm.locator('.f3d-btn[data-key="painting"]').click();
pt = await screenOf("cell", { col: 11, row: 9 });
const hBefore = await gm.evaluate(() => canvas.scene.getFlag("foundry-3d-view", "heights").data[9 * 24 + 11]);
await gm.mouse.click(pt.x, pt.y);
await sleep(3000); // debounce + server round trip
const hAfter = await gm.evaluate(() => canvas.scene.getFlag("foundry-3d-view", "heights").data[9 * 24 + 11]);
check("height paint saved to the scene flag", hAfter === hBefore + 2.5, `${hBefore} -> ${hAfter}`);
await gm.locator('.f3d-btn[data-key="undo"]').click();
await sleep(1500);
await sleep(3000); // debounce + server round trip
check("undo restores the scene flag", (await gm.evaluate(() => canvas.scene.getFlag("foundry-3d-view", "heights").data[9 * 24 + 11])) === hBefore);
await gm.locator('.f3d-btn[data-key="painting"]').click();
await gm.locator('.f3d-btn[data-key="topDown"]').click();
await gm.evaluate(() => game.modules.get("foundry-3d-view").api._controller.view.resetCamera());
await sleep(800);

// Cutaway toggle persists as a client setting
await gm.locator('.f3d-btn[data-key="cutaway"]').click();
await sleep(1500);
check("cutaway lowers walls", await gm.evaluate(() => [...game.modules.get("foundry-3d-view").api._controller.view.walls.values()].some((w) => w.cut < 0.5)));
check("cutaway saved to client settings", await gm.evaluate(() => game.settings.get("foundry-3d-view", "cutaway") === true));
await gm.screenshot({ path: join(shots, "foundry-real-cutaway.png") });
await gm.locator('.f3d-btn[data-key="cutaway"]').click();

// Darkness change follows Foundry
await gm.evaluate(() => canvas.scene.update({ environment: { darknessLevel: 0.8 } }));
await sleep(3500);
const dark = await gm.evaluate(() => game.modules.get("foundry-3d-view").api._controller.view.darkness);
check("darkness change reaches the 3D lights", dark > 0.6, `darkness ${dark}`);
await gm.evaluate(() => canvas.scene.update({ environment: { darknessLevel: 0.3 } }));

check("GM sees the hidden token as a ghost", await gm.evaluate((id) => {
  const t = game.modules.get("foundry-3d-view").api._controller.view.tokens.get(id);
  return t.group.visible && t.card.material.opacity < 1;
}, ids.tokens.ghost));

/* ------------------------------------------------------------------------------------------ */
/* Player session                                                                              */
/* ------------------------------------------------------------------------------------------ */
const plCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const pl = await plCtx.newPage();
const plErrors = watchConsole(pl, "player");
await joinAs(pl, "Player");
check("player joined", await pl.evaluate(() => !game.user.isGM));
await closePopups(gm);
await pl.waitForFunction((id) => canvas.scene?.id === id, ids.scene, { timeout: 60000 });
await sleep(2500);
await pl.mouse.click(800, 450); // focus the game board
await pl.keyboard.press("Shift+KeyV");
await pl.waitForFunction(() => game.modules.get("foundry-3d-view").api.isOpen, null, { timeout: 30000 }).catch(() => {});
check("player opens the view with the Shift+V keybinding", await pl.evaluate(() => game.modules.get("foundry-3d-view").api.isOpen));
// Wait until the scene is fully loaded (the toolbar is built after loading).
await pl.waitForFunction(() => !!game.modules.get("foundry-3d-view").api._controller?.interaction, null, { timeout: 60000 });
await sleep(2000);
const plState = await pl.evaluate((ids) => {
  const c = game.modules.get("foundry-3d-view").api._controller;
  const v = c.view;
  const vis = (k) => v.tokens.get(ids.tokens[k])?.group.visible;
  const g = v.grid;
  const st = v.fogStates;
  return {
    fogOn: v.fogUniforms.f3dFogOn.value === 1,
    hero: vis("hero"), mage: vis("mage"), goblin: vis("goblin"), boss: vis("boss"), ghost: vis("ghost"),
    secretIsWall: !v.walls.get(ids.secretDoor)?.door,
    heroCellVisible: st?.[7 * g.cols + 7] === 2,
    roomBUnseen: st?.[10 * g.cols + 19] === 0,
    noPaintTool: !document.querySelector('[data-key="painting"]'),
    foundryAgrees: canvas.tokens.get(ids.tokens.goblin)?.isVisible === false,
  };
}, ids);
check("player: fog of war on", plState.fogOn);
check("player: own tokens visible", plState.hero && plState.mage);
check("player: enemy behind closed door hidden (matches Foundry isVisible)", !plState.goblin && plState.foundryAgrees);
check("player: hidden token not shown", !plState.ghost);
check("player: secret door looks like a wall", plState.secretIsWall);
check("player: fog states (own room visible, closed room unseen)", plState.heroCellVisible && plState.roomBUnseen);
check("player: no GM paint tools", plState.noPaintTool);
await pl.screenshot({ path: join(shots, "foundry-real-player.png") });

// Paused game: player actions are refused.
await gm.evaluate(() => game.togglePause(true, { broadcast: true }));
await sleep(1000);
const pausedRefused = await pl.evaluate(async (ids) => {
  if (!game.paused) return "not paused";
  const c = game.modules.get("foundry-3d-view").api._controller;
  const doc = canvas.scene.tokens.get(ids.tokens.hero);
  const before = doc.x;
  await c._moveToken(ids.tokens.hero, { col: 6, row: 6 });
  await new Promise((r) => setTimeout(r, 600));
  return doc.x === before;
}, ids);
check("player: actions refused while the game is paused", pausedRefused === true, String(pausedRefused));
await gm.evaluate(() => game.togglePause(false, { broadcast: true }));
await sleep(1000);
check("game unpaused by the GM", await pl.evaluate(() => !game.paused));

// Player tries to walk through a wall -> refused; a free move works; opens an unlocked door -> allowed
const plMove = await pl.evaluate(async (ids) => {
  const c = game.modules.get("foundry-3d-view").api._controller;
  const doc = canvas.scene.tokens.get(ids.tokens.hero);
  const before = { x: doc.x, y: doc.y };
  const warned = [];
  const orig = ui.notifications.warn.bind(ui.notifications);
  ui.notifications.warn = (m, o) => { warned.push(m); return orig(m, o); };
  await c._moveToken(ids.tokens.hero, { col: 7, row: 12 }); // through room A's south wall
  await new Promise((r) => setTimeout(r, 800));
  const blocked = doc.x === before.x && doc.y === before.y && warned.some((m) => /wall/i.test(m));
  ui.notifications.warn = orig;
  await c._moveToken(ids.tokens.hero, { col: 6, row: 6 }); // free square in the same room
  await new Promise((r) => setTimeout(r, 2500));
  const moved = doc.x === canvas.dimensions.sceneX + 600 && doc.y === canvas.dimensions.sceneY + 600;
  await c._toggleDoor(ids.corridorDoor);
  await new Promise((r) => setTimeout(r, 800));
  return { blocked, moved, door: canvas.scene.walls.get(ids.corridorDoor).ds };
}, ids);
check("player: move through a wall is refused (wall warning)", plMove.blocked);
check("player: free move from 3D works", plMove.moved);
check("player: can open an unlocked door from 3D", plMove.door === 1, `ds ${plMove.door}`);
await sleep(2500);
// The mage in the corridor now sees into room B
const after = await pl.evaluate((ids) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  return { roomB: v.fogStates?.[5 * v.grid.cols + 15], goblin: v.tokens.get(ids.tokens.goblin).group.visible, boss: v.tokens.get(ids.tokens.boss).group.visible };
}, ids);
check("player: opening the door reveals room B in the fog", after.roomB === 2, JSON.stringify(after));
await pl.screenshot({ path: join(shots, "foundry-real-player-door.png") });

// Live sync: the GM closes the door -> the player's 3D door swings back
await gm.evaluate((id) => canvas.scene.walls.get(id).update({ ds: 0 }), ids.corridorDoor);
await sleep(1500);
check("live sync: GM closes door, player's 3D door follows", await pl.evaluate((id) => {
  const w = game.modules.get("foundry-3d-view").api._controller.view.walls.get(id);
  return Math.abs(w.door.target - w.door.pivot.rotation.y) < 1.6 && canvas.scene.walls.get(id).ds === 0;
}, ids.corridorDoor));
await pl.evaluate((id) => canvas.scene.walls.get(id).update({ ds: 2 }).catch(() => {}), ids.corridorDoor);
await gm.evaluate((id) => canvas.scene.walls.get(id).update({ ds: 2 }), ids.corridorDoor);
await sleep(500);
const locked = await pl.evaluate(async (id) => {
  await game.modules.get("foundry-3d-view").api._controller._toggleDoor(id);
  await new Promise((r) => setTimeout(r, 600));
  return canvas.scene.walls.get(id).ds;
}, ids.corridorDoor);
check("player: locked door stays locked", locked === 2);
await gm.evaluate((id) => canvas.scene.walls.get(id).update({ ds: 0 }), ids.corridorDoor);

// Close from the HUD
await pl.locator(".f3d-close").click();
await sleep(500);
check("close button removes the overlay", await pl.evaluate(() => !document.getElementById("f3d-overlay")));
await gm.evaluate(() => game.modules.get("foundry-3d-view").api.close());

const moduleErrors = [...gmErrors, ...plErrors].filter((e) => /foundry-3d-view|view3d|f3d/i.test(e));
check("no console errors from the module", moduleErrors.length === 0, moduleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
