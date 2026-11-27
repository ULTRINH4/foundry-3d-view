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
  wall(3, 9, 3, 14), wall(8, 9, 8, 14), wall(3, 14, 8, 14),
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
];

const out = {
  name: "Sample dungeon",
  grid,
  background: { src: "gen:dungeon" },
  backgroundColor: "#121214",
  walls,
  tokens,
  heights,
};
const file = join(dirname(fileURLToPath(import.meta.url)), "sample-scene.json");
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`wrote ${file}`);
