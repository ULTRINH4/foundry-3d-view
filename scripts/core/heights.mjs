/**
 * Per-square terrain heights.
 *
 * A height map is a plain, JSON-serializable object stored in the scene flags:
 *   { cols, rows, data: number[] }   // data[row * cols + col], in grid distance units
 * It covers the scene rect (no padding). Missing/invalid values read as 0.
 */
import { canvasToCell } from "./coords.mjs";
import { WALL_SENSE } from "./constants.mjs";

export function createHeightMap(cols, rows, fill = 0) {
  return { cols, rows, data: new Array(cols * rows).fill(fill) };
}

/**
 * Accept whatever is stored in flags (possibly from a scene with different dimensions, or
 * corrupted) and return a valid map of the requested size. Values are kept by (col,row).
 */
export function normalizeHeightMap(raw, cols, rows) {
  const out = createHeightMap(cols, rows);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.data)) return out;
  const rc = Number(raw.cols) | 0;
  const rr = Number(raw.rows) | 0;
  if (rc <= 0 || rr <= 0) return out;
  for (let r = 0; r < Math.min(rr, rows); r++) {
    for (let c = 0; c < Math.min(rc, cols); c++) {
      const v = Number(raw.data[r * rc + c]);
      out.data[r * cols + c] = Number.isFinite(v) ? v : 0;
    }
  }
  return out;
}

export function getHeight(map, col, row) {
  if (!map || col < 0 || row < 0 || col >= map.cols || row >= map.rows) return 0;
  return map.data[row * map.cols + col] || 0;
}

/** Immutable set: returns a new map. Out-of-range writes return the same map. */
export function setHeight(map, col, row, value) {
  if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return map;
  const data = map.data.slice();
  data[row * map.cols + col] = roundHeight(value);
  return { cols: map.cols, rows: map.rows, data };
}

/** Add `delta` to a cell, clamped to [min, max]. */
export function bumpHeight(map, col, row, delta, { min = 0, max = Infinity } = {}) {
  const next = Math.min(max, Math.max(min, getHeight(map, col, row) + delta));
  return setHeight(map, col, row, next);
}

/** Avoid 0.30000000000000004 accumulating in flags. */
export function roundHeight(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

export function maxHeight(map) {
  let m = 0;
  for (const v of map.data) if (v > m) m = v;
  return m;
}

export function heightMapsEqual(a, b) {
  if (!a || !b || a.cols !== b.cols || a.rows !== b.rows) return false;
  for (let i = 0; i < a.data.length; i++) if ((a.data[i] || 0) !== (b.data[i] || 0)) return false;
  return true;
}

/**
 * Highest terrain under a canvas-pixel rectangle (e.g. a token footprint). The rectangle is
 * shrunk by 1px so a token exactly on cell borders does not pick up its neighbours.
 */
export function maxHeightUnderRect(map, grid, x, y, width, height) {
  const a = clampCell(grid, x + 1, y + 1);
  const b = clampCell(grid, x + width - 1, y + height - 1);
  let m = -Infinity;
  for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) m = Math.max(m, getHeight(map, c, r));
  return Number.isFinite(m) ? m : 0;
}

/** Highest terrain along a wall segment [x1,y1,x2,y2] (canvas px). */
export function maxHeightAlongSegment(map, grid, c) {
  const [x1, y1, x2, y2] = c;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil((len / grid.size) * 2));
  let m = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cell = canvasToCell(grid, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    if (cell) m = Math.max(m, getHeight(map, cell.col, cell.row));
  }
  return m;
}

/**
 * Terrain height a wall stands on: the lower of the two sides (each side = highest terrain along
 * the segment, sampled a quarter square off the line). A wall between a room floor and raised
 * rock starts at the floor; a wall on top of a plateau starts on the plateau.
 */
export function wallBaseHeight(map, grid, c) {
  const [x1, y1, x2, y2] = c;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len === 0) return maxHeightAlongSegment(map, grid, c);
  const off = grid.size * 0.25;
  const nx = (-(y2 - y1) / len) * off;
  const ny = ((x2 - x1) / len) * off;
  // Pull the ends in a little so the squares just past each end of the wall don't count.
  const inset = Math.min(len / 2 - 1e-6, grid.size * 0.25);
  const ix = ((x2 - x1) / len) * inset, iy = ((y2 - y1) / len) * inset;
  const s = [x1 + ix, y1 + iy, x2 - ix, y2 - iy];
  const a = maxHeightAlongSegment(map, grid, [s[0] + nx, s[1] + ny, s[2] + nx, s[3] + ny]);
  const b = maxHeightAlongSegment(map, grid, [s[0] - nx, s[1] - ny, s[2] - nx, s[3] - ny]);
  return Math.min(a, b);
}

function clampCell(grid, px, py) {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor((px - grid.sceneX) / grid.size)));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor((py - grid.sceneY) / grid.size)));
  return { col, row };
}

/* ------------------------------------------------------------------------------------------ */
/* Auto rough pass                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** Segment intersection; touching/collinear overlap counts as intersecting. */
export function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = orient(cx, cy, dx, dy, ax, ay);
  const d2 = orient(cx, cy, dx, dy, bx, by);
  const d3 = orient(ax, ay, bx, by, cx, cy);
  const d4 = orient(ax, ay, bx, by, dx, dy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
  if (d2 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
  if (d3 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
  if (d4 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
  return false;
}
function orient(ax, ay, bx, by, cx, cy) {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return Math.abs(v) < 1e-9 ? 0 : v;
}
function onSegment(ax, ay, bx, by, px, py) {
  const e = 1e-9;
  return Math.min(ax, bx) - e <= px && px <= Math.max(ax, bx) + e && Math.min(ay, by) - e <= py && py <= Math.max(ay, by) + e;
}

/**
 * Group cells into regions separated by walls. Two orthogonally adjacent cells are connected
 * unless a movement-blocking wall (doors included) crosses the line between their centres.
 * @returns {{labels:Int32Array, regions:{id:number, size:number, touchesBorder:boolean}[]}}
 */
export function wallRegions(walls, grid) {
  const { cols, rows, size } = grid;
  const blocking = walls
    .filter((w) => (w.move ?? WALL_SENSE.NORMAL) !== WALL_SENSE.NONE || (w.door ?? 0) > 0)
    .map((w) => w.c);
  const cx = (c) => grid.sceneX + (c + 0.5) * size;
  const cy = (r) => grid.sceneY + (r + 0.5) * size;

  // Bucket walls per cell so the check stays fast on big maps.
  const bucket = new Map();
  const key = (c, r) => c + "," + r;
  for (const s of blocking) {
    const c0 = Math.floor((Math.min(s[0], s[2]) - grid.sceneX) / size) - 1;
    const c1 = Math.floor((Math.max(s[0], s[2]) - grid.sceneX) / size) + 1;
    const r0 = Math.floor((Math.min(s[1], s[3]) - grid.sceneY) / size) - 1;
    const r1 = Math.floor((Math.max(s[1], s[3]) - grid.sceneY) / size) + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = key(c, r);
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push(s);
      }
    }
  }
  const blocked = (c1, r1, c2, r2) => {
    const list = bucket.get(key(c1, r1));
    if (!list) return false;
    const ax = cx(c1), ay = cy(r1), bx = cx(c2), by = cy(r2);
    return list.some((s) => segmentsIntersect(ax, ay, bx, by, s[0], s[1], s[2], s[3]));
  };

  const labels = new Int32Array(cols * rows).fill(-1);
  const regions = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== -1) continue;
    const id = regions.length;
    const region = { id, size: 0, touchesBorder: false };
    regions.push(region);
    const stack = [start];
    labels[start] = id;
    while (stack.length) {
      const i = stack.pop();
      const c = i % cols;
      const r = (i - c) / cols;
      region.size++;
      if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) region.touchesBorder = true;
      for (const [dc, dr] of dirs) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (labels[j] !== -1 || blocked(c, r, nc, nr)) continue;
        labels[j] = id;
        stack.push(j);
      }
    }
  }
  return { labels, regions };
}

/**
 * Rough first guess of terrain from walls. Existing heights are replaced.
 *  - mode "outside": regions touching the map border are raised by `step` (solid rock around a
 *                    dungeon; the rooms stay at 0).
 *  - mode "rooms":   regions fully enclosed by walls are raised by `step` (buildings on a plinth).
 * If walls enclose nothing, the map stays flat.
 */
export function autoHeightsFromWalls(walls, grid, { mode = "outside", step = grid.distance } = {}) {
  const { labels, regions } = wallRegions(walls, grid);
  const map = createHeightMap(grid.cols, grid.rows);
  if (!regions.some((r) => !r.touchesBorder)) return map;
  for (let i = 0; i < labels.length; i++) {
    const region = regions[labels[i]];
    const raise = mode === "rooms" ? !region.touchesBorder : region.touchesBorder;
    map.data[i] = raise ? roundHeight(step) : 0;
  }
  return map;
}

/* ------------------------------------------------------------------------------------------ */
/* Brush & history                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** Cells of a square brush of odd `size` (1, 3, 5...) centred on a cell, clipped to the map. */
export function brushCells(map, col, row, size = 1) {
  const r = Math.max(0, Math.floor((size - 1) / 2));
  const out = [];
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      const c = col + dc, w = row + dr;
      if (c >= 0 && w >= 0 && c < map.cols && w < map.rows) out.push({ col: c, row: w });
    }
  }
  return out;
}

/** Add `delta` to every cell of a brush (clamped). Returns a new map. */
export function bumpBrush(map, col, row, size, delta, limits = {}) {
  const { min = 0, max = Infinity } = limits;
  const data = map.data.slice();
  for (const cell of brushCells(map, col, row, size)) {
    const i = cell.row * map.cols + cell.col;
    data[i] = roundHeight(Math.min(max, Math.max(min, (data[i] || 0) + delta)));
  }
  return { cols: map.cols, rows: map.rows, data };
}

/** Bounded undo stack of height maps. */
export class HeightHistory {
  constructor(limit = 50) {
    this.limit = limit;
    this.stack = [];
  }
  push(map) {
    this.stack.push(map);
    if (this.stack.length > this.limit) this.stack.shift();
  }
  /** Returns the previous map, or null when there is nothing to undo. */
  pop() {
    return this.stack.pop() ?? null;
  }
  get size() {
    return this.stack.length;
  }
}
