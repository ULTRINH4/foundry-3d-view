/**
 * Fire Emblem–style movement on the grid: reachable squares (blue), attack ring (red) and the
 * path to a square (the yellow arrow). Pure, so it can be unit-tested.
 *
 * Costs: an orthogonal step costs 1; a diagonal step costs `diagonalCost` (Infinity forbids
 * diagonals). Climbing or dropping more than `climbUnits` of terrain height costs +1 (a ledge).
 * `blocked(c1, r1, c2, r2)` says whether a wall stops movement between two adjacent squares.
 */
import { getHeight, segmentsIntersect } from "./heights.mjs";
import { WALL_SENSE, DOOR_STATE } from "./constants.mjs";
import { DIAGONALS } from "./scene-extras.mjs";

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Diagonal step cost for Foundry's diagonal rule. */
export function diagonalCostFor(rule) {
  switch (rule) {
    case DIAGONALS.EXACT: return Math.SQRT2;
    case DIAGONALS.APPROXIMATE:
    case DIAGONALS.ALTERNATING_1:
    case DIAGONALS.ALTERNATING_2: return 1.5;
    case DIAGONALS.RECTILINEAR:
    case DIAGONALS.ILLEGAL: return Infinity;
    default: return 1;
  }
}

/**
 * A `blocked` test from walls (canvas px). Movement-blocking walls and closed/locked doors stop
 * movement; open doors don't. A diagonal step is blocked if either of its corners is blocked too.
 */
export function wallBlocker(walls, grid) {
  const segs = walls
    .filter((w) => (w.move ?? WALL_SENSE.NORMAL) !== WALL_SENSE.NONE && !((w.door ?? 0) > 0 && w.ds === DOOR_STATE.OPEN))
    .map((w) => w.c);
  const cx = (c) => grid.sceneX + (c + 0.5) * grid.size;
  const cy = (r) => grid.sceneY + (r + 0.5) * grid.size;
  const line = (c1, r1, c2, r2) => {
    const ax = cx(c1), ay = cy(r1), bx = cx(c2), by = cy(r2);
    return segs.some((s) => segmentsIntersect(ax, ay, bx, by, s[0], s[1], s[2], s[3]));
  };
  return (c1, r1, c2, r2) => {
    if (line(c1, r1, c2, r2)) return true;
    if (c1 !== c2 && r1 !== r2) return line(c1, r1, c2, r1) || line(c1, r1, c1, r2) || line(c2, r1, c2, r2) || line(c1, r2, c2, r2);
    return false;
  };
}

/**
 * Squares reachable from `start` within `range`.
 * @returns {Map<number, {cost:number, prev:number}>}  key = row * cols + col (start has prev -1)
 */
export function reachable(grid, start, range, { blocked = () => false, heights = null, climbUnits = Infinity, diagonalCost = 1, occupied = null } = {}) {
  const { cols, rows } = grid;
  const key = (c, r) => r * cols + c;
  const out = new Map();
  if (start.col < 0 || start.row < 0 || start.col >= cols || start.row >= rows) return out;
  out.set(key(start.col, start.row), { cost: 0, prev: -1 });
  const open = [[0, start.col, start.row]];
  const dirs = Number.isFinite(diagonalCost) ? DIRS8 : DIRS4;
  while (open.length) {
    // Small grids: a sorted array is plenty.
    open.sort((a, b) => a[0] - b[0]);
    const [cost, c, r] = open.shift();
    if (cost > (out.get(key(c, r))?.cost ?? Infinity)) continue;
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (blocked(c, r, nc, nr)) continue;
      if (occupied && occupied.has(key(nc, nr))) continue;
      let step = dc && dr ? diagonalCost : 1;
      if (heights) {
        const dh = Math.abs(getHeight(heights, nc, nr) - getHeight(heights, c, r));
        if (dh > climbUnits) step += 1;
      }
      const nCost = cost + step;
      if (nCost > range + 1e-9) continue;
      const k = key(nc, nr);
      if (nCost < (out.get(k)?.cost ?? Infinity)) {
        out.set(k, { cost: nCost, prev: key(c, r) });
        open.push([nCost, nc, nr]);
      }
    }
  }
  return out;
}

/** Path (list of {col,row}, start first) to `target`, or null if it isn't reachable. */
export function pathTo(grid, reach, target) {
  const k = target.row * grid.cols + target.col;
  if (!reach.has(k)) return null;
  const path = [];
  for (let cur = k; cur !== -1; cur = reach.get(cur).prev) {
    path.push({ col: cur % grid.cols, row: Math.floor(cur / grid.cols) });
  }
  return path.reverse();
}

/**
 * Attack ring: squares within `attackRange` steps (8 directions) of any reachable square that are
 * not reachable themselves (the red band around the blue area). Walls stop it like they stop
 * movement, so the band doesn't leak through into the next room.
 * @returns {Set<number>}
 */
export function attackRing(grid, reach, attackRange = 1, { blocked = () => false } = {}) {
  const out = new Set();
  if (!(attackRange > 0)) return out;
  const dist = new Map();
  let frontier = [];
  for (const k of reach.keys()) {
    dist.set(k, 0);
    frontier.push(k);
  }
  for (let step = 1; step <= attackRange; step++) {
    const next = [];
    for (const k of frontier) {
      const c = k % grid.cols, r = Math.floor(k / grid.cols);
      for (const [dc, dr] of DIRS8) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue;
        const nk = nr * grid.cols + nc;
        if (dist.has(nk) || blocked(c, r, nc, nr)) continue;
        dist.set(nk, step);
        next.push(nk);
        out.add(nk);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Keyboard cursor step relative to the camera (Fire Emblem: "up" always means "away from me").
 * @param {"up"|"down"|"left"|"right"} dir
 * @param {number} cameraYaw  atan2(x, z) of the camera offset from its target
 * @returns {{dc:number, dr:number}}
 */
export function cursorStep(dir, cameraYaw) {
  // Forward on the ground = from the camera toward the target.
  const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
  const v = { up: [fx, fz], down: [-fx, -fz], right: [-fz, fx], left: [fz, -fx] }[dir];
  if (!v) return { dc: 0, dr: 0 };
  return Math.abs(v[0]) >= Math.abs(v[1]) ? { dc: Math.sign(v[0]), dr: 0 } : { dc: 0, dr: Math.sign(v[1]) };
}

/**
 * Square a token "stands on" for movement: the one under its center (for 2×2 tokens, whose
 * center sits on a grid corner, the square down-right of it). Foundry positions tokens by
 * their top-left corner, so this and `tokenPositionForCell` convert both ways.
 */
export function tokenAnchorCell(grid, t) {
  const w = Number(t.width ?? 1) || 1, h = Number(t.height ?? 1) || 1;
  const cx = Number(t.x) + (w * grid.size) / 2, cy = Number(t.y) + (h * grid.size) / 2;
  const col = Math.floor((cx - grid.sceneX) / grid.size), row = Math.floor((cy - grid.sceneY) / grid.size);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  return { col, row };
}

/** Top-left canvas position that puts the token's anchor square on `cell`. */
export function tokenPositionForCell(grid, t, cell) {
  const w = Math.max(1, Math.round(Number(t.width ?? 1) || 1)), h = Math.max(1, Math.round(Number(t.height ?? 1) || 1));
  return { x: grid.sceneX + (cell.col - Math.floor(w / 2)) * grid.size, y: grid.sceneY + (cell.row - Math.floor(h / 2)) * grid.size };
}

/** Every square a token covers (keys row * cols + col). */
export function tokenCellKeys(grid, t) {
  const w = Math.max(1, Math.round(Number(t.width ?? 1) || 1)), h = Math.max(1, Math.round(Number(t.height ?? 1) || 1));
  const c0 = Math.round((Number(t.x) - grid.sceneX) / grid.size), r0 = Math.round((Number(t.y) - grid.sceneY) / grid.size);
  const out = [];
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (c >= 0 && r >= 0 && c < grid.cols && r < grid.rows) out.push(r * grid.cols + c);
  return out;
}

/**
 * Movement left this combat turn. `spent` is the token's record {key, cost}; it only counts
 * when its key matches the current turn's key, so it resets by itself when the turn changes.
 */
export function remainingMove(range, spent, turnKey) {
  if (!turnKey || !spent || spent.key !== turnKey) return range;
  return Math.max(0, range - (Number(spent.cost) || 0));
}
