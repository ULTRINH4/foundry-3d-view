/**
 * Standalone dev page: renders dev/sample-scene.json with the same renderer and HUD the module
 * uses inside Foundry. Map and token art are generated on a canvas so the repo carries no images.
 *
 * URL params: ?topdown=1  ?player=1  ?az=<deg>  ?paint=1
 */
import { View3D } from "../scripts/render/view3d.mjs";
import { createHud } from "../scripts/ui/hud.mjs";
import { modelFromJSON } from "../scripts/core/scene-model.mjs";
import { wallRegions, getHeight } from "../scripts/core/heights.mjs";

const params = new URLSearchParams(location.search);
const [json, lang] = await Promise.all([
  fetch("./sample-scene.json").then((r) => r.json()),
  fetch("../lang/en.json").then((r) => r.json()),
]);
const t = (k) => lang[k] ?? k;

const model = modelFromJSON(json);
model.background.src = drawDungeon(model);
for (const tok of model.tokens) tok.src = drawToken(tok);

const overlay = document.getElementById("f3d-overlay");
const view = new View3D(overlay.querySelector(".f3d-viewport"), { isGM: true, preserveDrawingBuffer: true });
await view.load(model);

let playerView = params.has("player");
const applyVisibility = () => {
  for (const tok of model.tokens) {
    // In Foundry this comes from Token#isVisible; here hidden tokens stand in for "not seen".
    view.setTokenVisibility(tok.id, playerView ? !tok.hidden : true, !playerView && tok.hidden);
  }
  document.getElementById("dev-status").textContent = playerView ? "Viewing as player" : "Viewing as GM";
};
applyVisibility();

const hud = createHud(overlay, {
  view,
  t,
  isGM: true,
  step: 2.5,
  unitLabel: "ft",
  getWalls: () => model.walls,
  onHeightsChanged: (h) => (model.heights = h),
});

if (params.has("az")) view.rotateBy(Number(params.get("az")));
if (params.has("topdown")) hud.element.querySelector(".f3d-btn").click();
if (params.has("paint")) hud.element.querySelector(".f3d-paint .f3d-btn").click();

// --- simulated hooks -------------------------------------------------------------------------
document.getElementById("dev-door").addEventListener("click", () => {
  const door = model.walls.find((w) => w.id === "w15");
  door.ds = door.ds === 1 ? 0 : 1;
  view.upsertWall({ ...door });
});
let heroStep = 0;
document.getElementById("dev-move").addEventListener("click", () => {
  const hero = model.tokens.find((tk) => tk.id === "hero");
  const path = [[6, 5], [7, 6], [8, 5], [5, 5]];
  const [c, r] = path[heroStep++ % path.length];
  hero.x = model.grid.sceneX + c * model.grid.size;
  hero.y = model.grid.sceneY + r * model.grid.size;
  view.moveToken("hero", { x: hero.x, y: hero.y });
});
document.getElementById("dev-player").addEventListener("click", () => {
  playerView = !playerView;
  applyVisibility();
});

window.__f3d = { view, model };

// ?selftest=1 exercises the live-update paths and writes the result into <body data-selftest>.
if (params.has("selftest")) {
  const results = {};
  const door = view.walls.get("w15");
  const before = door.door.target;
  document.getElementById("dev-door").click();
  results.doorSwings = Math.abs(view.walls.get("w15").door.target - before - Math.PI / 2) < 1e-6;
  document.getElementById("dev-move").click();
  const hero = view.tokens.get("hero");
  results.heroTargetMoved = Math.abs(hero.target.x - (6.5 - 12)) < 1e-6;
  const r = view.renderer.domElement.getBoundingClientRect();
  const cell = view.pickCell(r.left + r.width / 2, r.top + r.height / 2);
  results.pickedCell = !!cell;
  const canvas = view.renderer.domElement;
  canvas.setPointerCapture = canvas.releasePointerCapture = () => {}; // synthetic events have no real pointer
  const opts = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true };
  hud.element.querySelector(".f3d-paint .f3d-btn").click();
  const h0 = getHeight(view.getHeights(), cell.col, cell.row);
  if (!params.has("nopointer")) {
    canvas.dispatchEvent(new PointerEvent("pointerdown", opts));
    canvas.dispatchEvent(new PointerEvent("pointerup", opts));
  }
  results.paintRaised = getHeight(view.getHeights(), cell.col, cell.row) === h0 + 2.5;
  results.modelUpdated = model.heights === view.getHeights();
  playerView = true;
  applyVisibility();
  results.hiddenTokenHiddenForPlayer = view.tokens.get("ghost").group.visible === false;
  document.body.dataset.selftest = JSON.stringify(results);
  document.getElementById("dev-status").textContent = "selftest " + JSON.stringify(results);
}
setTimeout(() => (window.__f3dReady = true), 600);

// --- generated art ---------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Paint a dungeon map: rock outside the walls, flagstones inside, a rug on the dais. */
function drawDungeon(m) {
  const g = m.grid;
  const px = 64; // texture pixels per square
  const cv = document.createElement("canvas");
  cv.width = g.cols * px;
  cv.height = g.rows * px;
  const ctx = cv.getContext("2d");
  const rand = rng(7);
  const { labels, regions } = wallRegions(m.walls, g);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const outside = regions[labels[r * g.cols + c]].touchesBorder;
      const h = getHeight(m.heights, c, r);
      const x = c * px, y = r * px;
      if (outside) {
        ctx.fillStyle = `hsl(25, 8%, ${18 + rand() * 6}%)`;
        ctx.fillRect(x, y, px, px);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = `hsla(30, 10%, ${10 + rand() * 25}%, 0.7)`;
          ctx.beginPath();
          ctx.arc(x + rand() * px, y + rand() * px, 3 + rand() * 8, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      ctx.fillStyle = "#3a352f"; // mortar between flagstones
      ctx.fillRect(x, y, px, px);
      const dais = h >= 5 && h < 10;
      const stair = h > 0 && h < 5;
      // two flagstones per square
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const l = (dais ? 34 : stair ? 46 : 52) + rand() * 10;
          ctx.fillStyle = dais ? `hsl(355, 45%, ${l - 10}%)` : `hsl(35, 12%, ${l}%)`;
          ctx.fillRect(x + i * px / 2 + 1, y + j * px / 2 + 1, px / 2 - 2, px / 2 - 2);
        }
      }
      if (stair) {
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(x + (k * px) / 4, y);
          ctx.lineTo(x + (k * px) / 4, y + px);
          ctx.stroke();
        }
      }
    }
  }
  // dark wall lines like a VTT battlemap
  ctx.strokeStyle = "#0b0b0b";
  ctx.lineWidth = 6;
  const s = px / g.size;
  for (const w of m.walls) {
    ctx.beginPath();
    ctx.moveTo((w.c[0] - g.sceneX) * s, (w.c[1] - g.sceneY) * s);
    ctx.lineTo((w.c[2] - g.sceneX) * s, (w.c[3] - g.sceneY) * s);
    ctx.stroke();
  }
  return cv;
}

/** Token art: a round portrait-like disc with a coloured rim and an initial. */
function drawToken(tok) {
  const palette = { hero: "#2e86c1", mage: "#8e44ad", boss: "#7b241c", goblin: "#1e8449", ghost: "#566573" };
  const key = String(tok.src).replace("gen:", "");
  const color = palette[key] ?? "#888";
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 320;
  const ctx = cv.getContext("2d");
  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(48, 310);
  ctx.quadraticCurveTo(128, 40, 208, 310);
  ctx.closePath();
  ctx.fill();
  // head
  ctx.fillStyle = "#f0d0a8";
  ctx.beginPath();
  ctx.arc(128, 110, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tok.name[0], 128, 116);
  // outline for readability
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.moveTo(48, 310);
  ctx.quadraticCurveTo(128, 40, 208, 310);
  ctx.closePath();
  ctx.stroke();
  return cv;
}
