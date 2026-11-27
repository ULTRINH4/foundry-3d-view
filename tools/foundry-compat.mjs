// Compatibility test against a REAL Foundry server with other modules installed:
// Sequencer (combat animations), Carousel Combat Tracker (combat-tracker-dock), Token Action HUD,
// Foundry's combat tracker and Token HUD. Run `npm run e2e` first (it builds the "F3D Sample" scene).
//   FOUNDRY_URL=http://localhost:30015 node tools/foundry-compat.mjs
// Modules found in the data folder are enabled for the test world; missing ones are skipped.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL = process.env.FOUNDRY_URL ?? "http://localhost:30015";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "dev", "screenshots");
mkdirSync(shots, { recursive: true });
const browserPath = [process.env.BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"]
  .filter(Boolean).find((p) => existsSync(p));
const WANTED = ["sequencer", "combat-tracker-dock", "socketlib", "lib-wrapper", "token-action-hud-core", "token-action-hud-coc7"];

const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && /foundry-3d-view|view3d|effects-bridge/.test(m.text()) && errors.push(m.text()));

async function joinGM() {
  for (let i = 0; i < 4; i++) {
    await page.goto(`${URL}/join`, { waitUntil: "networkidle" });
    if (await page.waitForFunction(() => document.querySelectorAll("select[name=userId] option, select[name=userid] option").length > 1, null, { timeout: 20000 }).then(() => true, () => false)) break;
  }
  const uid = await page.evaluate(() => [...document.querySelectorAll("select[name=userId] option, select[name=userid] option")].find((o) => o.textContent.trim() === "Gamemaster").value);
  await page.evaluate(async (uid) => fetch("/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", userId: uid, userid: uid, password: "" }) }), uid);
  await page.goto(`${URL}/game`);
  await page.waitForFunction(() => globalThis.game?.ready && canvas?.ready, null, { timeout: 120000 });
  await page.addStyleTag({ content: "#notifications { display: none !important; }" });
  await sleep(1500);
}

await joinGM();
const gen = await page.evaluate(() => game.release.generation);
console.log(`Foundry v${gen}`);
const enabled = await page.evaluate(async (wanted) => {
  const cfg = game.settings.get("core", "moduleConfiguration");
  const avail = wanted.filter((id) => game.modules.has(id));
  const missing = avail.filter((id) => !cfg[id]);
  if (missing.length) await game.settings.set("core", "moduleConfiguration", { ...cfg, ...Object.fromEntries(avail.map((id) => [id, true])) });
  return { avail, changed: missing.length > 0 };
}, WANTED);
if (enabled.changed) {
  await page.reload();
  await page.waitForFunction(() => globalThis.game?.ready && canvas?.ready, null, { timeout: 120000 });
  await page.addStyleTag({ content: "#notifications { display: none !important; }" });
  await sleep(2500);
}
const active = await page.evaluate((wanted) => wanted.filter((id) => game.modules.get(id)?.active), WANTED);
console.log("active modules:", active.join(", "));
await page.evaluate(async () => {
  for (const w of Object.values(ui.windows ?? {})) await w.close?.().catch?.(() => {});
  for (const app of foundry.applications.instances?.values?.() ?? []) if (app.hasFrame && app.rendered && !String(app.id).startsWith("sidebar")) await app.close?.().catch?.(() => {});
  const s = game.scenes.getName("F3D Sample");
  if (s && canvas.scene?.id !== s.id) await s.view();
});
await page.waitForFunction(() => canvas.ready && canvas.scene?.name === "F3D Sample", null, { timeout: 60000 });
await sleep(1500);
const ids = await page.evaluate(() => {
  const by = (n) => canvas.scene.tokens.find((t) => t.name === n)?.id;
  return { hero: by("Hero"), goblin: by("Goblin"), mage: by("Mage") };
});
await page.evaluate(() => game.togglePause(false, { broadcast: true }));
await page.evaluate(() => game.modules.get("foundry-3d-view").api.open());
await page.waitForFunction(() => !!game.modules.get("foundry-3d-view").api._controller?.interaction, null, { timeout: 60000 });
await sleep(2000);

/* --- Sequencer / combat animations ------------------------------------------------------------ */
if (active.includes("sequencer")) {
  await page.evaluate(async (ids) => {
    const tok = canvas.tokens.get(ids.hero);
    const target = canvas.tokens.get(ids.goblin);
    new Sequence().effect().file("modules/sequencer/samples/fire.webm").atLocation(tok).stretchTo(target).duration(6000).play();
  }, ids);
  await sleep(1500);
  const fx = await page.evaluate((ids) => {
    const v = game.modules.get("foundry-3d-view").api._controller.view;
    const list = [...v.effects.values()];
    const m = list[0]?.mesh;
    const hero = v.tokens.get(ids.hero).group.position, gob = v.tokens.get(ids.goblin).group.position;
    const mid = { x: (hero.x + gob.x) / 2, z: (hero.z + gob.z) / 2 };
    return {
      count: list.length, visible: !!m?.visible, video: list[0]?.source?.tagName,
      nearMid: m ? Math.hypot(m.position.x - mid.x, m.position.z - mid.z) : null,
      length: m ? m.scale.x : null, expected: Math.hypot(hero.x - gob.x, hero.z - gob.z),
    };
  }, ids);
  check("Sequencer effect mirrored in 3D", fx.count >= 1 && fx.visible && fx.video === "VIDEO", JSON.stringify(fx));
  check("stretchTo effect placed between the two tokens", fx.nearMid !== null && fx.nearMid < 1.5, String(fx.nearMid));
  await page.evaluate(() => {
    const v = game.modules.get("foundry-3d-view").api._controller.view;
    v.setTopDown(false);
    v.resetCamera({ x: 1300, y: 1000 });
  });
  await sleep(800);
  await page.screenshot({ path: join(shots, `foundry-real-v${gen}-sequencer.png`) });
  await page.evaluate(() => Sequencer.EffectManager.endAllEffects());
  await sleep(1500);
  check("ended effect removed from 3D", await page.evaluate(() => game.modules.get("foundry-3d-view").api._controller.view.effects.size === 0));
} else console.log("skip: sequencer not installed");

/* --- Combat ----------------------------------------------------------------------------------- */
await page.evaluate(async (ids) => {
  for (const c of game.combats.contents) await c.delete();
  const combat = await Combat.create({ scene: canvas.scene.id, active: true });
  await combat.createEmbeddedDocuments("Combatant", [
    { tokenId: ids.hero, sceneId: canvas.scene.id, initiative: 20 },
    { tokenId: ids.goblin, sceneId: canvas.scene.id, initiative: 10 },
  ]);
  await combat.startCombat();
}, ids);
await sleep(4000);
const c1 = await page.evaluate(() => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const id = game.combat.combatant.tokenId;
  const p = v.tokens.get(id).group.position;
  return { active: v.activeTokenId, current: id, ring: !!v.activeRing?.visible, dist: Math.hypot(v.controls.target.x - p.x, v.controls.target.z - p.z) };
});
check("combat start: active combatant marked in 3D", c1.active === c1.current && c1.ring, JSON.stringify(c1));
check("combat start: camera pans to the active combatant", c1.dist < 0.5, String(c1.dist));
await page.evaluate(() => game.combat.nextTurn());
await sleep(4000);
const c2 = await page.evaluate(() => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const id = game.combat.combatant.tokenId;
  const p = v.tokens.get(id).group.position;
  return { active: v.activeTokenId, current: id, dist: Math.hypot(v.controls.target.x - p.x, v.controls.target.z - p.z) };
});
check("next turn: marker and camera follow the new combatant", c2.active === c2.current && c2.dist < 0.5, JSON.stringify(c2));

// Combat UIs stay on top of the 3D overlay
await page.evaluate(() => {
  ui.sidebar?.expand?.();
  ui.sidebar?.changeTab?.("combat", "primary") ?? ui.sidebar?.activateTab?.("combat");
});
await sleep(2500); // let the sidebar finish sliding open
const ui1 = await page.evaluate(() => {
  const onTop = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 30));
    return !!hit && el.contains(hit);
  };
  const tracker = document.querySelector("#sidebar #combat") ?? (ui.combat?.element instanceof HTMLElement ? ui.combat.element : ui.combat?.element?.[0]);
  const dock = document.querySelector("#combat-dock, .combat-dock");
  const tah = document.querySelector("#token-action-hud");
  return { tracker: onTop(tracker), dock: onTop(dock), tah: tah ? onTop(tah) : "absent" };
});
check("combat tracker (sidebar) visible above the 3D view", ui1.tracker === true, JSON.stringify(ui1));
if (active.includes("combat-tracker-dock")) check("Carousel Combat Tracker dock visible above the 3D view", ui1.dock === true, String(ui1.dock));
if (ui1.tah !== "absent") check("Token Action HUD visible above the 3D view", ui1.tah === true, String(ui1.tah));
await page.screenshot({ path: join(shots, `foundry-real-v${gen}-combat.png`) });

/* --- Token HUD over the standee ---------------------------------------------------------------- */
await page.evaluate((id) => {
  const v = game.modules.get("foundry-3d-view").api._controller.view;
  const doc = canvas.scene.tokens.get(id);
  v.setTopDown(true);
  v.resetCamera({ x: doc.x + 50, y: doc.y + 50 });
}, ids.hero);
await sleep(1500);
const pt = await page.evaluate((id) => {
  const r = game.modules.get("foundry-3d-view").api._controller.view.tokenScreenRect(id);
  return r && { x: r.x + r.width / 2, y: r.y + r.height / 2, rect: r };
}, ids.hero);
if (pt) {
  await page.mouse.click(pt.x, pt.y, { button: "right" });
  await sleep(1200);
  const hud = await page.evaluate((id) => {
    const h = canvas.tokens.hud ?? canvas.hud?.token;
    const el = h?.element instanceof HTMLElement ? h.element : h?.element?.[0];
    const r = el?.getBoundingClientRect();
    return { rendered: !!h?.rendered, bound: h?.object?.document?.id === id, rect: r && { x: r.x, y: r.y, w: r.width, h: r.height }, glued: el?.dataset.f3d === "1", style: el?.getAttribute("style") };
  }, ids.hero);
  const overlap = hud.rect && hud.rect.x < pt.rect.x + pt.rect.width && hud.rect.x + hud.rect.w > pt.rect.x && hud.rect.y < pt.rect.y + pt.rect.height && hud.rect.y + hud.rect.h > pt.rect.y;
  check("right-click on a standee opens Foundry's Token HUD for that token", hud.rendered && hud.bound, JSON.stringify(hud));
  check("Token HUD is positioned over the 3D standee", hud.glued && overlap, JSON.stringify({ hud: hud.rect, standee: pt.rect }));
  await page.screenshot({ path: join(shots, `foundry-real-v${gen}-token-hud.png`) });
  await page.evaluate(() => (canvas.tokens.hud ?? canvas.hud?.token)?.close?.());
}

await page.evaluate(async () => {
  await game.combat?.delete();
  game.modules.get("foundry-3d-view").api.close();
});
check("no errors from the module", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
