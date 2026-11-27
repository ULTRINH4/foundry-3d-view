// Generates dev/sample-scene.json: a small dungeon with three rooms, doors (open, closed, secret),
// a pillar, a raised dais with a stair and a few tokens. Run: node dev/make-sample.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGrid } from "../scripts/core/coords.mjs";
import { autoHeightsFromWalls, setHeight } from "../scripts/core/heights.mjs";

const size = 100;
const pad = 200;
const grid = { size, sceneX: pad, sceneY: pad, sceneWidth: 24 * size, sceneHeight: 16 * size, distance: 5 };
const P = (v) => pad + v * size;
let n = 0;
const wall = (x1, y1, x2, y2, extra = {}) => ({ _id: `w${++n}`, c: [P(x1), P(y1), P(x2), P(y2)], ...extra });

const walls = [
  // Room A (x 2..9, y 2..9)
  wall(2, 2, 9, 2), wall(2, 2, 2, 9),
  wall(9, 2, 9, 5), wall(9, 5, 9, 6, { door: 1, ds: 1 }), wall(9, 6, 9, 9),
  wall(2, 9, 5, 9), wall(5, 9, 6, 9, { door: 2, ds: 0 }), wall(6, 9, 9, 9),
  // Corridor (y 5..6)
  wall(9, 5, 13, 5), wall(9, 6, 13, 6),
  // Room B (x 13..22, y 3..13)
  wall(13, 3, 22, 3), wall(22, 3, 22, 13), wall(13, 13, 22, 13),
  wall(13, 3, 13, 5), wall(13, 5, 13, 6, { door: 1, ds: 0 }), wall(13, 6, 13, 13),
  // Pillar in room B
  wall(16, 9, 17, 9), wall(17, 9, 17, 10), wall(17, 10, 16, 10), wall(16, 10, 16, 9),
  // Room C under A (x 3..8, y 9..14), reached through the secret door
  wall(3, 9, 3, 14, { sight: 30, light: 30 }), wall(8, 9, 8, 14), wall(3, 14, 8, 14), // west wall of C is a window
  // Level 2: railing around a balcony in room B (x 18..22, y 8..13) at 10 ft
  wall(18, 8, 22, 8, { level: "balcony", flags: { "wall-height": { bottom: 10, top: 13 } } }),
  wall(18, 8, 18, 13, { level: "balcony", flags: { "wall-height": { bottom: 10, top: 13 } } }),
  // A half-height parapet and an invisible (glass) barrier in room B
  wall(14, 7, 16, 7, { flags: { "foundry-3d-view": { height: 0.5 } } }),
  wall(14, 12, 16, 12, { sight: 0 }),
];

const g = makeGrid(grid);
let heights = autoHeightsFromWalls(walls, g, { mode: "outside", step: 5 });
for (let r = 4; r <= 6; r++) {
  heights = setHeight(heights, 17, r, 2.5); // stair
  for (let c = 18; c <= 21; c++) heights = setHeight(heights, c, r, 5); // dais
}
heights = setHeight(heights, 16, 9, 10); // pillar block

const tok = (id, name, col, row, extra = {}) => ({ _id: id, name, x: P(col), y: P(row), width: 1, height: 1, elevation: 0, ...extra });
const tokens = [
  tok("hero", "Hero", 5, 5, { disposition: 1, src: "gen:hero" }),
  tok("mage", "Mage", 11, 5, { disposition: 1, src: "gen:mage" }),
  tok("boss", "Ogre", 19, 4, { disposition: -1, src: "gen:boss", width: 2, height: 2 }),
  tok("goblin", "Goblin", 15, 11, { disposition: -1, src: "gen:goblin" }),
  tok("ghost", "Hidden spy", 5, 12, { disposition: -1, src: "gen:ghost", hidden: true }),
  tok("archer", "Archer", 20, 10, { disposition: -1, src: "gen:archer", elevation: 10, level: "balcony" }),
];
tokens[0].light = { dim: 30, bright: 15, color: "#ffb35c" }; // the hero carries a torch
// The mage uses a directional + animated sprite sheet (4 directions x 2 frames), facing east.
tokens[1].rotation = 270;
tokens[1].flags = { "foundry-3d-view": { sheet: { src: "gen:sheet", directions: 4, frames: 2, fps: 4 } } };

const tiles = [
  // A rug in room A (floor tile) and a roof over room C (overhead: elevation >= foreground 20)
  { _id: "rug", x: P(4), y: P(3), width: 3 * size, height: 2 * size, rotation: 15, texture: { src: "gen:rug" }, elevation: 0, sort: 1 },
  { _id: "roofC", x: P(3), y: P(9), width: 5 * size, height: 5 * size, texture: { src: "gen:roof" }, elevation: 20, sort: 2 },
];

const lights = [
  { _id: "brazier", x: P(19.5), y: P(4.5), config: { dim: 40, bright: 20, color: "#ff7a2e" } },
  { _id: "torchB", x: P(13.5), y: P(12.5), config: { dim: 25, bright: 10, color: "#ffd38a" } },
  { _id: "torchC", x: P(5.5), y: P(13.5), config: { dim: 20, bright: 10, color: "#9ad0ff" } },
];

const levels = [
  { id: "ground", name: "Ground", bottom: 0, background: { src: "gen:dungeon" } },
  { id: "balcony", name: "Balcony", bottom: 10, background: { src: "gen:balcony" } },
];

const out = {
  name: "Sample dungeon",
  grid,
  background: { src: "gen:dungeon" },
  backgroundColor: "#121214",
  walls,
  tokens,
  tiles,
  lights,
  levels,
  darkness: 0.55,
  foregroundElevation: 20,
  heights,
};
const file = join(dirname(fileURLToPath(import.meta.url)), "sample-scene.json");
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`wrote ${file}`);
