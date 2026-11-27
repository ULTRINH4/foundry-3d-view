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

let GEN = "v13"; // set from game.release once connected; screenshots are named per version
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

const moduleDeprecations = [];
function watchConsole(page, label) {
  const errors = [];
  page.on("console", (m) => {
    const txt = m.text();
    if (m.type() === "warning" && /deprecat|compatib/i.test(txt) && /foundry-3d-view/.test(txt)) {
      moduleDeprecations.push(`[${label}] ${txt.slice(0, 300)}`);
    }
    if (m.type() !== "error") return;
    const t = m.text();
    errors.push(t);
    if (/foundry-3d-view|f3d|view3d|three/i.test(t)) console.log(`[${label} console.error] ${t.slice(0, 400)}`);
  });
  page.on("pageerror", (e) => {
    errors.push(String(e));
    console.log(`[${label} pageerror] ${(e.stack ?? String(e)).slice(0, 900)}`);
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
      const body = { action: "createWorld", id: WORLD, title: "F3D Test", system: SYSTEM };
      let r = await post(page, "/setup", body); // v13
      if (r.text.includes("Unsupported")) r = await post(page, "/create", body); // v14 moved it to /create
      if ((r.status !== 200 || r.text.includes('"error"')) && !r.text.includes("already exists")) throw new Error("createWorld failed: " + r.text);
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
  // The join form is rendered after load (and v14 can be slow with another session active): retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
    const ok = await page.waitForFunction((name) => [...document.querySelectorAll("select[name=userid] option, select[name=userId] option")].some((o) => o.textContent.trim() === name), userName, { timeout: 20000 }).then(() => true, () => false);
    if (ok) break;
  }
  const userid = await page.evaluate((name) => {
    const opt = [...document.querySelectorAll("select[name=userid] option, select[name=userId] option")].find((o) => o.textContent.trim() === name);
    return opt?.value;
  }, userName);
  if (!userid) {
    const opts = await page.evaluate(() => [...document.querySelectorAll("select[name=userid] option, select[name=userId] option")].map((o) => o.textContent.trim()));
    throw new Error(`user ${userName} not found on /join (options: ${JSON.stringify(opts)})`);
  }
  const r = await post(page, "/join", { action: "join", userid, userId: userid, password: "" }); // v13 userid, v14 userId
  if (r.status !== 200) throw new Error("join failed: " + r.text);
  await page.goto(`${URL}/game`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.game?.ready === true && canvas?.ready, null, { timeout: 120000 });
  await sleep(1500);
  await closePopups(page);
  // Some systems open welcome dialogs (v1 Dialogs) late; keep closing them during the test.
  // The module's own dialogs are ApplicationV2 and are not in ui.windows, so they are untouched.
  await page.evaluate(() => setInterval(() => {
    for (const w of Object.values(ui.windows ?? {})) if (w?.element?.[0]?.getAttribute?.("role") === "dialog" || w?.constructor?.name?.includes("Dialog")) w.close?.();
  }, 500));
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
GEN = "v" + (await gm.evaluate(() => game.release?.generation ?? 13));
console.log(`Foundry ${GEN} (${await gm.evaluate(() => game.version)})`);

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
  const bricks = await upload(art.drawBricks(), "bricks.png");
  const planks = await upload(art.drawPlanks(), "planks.png");
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
  // v14 keeps the background on the scene's level; creating with `background` doesn't fill it.
  if (scene.levels?.size) {
    await scene.initialLevel.update({ background: { src: bg, color: "#121214" }, elevation: { top: 20 } });
  }
  // The sample is authored with 200px padding; Foundry decides the real padding, so shift by it.
  const dim = scene.getDimensions?.() ?? scene.dimensions;
  const dx = dim.sceneX - g.sceneX, dy = dim.sceneY - g.sceneY;
  const sx = (c) => [c[0] + dx, c[1] + dy, c[2] + dx, c[3] + dy];
  const walls = await scene.createEmbeddedDocuments("Wall", json.walls.filter((w) => !w.level).map((w) => ({
    c: sx(w.c), door: w.door ?? 0, ds: w.ds ?? 0, move: w.move ?? 20, sight: w.sight ?? 20, light: w.light ?? 20, sound: 20, flags: w.flags ?? {},
  })));
  const tokens = [];
  for (const t of json.tokens.filter((t) => !t.level)) {
    const friendly = t.disposition === 1;
    // Every token gets an actor (some systems, e.g. CoC7 on v14, throw on actor-less tokens).
    const actor = await Actor.create({
      name: t.name, type: actorType, img: imgs[t._id],
      ownership: friendly ? { default: 0, [player.id]: 3 } : { default: 0 },
      prototypeToken: { actorLink: friendly, sight: { enabled: friendly }, texture: { src: imgs[t._id] } },
      flags: { "foundry-3d-view": { e2e: true } },
    });
    const actorId = actor.id;
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
    bricks,
    planks,
    plainWall: wallAt([400, 400, 1100, 400]), // w1: room A north wall
    windowWall: wallAt([500, 1100, 500, 1600]), // room C west wall (sight: proximity)
    halfWall: wallAt([1600, 900, 1800, 900]), // parapet, 3D height 0.5
    glassWall: wallAt([1600, 1400, 1800, 1400]), // invisible wall (sight: none)
    sceneX: dim.sceneX,
    sceneY: dim.sceneY,
  };
});
await gm.waitForFunction((id) => canvas.ready && canvas.scene?.id === id, ids.scene, { timeout: 60000 }).catch(async () => {
  console.log("scene not viewed yet:", await gm.evaluate(() => JSON.stringify({ ready: canvas.ready, viewed: canvas.scene?.id, loading: canvas.loading })));
  await gm.evaluate((id) => game.scenes.get(id).view(), ids.scene);
  await gm.waitForFunction((id) => canvas.ready && canvas.scene?.id === id, ids.scene, { timeout: 60000 });
});
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
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-gm.png`) });

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
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-ruler.png`) });
pt = await screenOf("cell", { col: 7, row: 7 });
await gm.mouse.click(pt.x, pt.y);
await sleep(2500);
const heroPos = await gm.evaluate((id) => ({ x: canvas.scene.tokens.get(id).x, y: canvas.scene.tokens.get(id).y }), ids.tokens.hero);
check("click on a square moves the token in Foundry", heroPos.x === ids.sceneX + 700 && heroPos.y === ids.sceneY + 700, JSON.stringify(heroPos));
// Right-click on the token opens Foundry's Token HUD at its normal size, around the standee.
pt = await screenOf("token", ids.tokens.hero);
await gm.mouse.click(pt.x, pt.y, { button: "right" });
await sleep(800);
const hudBox = await gm.evaluate((id) => {
  const hud = canvas.tokens.hud;
  const el = hud?.element instanceof HTMLElement ? hud.element : hud?.element?.[0];
  if (!hud?.rendered || !el) return null;
  const btn = el.querySelector(".control-icon");
  const r = el.getBoundingClientRect(), b = btn?.getBoundingClientRect();
  const s = game.modules.get("foundry-3d-view").api._controller.view.tokenScreenRect(id);
  return { w: r.width, h: r.height, btn: b ? Math.round(b.width) : 0, left: r.left, top: r.top, sx: s.x, sy: s.y, sw: s.width };
}, ids.tokens.hero);
check("Token HUD opens at normal size around the standee",
  !!hudBox && hudBox.btn >= 30 && hudBox.left <= hudBox.sx && hudBox.left + hudBox.w >= hudBox.sx + hudBox.sw, JSON.stringify(hudBox));
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-token-hud.png`) });
await gm.evaluate(() => canvas.tokens.hud.close());
await sleep(300);
// Right-click an empty square to release (right-click on a token opens Foundry's Token HUD).
pt = await screenOf("cell", { col: 3, row: 6 });
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

// Walls: The Sims cutaway by default (front walls of each room sink, back walls stay up),
// following the camera; the button cycles cutaway -> down -> up and persists per client.
await sleep(1500);
const sims = await gm.evaluate(async () => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const cutIds = () => new Set([...v.walls].filter(([, w]) => w.cut < 0.5).map(([id]) => id));
  const a = cutIds();
  const out = { mode: v.cutMode, cut: a.size, up: [...v.walls.values()].filter((w) => w.cut > 0.99).length, caps: v.capMesh?.count ?? 0 };
  v.rotateBy(180, { animate: false });
  await new Promise((r) => setTimeout(r, 1500));
  const b = cutIds();
  out.follows = b.size > 0 && [...a].some((id) => !b.has(id)) && [...b].some((id) => !a.has(id));
  v.rotateBy(-180, { animate: false });
  await new Promise((r) => setTimeout(r, 1500));
  return out;
});
check("The Sims cutaway is the default: front walls cut, back walls up", sims.mode === "cutaway" && sims.cut > 0 && sims.up > 0 && sims.caps > 0, JSON.stringify(sims));
check("cutaway follows the camera (turning around swaps front and back walls)", sims.follows);
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-cutaway.png`) });
await gm.locator('.f3d-btn[data-key="cutaway"]').click();
await sleep(1500);
check("walls down: every wall lowered, saved to client settings", await gm.evaluate(() => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  return v.cutMode === "down" && [...v.walls.values()].every((w) => w.height * w.cut <= v.options.cutawayHeight + 0.02) && game.settings.get("foundry-3d-view", "cutMode") === "down";
}));
await gm.locator('.f3d-btn[data-key="cutaway"]').click();
await sleep(1500);
check("walls up: every wall back up", await gm.evaluate(() => [...game.modules.get("foundry-3d-view").api._controller.view.walls.values()].every((w) => w.cut > 0.95)));
await gm.locator('.f3d-btn[data-key="cutaway"]').click();

// Darkness change follows Foundry
await gm.evaluate(() => canvas.scene.update({ environment: { darknessLevel: 0.8 } }));
await sleep(3500);
const dark = await gm.evaluate(() => game.modules.get("foundry-3d-view").api._controller.view.darkness);
check("darkness change reaches the 3D lights", dark > 0.6, `darkness ${dark}`);

// Foundry's rendered lighting and the selected token's vision in 3D (GM)
await gm.evaluate(async () => {
  await canvas.scene.update({ environment: { darknessLevel: 0.85, globalLight: { enabled: false } } });
  canvas.tokens.releaseAll();
});
await sleep(3000);
const cellLight = (c, r) => gm.evaluate(({ c, r }) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const s = v.lightSample;
  if (!s) return null;
  const x = Math.floor((c + 0.5) * s.k), y = Math.floor((r + 0.5) * s.k);
  const i = (y * s.w + x) * 4;
  return { illum: (s.illum[i] + s.illum[i + 1] + s.illum[i + 2]) / 3, color: s.color[i] + s.color[i + 1] + s.color[i + 2] };
}, { c, r });
const lit0 = await gm.evaluate(() => {
  const c = game.modules.get("foundry-3d-view").api._controller;
  return { source: c.view.lightSource, sampling: c._sampling, fog: c.view.fogUniforms.f3dFogOn.value };
});
check("lighting comes from Foundry's own rendering", lit0.source === "foundry" && lit0.sampling, JSON.stringify(lit0));
const heroRoom = await cellLight(5, 5), rock = await cellLight(23, 15), dais = await cellLight(19, 4);
check("room lit by the hero's torch is bright, far rock is dark", heroRoom?.illum > 180 && rock?.illum < 140, JSON.stringify({ heroRoom, rock }));
check("coloured light (torch) reaches the 3D colour map", heroRoom?.color > 10, JSON.stringify(heroRoom));
check("GM without a selected token sees every light (no fog)", lit0.fog === 0 && dais?.illum > 180, JSON.stringify({ dais, fog: lit0.fog }));
// Adaptive: turning the brazier off darkens the dais in 3D
const brazierId = await gm.evaluate(() => canvas.scene.lights.find((l) => l.config.dim === 40 && l.config.bright === 20)?.id);
await gm.evaluate((id) => canvas.scene.lights.get(id).update({ hidden: true }), brazierId);
await sleep(2500);
const daisOff = await cellLight(19, 4);
check("light turned off in Foundry darkens the 3D view", daisOff?.illum < dais.illum - 40, JSON.stringify({ before: dais?.illum, after: daisOff?.illum }));
await gm.evaluate((id) => canvas.scene.lights.get(id).update({ hidden: false }), brazierId);
// Token vision: the GM selects the hero -> 3D shows only what the hero sees
await gm.evaluate((id) => canvas.tokens.get(id).control({ releaseOthers: true }), ids.tokens.hero);
await sleep(3000);
const tv = await gm.evaluate((ids) => {
  const c = game.modules.get("foundry-3d-view").api._controller;
  const v = c.view;
  const g = v.grid;
  return {
    tokenVision: canvas.visibility.tokenVision,
    fog: v.fogUniforms.f3dFogOn.value,
    heroRoom: v.fogStates?.[5 * g.cols + 5],
    roomB: v.fogStates?.[10 * g.cols + 19],
    goblin: v.tokens.get(ids.tokens.goblin).group.visible,
    hero: v.tokens.get(ids.tokens.hero).group.visible,
  };
}, ids);
check("GM selecting a token: 3D fog follows that token's vision", tv.tokenVision && tv.fog === 1 && tv.heroRoom === 2 && tv.roomB !== 2, JSON.stringify(tv));
check("GM selecting a token: tokens it can't see are hidden in 3D", tv.hero && !tv.goblin, JSON.stringify(tv));
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-gm-token-vision.png`) });
await gm.evaluate(() => canvas.tokens.releaseAll());
await sleep(2500);
const tv2 = await gm.evaluate((ids) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  return { fog: v.fogUniforms.f3dFogOn.value, goblin: v.tokens.get(ids.tokens.goblin).group.visible };
}, ids);
check("releasing the token gives the GM the full view back", tv2.fog === 0 && tv2.goblin, JSON.stringify(tv2));
await gm.evaluate(() => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  v.setTopDown(false);
  v.resetCamera();
});
await sleep(1500);
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-foundry-lighting.png`) });
await gm.evaluate(() => canvas.scene.update({ environment: { darknessLevel: 0.3, globalLight: { enabled: true } } }));

// Wall look: default inherits the map; module settings switch to textures; the Wall config sheet
// gets a "3D texture" field whose value overrides one wall.
const keyOf = (id) => gm.evaluate((id) => game.modules.get("foundry-3d-view").api._controller.view.wallMaterialKeyOf(id), id);
check("walls inherit the map by default", (await keyOf(ids.plainWall)) === "map", await keyOf(ids.plainWall));
await gm.evaluate(async (ids) => {
  await game.settings.set("foundry-3d-view", "wallTexture", ids.bricks);
  await game.settings.set("foundry-3d-view", "doorTexture", ids.planks);
  await game.settings.set("foundry-3d-view", "wallMode", "texture");
}, ids);
await sleep(1500);
check("wall/door texture settings apply live", (await keyOf(ids.plainWall)) === `tex:${ids.bricks}` && (await keyOf(ids.corridorDoor)) === `tex:${ids.planks}`,
  `${await keyOf(ids.plainWall)} / ${await keyOf(ids.corridorDoor)}`);
check("wall texture loaded from Foundry", await gm.evaluate((src) => !!game.modules.get("foundry-3d-view").api._controller.view.wallMaterials.get(`tex:${src}`)?.map?.image, ids.bricks));
await gm.evaluate(() => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  v.setTopDown(false);
  v.resetCamera({ x: 1000, y: 800 });
});
await sleep(1500);
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-walls-texture.png`) });

await gm.evaluate((id) => canvas.scene.walls.get(id).sheet.render(true), ids.plainWall);
await gm.waitForSelector('[name="flags.foundry-3d-view.texture"]', { timeout: 15000 }).catch(() => {});
const fieldInfo = await gm.evaluate(() => {
  const el = document.querySelector('[name="flags.foundry-3d-view.texture"]');
  return el ? el.tagName.toLowerCase() : null;
});
check("Wall config sheet has the 3D texture field", !!fieldInfo, String(fieldInfo));
await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-wall-config.png`) });
if (fieldInfo) {
  await gm.evaluate((src) => {
    const el = document.querySelector('[name="flags.foundry-3d-view.texture"]');
    el.value = src;
    const input = el.querySelector?.("input") ;
    if (input) input.value = src;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, ids.planks);
  const form = gm.locator('[name="flags.foundry-3d-view.texture"]').locator("xpath=ancestor::form[1]");
  await form.locator('button[type="submit"]').first().click();
  await sleep(1500);
  const flag = await gm.evaluate((id) => canvas.scene.walls.get(id).getFlag("foundry-3d-view", "texture"), ids.plainWall);
  check("saving the sheet stores the wall flag", flag === ids.planks, String(flag));
  check("per-wall texture overrides the setting in 3D", (await keyOf(ids.plainWall)) === `tex:${ids.planks}`, await keyOf(ids.plainWall));
  await gm.evaluate((id) => canvas.scene.walls.get(id).unsetFlag("foundry-3d-view", "texture"), ids.plainWall);
}
await gm.evaluate(async () => {
  await game.settings.set("foundry-3d-view", "wallMode", "map");
  await game.settings.set("foundry-3d-view", "doorTexture", "");
});
await sleep(800);
check("back to map look", (await keyOf(ids.plainWall)) === "map");

// Wall kinds from real Foundry walls
const kinds = await gm.evaluate((ids) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const w = (id) => v.walls.get(id);
  return {
    window: !!w(ids.windowWall)?.isWindow && w(ids.windowWall).object.children.length === 3,
    glass: !!w(ids.glassWall) && w(ids.glassWall).mesh.material.transparent,
    half: Math.abs((w(ids.halfWall)?.height ?? 0) - 0.5) < 1e-6,
  };
}, ids);
check("window wall drawn with an opening and glass", kinds.window);
check("invisible wall drawn as glass", kinds.glass);
check("half wall (3D height flag) drawn at half height", kinds.half);

// Height field in the Wall config sheet
await gm.evaluate((id) => canvas.scene.walls.get(id).sheet.render(true), ids.plainWall);
await gm.waitForSelector('[name="flags.foundry-3d-view.height"]', { timeout: 15000 }).catch(() => {});
const hasHeightField = await gm.evaluate(() => !!document.querySelector('[name="flags.foundry-3d-view.height"]'));
check("Wall config sheet has the 3D height field", hasHeightField);
if (hasHeightField) {
  await gm.fill('[name="flags.foundry-3d-view.height"]', "0.25");
  await gm.locator('[name="flags.foundry-3d-view.height"]').locator("xpath=ancestor::form[1]").locator('button[type="submit"]').first().click();
  await sleep(1500);
  const h = await gm.evaluate((id) => ({
    flag: canvas.scene.walls.get(id).getFlag("foundry-3d-view", "height"),
    view: game.modules.get("foundry-3d-view").api._controller.view.walls.get(id)?.height,
  }), ids.plainWall);
  check("saving the 3D height stores the flag and lowers the wall", h.flag === 0.25 && Math.abs(h.view - 0.25) < 1e-6, JSON.stringify(h));
  await gm.evaluate((id) => canvas.scene.walls.get(id).unsetFlag("foundry-3d-view", "height"), ids.plainWall);
}

// Bulk tool: select walls in the Walls controls, open the tool, apply "half wall" + texture
await gm.evaluate(() => game.modules.get("foundry-3d-view").api.close());
await gm.evaluate(() => ui.controls.activate?.({ control: "walls" }));
await sleep(800);
await gm.evaluate((ids) => {
  canvas.walls.releaseAll?.();
  for (const id of [ids.plainWall, ids.corridorDoor]) canvas.walls.get(id)?.control({ releaseOthers: false });
}, ids);
const toolBtn = gm.locator('[data-tool="f3dWallStyle"]');
check("bulk wall tool button in Walls controls", (await toolBtn.count()) > 0);
if (await toolBtn.count()) {
  await toolBtn.first().click();
  await gm.waitForSelector('select[name="preset"]', { timeout: 10000 }).catch(() => {});
  await gm.selectOption('select[name="preset"]', "half").catch(() => {});
  await gm.evaluate((src) => {
    const el = document.querySelector('dialog [name="texture"], .application [name="texture"]');
    if (el) { el.value = src; el.querySelector?.("input") && (el.querySelector("input").value = src); }
  }, ids.bricks);
  await gm.locator('button[data-action="apply"]').first().click().catch(() => {});
  await sleep(1500);
  const bulk = await gm.evaluate((ids) => [ids.plainWall, ids.corridorDoor].map((id) => {
    const d = canvas.scene.walls.get(id);
    return { h: d.getFlag("foundry-3d-view", "height"), t: d.getFlag("foundry-3d-view", "texture") };
  }), ids);
  check("bulk tool applies height + texture to all selected walls", bulk.every((b) => b.h === 0.5 && b.t === ids.bricks), JSON.stringify(bulk));
  await gm.evaluate(async (ids) => {
    await canvas.scene.updateEmbeddedDocuments("Wall", [ids.plainWall, ids.corridorDoor].map((id) => ({
      _id: id, "flags.foundry-3d-view.-=height": null, "flags.foundry-3d-view.-=texture": null,
    })));
    canvas.walls.releaseAll?.();
  }, ids);
}
await gm.evaluate(() => ui.controls.activate?.({ control: "tokens" }));
await gm.evaluate(() => game.modules.get("foundry-3d-view").api.open());
await gm.waitForFunction(() => !!game.modules.get("foundry-3d-view").api._controller?.interaction, null, { timeout: 60000 });
await sleep(1500);

// 3D models: export the built-ins as .glb through the Tiles tool, then use one as a custom model
const exported = await gm.evaluate(() => game.modules.get("foundry-3d-view").api.exportModels());
check("built-in models exported as .glb files", Array.isArray(exported) && exported.length >= 10, String(exported?.length));
const models = await gm.evaluate(async (files) => {
  const dim = canvas.dimensions;
  const [builtin, custom] = await canvas.scene.createEmbeddedDocuments("Tile", [
    { x: dim.sceneX + 1000, y: dim.sceneY + 100, width: 100, height: 100, flags: { "foundry-3d-view": { model: "tree" } } },
    { x: dim.sceneX + 1200, y: dim.sceneY + 100, width: 100, height: 100, flags: { "foundry-3d-view": { modelFile: files.find((f) => f.endsWith("crate.glb")) } } },
  ]);
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  // Custom models load asynchronously: wait for them (up to ~10 s on a slow headless machine).
  for (let i = 0; i < 40 && !(v.tiles.get(custom.id)?.mesh && v.tiles.get(builtin.id)?.isModel); i++) await new Promise((ok) => setTimeout(ok, 250));
  const a = v.tiles.get(builtin.id), b = v.tiles.get(custom.id);
  const meshes = (e) => { let n = 0; e?.mesh?.traverse((o) => o.isMesh && n++); return n; };
  const out = { builtin: !!a?.isModel && meshes(a) > 0, custom: !!b?.isModel && meshes(b) > 0, file: custom.getFlag("foundry-3d-view", "modelFile"), customEntry: !!b, customMesh: !!b?.mesh };
  await canvas.scene.deleteEmbeddedDocuments("Tile", [builtin.id, custom.id]);
  return out;
}, exported ?? []);
check("tile with a built-in 3D model rendered", models.builtin);
check("tile with an exported .glb (custom model) loaded and rendered", models.custom, JSON.stringify(models));

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
await pl.waitForFunction(() => !!game.modules.get("foundry-3d-view").api._controller?.interaction, null, { timeout: 60000 }).catch(async (e) => {
  console.log("player load stuck:", await pl.evaluate(() => {
    const c = game.modules.get("foundry-3d-view").api._controller;
    return JSON.stringify({ open: c.isOpen, opening: !!c._opening, view: !!c.view, model: !!c.model, hud: !!c.hud, bg: c.view?.bgTexture ? 1 : 0,
      canvasReady: canvas.ready, scene: canvas.scene?.name, level: canvas.level?.id, overlay: !!document.getElementById("f3d-overlay") });
  }));
  throw e;
});
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
await pl.screenshot({ path: join(shots, `foundry-real-${GEN}-player.png`) });

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
check("game unpaused by the GM", await pl.waitForFunction(() => !game.paused, null, { timeout: 8000 }).then(() => true, () => false));

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

// Fire Emblem-style movement: blue/red squares, keyboard cursor, walk along a path, out of range refused
const fe = await pl.evaluate(async (ids) => {
  const c = game.modules.get("foundry-3d-view").api._controller;
  const it = c.interaction, v = c.view;
  const doc = canvas.scene.tokens.get(ids.tokens.hero);
  canvas.tokens.get(ids.tokens.hero).control({ releaseOthers: true });
  await new Promise((r) => setTimeout(r, 300));
  it.refresh();
  const out = { blue: v.moveMesh?.visible ? v.moveMesh.count : 0, red: v.attackMesh?.count ?? 0 };
  out.wallBlocks = !it.range?.reach?.has(12 * v.grid.cols + 7); // south of room A's wall
  it.setHovering(true);
  // Dispatched on the body like a real key press (window capture runs before Foundry's handler).
  const key = (code) => document.body.dispatchEvent(new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true }));
  key("ArrowLeft");
  const c0 = { ...it.cursor };
  key("ArrowLeft");
  const c1 = { ...it.cursor };
  out.cursorMoves = Math.abs(c1.col - c0.col) + Math.abs(c1.row - c0.row) === 1;
  out.path = !!v.pathMesh?.visible;
  const target = { ...it.cursor };
  const start = { x: doc.x, y: doc.y };
  const moves = [];
  const hook = Hooks.on("updateToken", (d, ch) => { if (d.id === doc.id && ("x" in ch || "y" in ch)) moves.push([ch.x ?? d.x, ch.y ?? d.y]); });
  key("Enter");
  await new Promise((r) => setTimeout(r, 3500));
  Hooks.off("updateToken", hook);
  const g = canvas.dimensions;
  out.arrived = doc.x === g.sceneX + target.col * g.size && doc.y === g.sceneY + target.row * g.size;
  out.movedFrom = start;
  out.target = target;
  // Far away square: refused with a warning
  const warned = [];
  const orig = ui.notifications.warn.bind(ui.notifications);
  ui.notifications.warn = (m, o) => { warned.push(m); return orig(m, o); };
  for (let i = 0; i < 14; i++) key("ArrowDown");
  for (let i = 0; i < 14; i++) key("ArrowRight");
  const before = { x: doc.x, y: doc.y };
  key("Enter");
  await new Promise((r) => setTimeout(r, 1200));
  ui.notifications.warn = orig;
  out.farRefused = doc.x === before.x && doc.y === before.y && warned.length > 0;
  out.ctlBeforeEsc = canvas.tokens.controlled.length;
  key("Escape");
  await new Promise((r) => setTimeout(r, 300));
  out.cleared = !v.moveMesh?.visible;
  out.menuOpened = !!ui.menu?.rendered;
  if (out.menuOpened) ui.menu.close();
  it.setHovering(false);
  return out;
}, ids);
check("FE: selecting a token shows blue and red squares", fe.blue > 5 && fe.red > 0, JSON.stringify(fe));
check("FE: walls limit the blue squares", fe.wallBlocks);
check("FE: keyboard cursor moves one square", fe.cursorMoves);
check("FE: yellow path arrow to the cursor", fe.path);
check("FE: Enter walks the token to the cursor", fe.arrived, JSON.stringify(fe.target));
check("FE: player can't move out of range", fe.farRefused);
check("FE: Esc clears the range (and Foundry's menu stays closed)", fe.cleared && !fe.menuOpened, `controlled ${fe.ctlBeforeEsc}`);
check("player: can open an unlocked door from 3D", plMove.door === 1, `ds ${plMove.door}`);
await sleep(2500);
// The mage in the corridor now sees into room B
const after = await pl.evaluate((ids) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  return { roomB: v.fogStates?.[5 * v.grid.cols + 15], goblin: v.tokens.get(ids.tokens.goblin).group.visible, boss: v.tokens.get(ids.tokens.boss).group.visible };
}, ids);
check("player: opening the door reveals room B in the fog", after.roomB === 2, JSON.stringify(after));
await pl.screenshot({ path: join(shots, `foundry-real-${GEN}-player-door.png`) });

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

// Close from the HUD (system welcome dialogs can pop up late: close them first)
await closePopups(pl);
await pl.locator(".f3d-close").click();
await sleep(500);
check("close button removes the overlay", await pl.evaluate(() => !document.getElementById("f3d-overlay")));
await gm.evaluate(() => game.modules.get("foundry-3d-view").api.close());

/* ------------------------------------------------------------------------------------------ */
/* Foundry v14: native scene levels                                                            */
/* ------------------------------------------------------------------------------------------ */
if (GEN >= "v14") {
  await gm.evaluate(() => game.modules.get("foundry-3d-view").api.close());
  await pl.evaluate(() => game.modules.get("foundry-3d-view").api.close());
  const lv = await gm.evaluate(async (ids) => {
    const old = game.scenes.getName("F3D Levels");
    if (old) await old.delete();
    const dungeon = canvas.scene.initialLevel.background.src;
    const MOD = "/modules/foundry-3d-view";
    const art = await import(`${MOD}/dev/art.mjs`);
    const { modelFromJSON } = await import(`${MOD}/scripts/core/scene-model.mjs`);
    const json = await fetch(`${MOD}/dev/sample-scene.json`).then((r) => r.json());
    const FP = foundry.applications.apps.FilePicker.implementation;
    const blob = await new Promise((ok) => art.drawBalcony(modelFromJSON(json)).toBlob(ok, "image/png"));
    await FP.upload("data", "f3d-assets", new File([blob], "balcony.png", { type: "image/png" }), {}, { notify: false });
    const scene = await Scene.create({
      name: "F3D Levels", width: 2400, height: 1600, padding: 0.08, tokenVision: true,
      grid: { size: 100, type: 1, distance: 5, units: "ft" },
      environment: { darknessLevel: 0, globalLight: { enabled: true } },
    });
    const ground = scene.initialLevel;
    await ground.update({ name: "Ground", background: { src: dungeon }, elevation: { bottom: 0, top: 10 } });
    const [upper] = await scene.createEmbeddedDocuments("Level", [
      { name: "Balcony", elevation: { bottom: 10, top: 20 }, background: { src: "f3d-assets/balcony.png" }, sort: 1 },
    ]);
    const dim = scene.getDimensions?.() ?? scene.dimensions;
    const X = (v) => dim.sceneX + v * 100, Y = (v) => dim.sceneY + v * 100;
    const walls = await scene.createEmbeddedDocuments("Wall", [
      { c: [X(2), Y(2), X(9), Y(2)], levels: [ground.id] },
      { c: [X(18), Y(8), X(22), Y(8)], levels: [upper.id] },
    ]);
    const actorType = game.documentTypes.Actor.find((t) => t !== "base");
    const player = game.users.getName("Player");
    const hero = await Actor.create({ name: "LvHero", type: actorType, ownership: { default: 0, [player.id]: 3 }, prototypeToken: { actorLink: true, sight: { enabled: true } }, flags: { "foundry-3d-view": { e2e: true } } });
    const foe = await Actor.create({ name: "LvArcher", type: actorType, flags: { "foundry-3d-view": { e2e: true } } });
    const toks = await scene.createEmbeddedDocuments("Token", [
      { name: "LvHero", actorId: hero.id, actorLink: true, x: X(5), y: Y(5), level: ground.id, sight: { enabled: true }, disposition: 1, texture: { src: canvas.scene.tokens.contents[0].texture.src } },
      { name: "LvArcher", actorId: foe.id, x: X(20), y: Y(10), elevation: 10, level: upper.id, disposition: -1, texture: { src: canvas.scene.tokens.contents[1].texture.src } },
    ]);
    await scene.activate();
    // Look documents up by content: creation order is not guaranteed.
    const byName = (n) => toks.find((t) => t.name === n)?.id;
    const wallOn = (lid) => walls.find((w) => w.levels.has(lid))?.id;
    return { scene: scene.id, ground: ground.id, upper: upper.id, groundWall: wallOn(ground.id), upperWall: wallOn(upper.id), hero: byName("LvHero"), archer: byName("LvArcher") };
  }, ids);
  const viewScene = async (page) => {
    await page.waitForFunction((id) => canvas.ready && canvas.scene?.id === id, lv.scene, { timeout: 30000 }).catch(async () => {
      await page.evaluate((id) => game.scenes.get(id).view(), lv.scene);
      await page.waitForFunction((id) => canvas.ready && canvas.scene?.id === id, lv.scene, { timeout: 60000 });
    });
    await sleep(1500);
  };
  await viewScene(gm);
  // GM views the ground level
  await gm.evaluate((lv) => (canvas.level?.id === lv.ground ? null : canvas.scene.view({ level: lv.ground })), lv);
  await gm.waitForFunction((id) => canvas.ready && canvas.level?.id === id, lv.ground, { timeout: 60000 });
  await sleep(1000);
  await gm.evaluate(() => game.modules.get("foundry-3d-view").api.open());
  await gm.waitForFunction(() => !!game.modules.get("foundry-3d-view").api._controller?.interaction, null, { timeout: 60000 });
  await sleep(2500);
  const onGround = await gm.evaluate((lv) => {
    const c = game.modules.get("foundry-3d-view").api._controller;
    const v = c.view;
    return {
      levels: c.model.levels.map((l) => l.name).join(","),
      viewed: c.model.viewedLevelIndex,
      floors: v.levelFloors.length,
      upperFloorVisible: v.levelFloors.some((f) => f.mesh.visible),
      archerVisible: v.tokens.get(lv.archer)?.group.visible,
      heroVisible: v.tokens.get(lv.hero)?.group.visible,
      upperWallShown: v.isWallShown(lv.upperWall),
      groundWallShown: v.isWallShown(lv.groundWall),
      archerY: v.tokens.get(lv.archer)?.target.y,
      selector: document.querySelector(".f3d-level")?.value,
      bg: !!v.bgTexture,
    };
  }, lv);
  check("v14 levels: both levels read from the scene", onGround.levels === "Ground,Balcony" && onGround.floors === 1 && onGround.bg, JSON.stringify(onGround));
  check("v14 levels: viewing the ground hides the floor above", onGround.viewed === 0 && !onGround.upperFloorVisible && !onGround.archerVisible && !onGround.upperWallShown && onGround.groundWallShown && onGround.heroVisible);
  check("v14 levels: selector starts at the viewed level", onGround.selector === "0", String(onGround.selector));
  check("v14 levels: upper token stands at its level height", Math.abs(onGround.archerY - 2) < 1e-6, String(onGround.archerY));
  await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-levels-ground.png`) });

  // Switch the viewed level in Foundry: the 3D view follows
  await gm.evaluate((lv) => canvas.scene.view({ level: lv.upper }), lv);
  await gm.waitForFunction((id) => canvas.ready && canvas.level?.id === id, lv.upper, { timeout: 60000 });
  await gm.waitForFunction((id) => game.modules.get("foundry-3d-view").api._controller?.model?.viewedLevelIndex === 1, null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  const onUpper = await gm.evaluate((lv) => {
    const c = game.modules.get("foundry-3d-view").api._controller;
    const v = c.view;
    return {
      open: c.isOpen,
      viewed: c.model?.viewedLevelIndex,
      upperFloorVisible: v?.levelFloors.some((f) => f.mesh.visible),
      archerVisible: v?.tokens.get(lv.archer)?.group.visible,
      upperWallShown: v?.isWallShown(lv.upperWall),
      roofHeight: c.model?.foregroundElevation,
    };
  }, lv);
  check("v14 levels: changing the viewed level keeps the 3D view open and follows it", onUpper.open && onUpper.viewed === 1, JSON.stringify(onUpper));
  check("v14 levels: upper level floor, wall and token now shown", onUpper.upperFloorVisible && onUpper.archerVisible && onUpper.upperWallShown);
  check("v14 levels: roof height follows the viewed level", onUpper.roofHeight === 20, String(onUpper.roofHeight));
  await gm.screenshot({ path: join(shots, `foundry-real-${GEN}-levels-upper.png`) });

  // Level edits rebuild the view
  await gm.evaluate((lv) => canvas.scene.levels.get(lv.upper).update({ name: "Balcony 2" }), lv);
  await sleep(2500);
  check("v14 levels: editing a level rebuilds the view", await gm.evaluate(() => game.modules.get("foundry-3d-view").api._controller.model?.levels?.[1]?.name === "Balcony 2"));
  await gm.evaluate((lv) => canvas.scene.view({ level: lv.ground }), lv);
  await gm.waitForFunction((id) => canvas.ready && canvas.level?.id === id, lv.ground, { timeout: 60000 });

  // Player on the ground level: the enemy upstairs has no placeable and must stay hidden
  await viewScene(pl);
  await pl.evaluate(() => game.modules.get("foundry-3d-view").api.open());
  await pl.waitForFunction(() => !!game.modules.get("foundry-3d-view").api._controller?.interaction, null, { timeout: 60000 });
  await sleep(2500);
  const plLv = await pl.evaluate((lv) => {
    const c = game.modules.get("foundry-3d-view").api._controller;
    c.syncVisibility();
    const v = c.view;
    return {
      viewedLevel: canvas.level?.id === lv.ground,
      archerPlaceable: !!canvas.tokens.get(lv.archer),
      archerVisible: v.tokens.get(lv.archer)?.group.visible,
      heroVisible: v.tokens.get(lv.hero)?.group.visible,
    };
  }, lv);
  check("v14 levels (player): token on another level has no placeable and stays hidden", plLv.viewedLevel && !plLv.archerPlaceable && !plLv.archerVisible && plLv.heroVisible, JSON.stringify(plLv));
  await pl.screenshot({ path: join(shots, `foundry-real-${GEN}-levels-player.png`) });
  await pl.evaluate(() => game.modules.get("foundry-3d-view").api.close());
  await gm.evaluate(() => game.modules.get("foundry-3d-view").api.close());
}
check("no deprecation warnings caused by the module", moduleDeprecations.length === 0, moduleDeprecations.slice(0, 2).join(" | "));

const moduleErrors = [...gmErrors, ...plErrors].filter((e) => /foundry-3d-view|view3d|f3d/i.test(e));
check("no console errors from the module", moduleErrors.length === 0, moduleErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
