/**
 * Performance check on a big generated scene: 120x120 squares, a few thousand wall segments
 * (a grid of rooms), 150 tokens, random terrain. Reports load time, draw calls, frame time and
 * the cost of a fog update. ?selftest=1 writes the numbers into <body data-selftest>.
 * Note: headless runs use SwiftShader (CPU), so absolute frame times are far worse than a GPU.
 */
import { View3D } from "../scripts/render/view3d.mjs";
import { modelFromJSON } from "../scripts/core/scene-model.mjs";
import { losVisibilityTest, visibleCells } from "../scripts/core/vision.mjs";
import { rng, drawToken } from "./art.mjs";

const N = 120;
const size = 100;
const pad = 200;
const P = (v) => pad + v * size;
const rand = rng(42);
const walls = [];
let id = 0;
// Rooms of 6x6 squares with a door in the middle of each side.
for (let gy = 0; gy < N; gy += 6) {
  for (let gx = 0; gx < N; gx += 6) {
    walls.push({ _id: `w${id++}`, c: [P(gx), P(gy), P(gx + 2), P(gy)] });
    walls.push({ _id: `w${id++}`, c: [P(gx + 2), P(gy), P(gx + 3), P(gy)], door: 1, ds: rand() < 0.5 ? 1 : 0 });
    walls.push({ _id: `w${id++}`, c: [P(gx + 3), P(gy), P(gx + 6), P(gy)] });
    walls.push({ _id: `w${id++}`, c: [P(gx), P(gy), P(gx), P(gy + 2)] });
    walls.push({ _id: `w${id++}`, c: [P(gx), P(gy + 2), P(gx), P(gy + 3)], door: 1, ds: 0 });
    walls.push({ _id: `w${id++}`, c: [P(gx), P(gy + 3), P(gx), P(gy + 6)] });
  }
}
const heights = { cols: N, rows: N, data: Array.from({ length: N * N }, () => (rand() < 0.08 ? 5 * Math.ceil(rand() * 2) : 0)) };
const tokens = Array.from({ length: 150 }, (_, i) => ({
  _id: `t${i}`, name: String.fromCharCode(65 + (i % 26)), x: P(Math.floor(rand() * N)), y: P(Math.floor(rand() * N)),
  disposition: i < 4 ? 1 : -1, src: `gen:t${i % 5}`,
}));
const json = { grid: { size, sceneX: pad, sceneY: pad, sceneWidth: N * size, sceneHeight: N * size, distance: 5 }, walls, tokens, heights };
const model = modelFromJSON(json);
const bg = document.createElement("canvas");
bg.width = bg.height = 2048;
const ctx = bg.getContext("2d");
for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) {
  ctx.fillStyle = `hsl(35, 12%, ${40 + rand() * 15}%)`;
  ctx.fillRect(i * 32, j * 32, 31, 31);
}
model.background.src = bg;
const arts = [0, 1, 2, 3, 4].map((k) => drawToken({ name: "XYZWQ"[k], src: `gen:${["hero", "mage", "boss", "goblin", "ghost"][k]}` }));
for (const t of model.tokens) t.src = arts[Number(t.src.slice(5))];

const t0 = performance.now();
const view = new View3D(document.querySelector(".f3d-viewport"), { isGM: true, preserveDrawingBuffer: true });
await view.load(model);
const loadMs = performance.now() - t0;

// Frame cost (render loop stepped by hand).
view.renderer.info.autoReset = true;
view._loop(view._last + 16);
const calls = view.renderer.info.render.calls;
const f0 = performance.now();
for (let i = 0; i < 20; i++) view._loop(view._last + 16);
const frameMs = (performance.now() - f0) / 20;

// Fog update cost: 4 friendly tokens, line of sight against all walls.
const g = view.grid;
const fog0 = performance.now();
const sources = model.tokens.filter((t) => t.disposition === 1).map((t) => ({ x: t.x + 50, y: t.y + 50, radius: 12 * size }));
const vis = visibleCells(g, losVisibilityTest(sources, model.walls, g));
const fogMs = performance.now() - fog0;

// Height edit (terrain rebuild + walls/tokens re-seated).
const h0 = performance.now();
const data = view.getHeights().data.slice();
data[0] = 10;
view.setHeights({ cols: N, rows: N, data });
const rebuildMs = performance.now() - h0;

const r = {
  walls: model.walls.length,
  tokens: model.tokens.length,
  cells: N * N,
  loadMs: Math.round(loadMs),
  drawCalls: calls,
  frameMsSwiftShader: Math.round(frameMs * 10) / 10,
  fogUpdateMs: Math.round(fogMs),
  heightEditMs: Math.round(rebuildMs),
  visibleCells: vis.reduce((a, b) => a + b, 0),
  // Thresholds are generous on purpose: SwiftShader is a CPU rasterizer.
  loadsUnder15s: loadMs < 15000,
  // Plain walls are one instanced draw; doors (800 here) and tokens stay separate meshes.
  wallsBatched: calls < model.walls.length / 2,
  fogUnder2s: fogMs < 2000,
  heightEditUnder2s: rebuildMs < 2000,
};
document.body.dataset.selftest = JSON.stringify(r);
document.getElementById("status").textContent = JSON.stringify(r);
