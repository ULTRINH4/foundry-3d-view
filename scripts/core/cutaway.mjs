/**
 * "The Sims"-style wall cutaway. Pure, so it can be unit-tested.
 *
 * 1. `indoorMap` finds the squares enclosed by walls (rooms): a flood fill from outside the
 *    scene; whatever it can't reach without crossing a wall is indoors. Every wall counts,
 *    doors too (open or not), so a room keeps its shape when a door opens.
 * 2. `wallCutDecision` cuts a wall when the square just behind it (on the side away from the
 *    camera) is indoors: the front walls of each room sink, the back walls stay up.
 * 3. `occludingWalls` also cuts walls standing between the camera and a token, for maps
 *    without closed rooms (caves, loose walls).
 */
import { segmentsIntersect } from "./heights.mjs";

export const CUT_MODES = Object.freeze({ UP: "up", CUTAWAY: "cutaway", DOWN: "down" });
export const CUT_MODE_LIST = [CUT_MODES.UP, CUT_MODES.CUTAWAY, CUT_MODES.DOWN];

/** Accept old boolean settings and unknown values. */
export function normalizeCutMode(v) {
  if (v === true) return CUT_MODES.CUTAWAY;
  if (v === false) return CUT_MODES.UP;
  return CUT_MODE_LIST.includes(v) ? v : CUT_MODES.CUTAWAY;
}

/**
 * Indoor squares.
 * @param {{c:number[]}[]} walls   wall segments in canvas px
 * @param {object} grid            makeGrid() result
 * @returns {Uint8Array}            1 = indoors, index row * cols + col
 */
export function indoorMap(walls, grid) {
  const { cols, rows, size, sceneX, sceneY } = grid;
  // Work on a grid with a one-square ring around the scene: the ring is "outside".
  const W = cols + 2, H = rows + 2;
  const cx = (c) => sceneX + (c - 0.5) * size; // ring index -> canvas center
  const cy = (r) => sceneY + (r - 0.5) * size;
  // Bucket walls by the ring cells their bounding box touches, so each step tests a few walls.
  const buckets = new Map();
  const segs = walls.map((w) => w.c).filter((c) => Array.isArray(c) && c.length >= 4);
  segs.forEach((s, i) => {
    const c0 = Math.floor((Math.min(s[0], s[2]) - sceneX) / size) + 1, c1 = Math.floor((Math.max(s[0], s[2]) - sceneX) / size) + 1;
    const r0 = Math.floor((Math.min(s[1], s[3]) - sceneY) / size) + 1, r1 = Math.floor((Math.max(s[1], s[3]) - sceneY) / size) + 1;
    for (let r = Math.max(0, r0 - 1); r <= Math.min(H - 1, r1 + 1); r++) {
      for (let c = Math.max(0, c0 - 1); c <= Math.min(W - 1, c1 + 1); c++) {
        const k = r * W + c;
        let b = buckets.get(k);
        if (!b) buckets.set(k, (b = []));
        b.push(i);
      }
    }
  });
  const blocked = (c1, r1, c2, r2) => {
    const b = buckets.get(r1 * W + c1);
    if (!b) return false;
    const ax = cx(c1), ay = cy(r1), bx = cx(c2), by = cy(r2);
    for (const i of b) {
      const s = segs[i];
      if (segmentsIntersect(ax, ay, bx, by, s[0], s[1], s[2], s[3])) return true;
    }
    return false;
  };
  const seen = new Uint8Array(W * H);
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const k = stack.pop();
    const c = k % W, r = (k - c) / W;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      const nk = nr * W + nc;
      if (seen[nk] || blocked(c, r, nc, nr)) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  const out = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = seen[(r + 1) * W + c + 1] ? 0 : 1;
  return out;
}

/**
 * Should this wall be cut? `true`/`false`, or `null` when the camera looks along the wall
 * (edge-on: keep whatever it was, so walls don't flicker at the threshold).
 * @param {number[]} c          wall segment [x1, y1, x2, y2] (canvas px)
 * @param {{x:number,y:number}} cam  camera position on the ground (canvas px)
 * @param {Uint8Array} indoor   indoorMap() result
 * @param {object} grid
 * @param {number} [edgeOn=0.15]  |cos| below which the wall counts as edge-on
 */
export function wallCutDecision(c, cam, indoor, grid, edgeOn = 0.15) {
  const [ax, ay, bx, by] = c;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1e-6) return false;
  const nx = -(by - ay) / len, ny = (bx - ax) / len;
  const steps = Math.max(1, Math.round(len / grid.size));
  let edge = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    const tx = cam.x - px, ty = cam.y - py;
    const d = Math.hypot(tx, ty);
    if (d < 1e-6) continue;
    const dot = (nx * tx + ny * ty) / d;
    if (Math.abs(dot) < edgeOn) {
      edge++;
      continue;
    }
    // A point half a square behind the wall, on the side away from the camera.
    const s = dot > 0 ? -1 : 1;
    const fx = px + s * nx * grid.size * 0.5, fy = py + s * ny * grid.size * 0.5;
    const col = Math.floor((fx - grid.sceneX) / grid.size), row = Math.floor((fy - grid.sceneY) / grid.size);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
    if (indoor[row * grid.cols + col]) return true;
  }
  return edge === steps ? null : false;
}

/**
 * Walls standing between the camera and a token (world coordinates, y up).
 * @param {{id:string, ax:number, az:number, bx:number, bz:number, top:number}[]} walls
 * @param {{x:number, y:number, z:number}[]} points  token chests
 * @param {{x:number, y:number, z:number}} cam
 * @returns {Set<string>}
 */
export function occludingWalls(walls, points, cam) {
  const out = new Set();
  for (const p of points) {
    const minX = Math.min(p.x, cam.x), maxX = Math.max(p.x, cam.x);
    const minZ = Math.min(p.z, cam.z), maxZ = Math.max(p.z, cam.z);
    for (const w of walls) {
      if (out.has(w.id)) continue;
      if (Math.max(w.ax, w.bx) < minX || Math.min(w.ax, w.bx) > maxX || Math.max(w.az, w.bz) < minZ || Math.min(w.az, w.bz) > maxZ) continue;
      const s = segmentParam(p.x, p.z, cam.x, cam.z, w.ax, w.az, w.bx, w.bz);
      if (s === null || s <= 1e-4) continue;
      // Height of the line of sight where it crosses the wall.
      if (p.y + s * (cam.y - p.y) < w.top) out.add(w.id);
    }
  }
  return out;
}

/** Where segment P->Q crosses segment A->B, as a fraction along P->Q (null if it doesn't). */
function segmentParam(px, pz, qx, qz, ax, az, bx, bz) {
  const rx = qx - px, rz = qz - pz, sx = bx - ax, sz = bz - az;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((ax - px) * sz - (az - pz) * sx) / den;
  const u = ((ax - px) * rz - (az - pz) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
