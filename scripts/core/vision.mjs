/**
 * Line of sight and per-square fog states. Pure, used by the dev page and as a fallback inside
 * Foundry (where Foundry's own `canvas.visibility.testVisibility` is preferred).
 *
 * Fog states per cell: 0 = never seen, 1 = explored (seen before), 2 = visible now.
 */
import { WALL_SENSE, DOOR_STATE, WALL_DOOR } from "./constants.mjs";

export const FOG = Object.freeze({ UNSEEN: 0, EXPLORED: 1, VISIBLE: 2 });

/** Does this wall block sight right now? Open doors do not; walls with sight NONE do not. */
export function blocksSight(w) {
  if ((w.sight ?? WALL_SENSE.NORMAL) === WALL_SENSE.NONE) return false;
  if ((w.door ?? WALL_DOOR.NONE) !== WALL_DOOR.NONE && w.ds === DOOR_STATE.OPEN) return false;
  return true;
}

/** Nearest intersection distance (t along the ray) of a ray with a segment, or Infinity. */
function raySegment(ox, oy, dx, dy, s) {
  const [x1, y1, x2, y2] = s;
  const sx = x2 - x1, sy = y2 - y1;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return Infinity;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / den;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
  if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return t;
}

/**
 * Visibility polygon from `origin` (canvas px) against sight-blocking segments, limited to
 * `radius` px (Infinity = unlimited; then `bounds` {x,y,width,height} closes the polygon).
 * @returns {number[]} flat [x0,y0,x1,y1,...] in angle order
 */
export function computeLOS(origin, walls, { radius = Infinity, bounds } = {}) {
  const ox = origin.x, oy = origin.y;
  const segs = walls.filter(blocksSight).map((w) => w.c);
  const R = Number.isFinite(radius) ? radius : Infinity;
  if (bounds) {
    const { x, y, width: bw, height: bh } = bounds;
    segs.push([x, y, x + bw, y], [x + bw, y, x + bw, y + bh], [x + bw, y + bh, x, y + bh], [x, y + bh, x, y]);
  }
  const angles = [];
  for (const s of segs) {
    for (const [px, py] of [[s[0], s[1]], [s[2], s[3]]]) {
      if (Number.isFinite(R) && Math.hypot(px - ox, py - oy) > R * 1.01) continue;
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - 1e-5, a, a + 1e-5);
    }
  }
  if (Number.isFinite(R) || angles.length === 0) {
    for (let i = 0; i < 48; i++) angles.push(-Math.PI + (i / 48) * Math.PI * 2);
  }
  angles.sort((a, b) => a - b);
  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = R;
    for (const s of segs) {
      const t = raySegment(ox, oy, dx, dy, s);
      if (t < best) best = t;
    }
    if (!Number.isFinite(best)) best = 1e6;
    pts.push(ox + dx * best, oy + dy * best);
  }
  return pts;
}

/** Even-odd point-in-polygon test for a flat point array. */
export function pointInPolygon(px, py, poly) {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1];
    const xj = poly[j * 2], yj = poly[j * 2 + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Sample points inside a cell: centre plus four points near the corners. */
export function cellSamplePoints(grid, col, row, inset = 0.2) {
  const x0 = grid.sceneX + col * grid.size;
  const y0 = grid.sceneY + row * grid.size;
  const s = grid.size;
  const a = s * inset, b = s * (1 - inset);
  return [[x0 + s / 2, y0 + s / 2], [x0 + a, y0 + a], [x0 + b, y0 + a], [x0 + a, y0 + b], [x0 + b, y0 + b]];
}

/**
 * Which cells are visible now. `isVisible(x, y)` decides per sample point (e.g. Foundry's
 * testVisibility, or a polygon test). A cell is visible if any of its sample points is.
 * @returns {Uint8Array} 1 = visible, 0 = not
 */
export function visibleCells(grid, isVisible) {
  const out = new Uint8Array(grid.cols * grid.rows);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      for (const [x, y] of cellSamplePoints(grid, c, r)) {
        if (isVisible(x, y)) {
          out[r * grid.cols + c] = 1;
          break;
        }
      }
    }
  }
  return out;
}

/** Visibility test built from vision sources [{x, y, radius}] (px) using computeLOS. */
export function losVisibilityTest(sources, walls, grid) {
  const bounds = { x: grid.sceneX, y: grid.sceneY, width: grid.sceneWidth, height: grid.sceneHeight };
  const polys = sources.map((s) => ({ s, poly: computeLOS(s, walls, { radius: s.radius ?? Infinity, bounds }) }));
  return (x, y) => polys.some(({ s, poly }) => {
    if (Number.isFinite(s.radius) && Math.hypot(x - s.x, y - s.y) > s.radius) return false;
    return pointInPolygon(x, y, poly);
  });
}

/**
 * Combine "visible now" with what was explored before.
 * @param {Uint8Array|null} explored  previous explored flags (1 = explored), or null
 * @param {Uint8Array} visible        visibleCells() result
 * @returns {{states:Uint8Array, explored:Uint8Array}}
 */
export function fogStates(explored, visible) {
  const n = visible.length;
  const ex = explored && explored.length === n ? Uint8Array.from(explored) : new Uint8Array(n);
  const states = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (visible[i]) {
      ex[i] = 1;
      states[i] = FOG.VISIBLE;
    } else states[i] = ex[i] ? FOG.EXPLORED : FOG.UNSEEN;
  }
  return { states, explored: ex };
}
