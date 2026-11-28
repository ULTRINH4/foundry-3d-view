/**
 * Pure helpers for the second milestone: wall cutaway, lights, tiles, levels, measurement.
 */
import { canvasToWorld, unitsToWorldY } from "./coords.mjs";

/* ------------------------------------------------------------------------------------------ */
/* Cutaway: lower walls between the camera and what it looks at                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * True when a wall (world centre cx,cz) is on the camera side of the orbit target, more than
 * `margin` world units toward the camera. Works in the ground plane only.
 */
export function isWallTowardCamera(cx, cz, target, camera, margin = 0.6) {
  const dx = camera.x - target.x;
  const dz = camera.z - target.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false; // looking straight down: nothing is "in front"
  return ((cx - target.x) * dx + (cz - target.z) * dz) / len > margin;
}

/* ------------------------------------------------------------------------------------------ */
/* Lights                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Normalize an AmbientLight document (v12+ shape: x, y, config{dim, bright, color}, hidden). */
export function lightData(doc) {
  const cfg = doc.config ?? doc;
  return {
    id: doc.id ?? doc._id,
    x: Number(doc.x) || 0,
    y: Number(doc.y) || 0,
    elevation: Number(doc.elevation) || 0,
    dim: Math.max(0, Number(cfg.dim) || 0),
    bright: Math.max(0, Number(cfg.bright) || 0),
    color: colorToHex(cfg.color) ?? 0xffe2b0,
    alpha: cfg.alpha !== undefined ? Number(cfg.alpha) : 0.5,
    hidden: !!doc.hidden,
    negative: !!cfg.negative || Number(cfg.luminosity) < 0,
    // Foundry light animation ("torch", "flame", ...): flickers in 3D
    animation: cfg.animation?.type || null,
  };
}

/** Light emitted by a token (doc.light), or null if it emits none. */
export function tokenLightData(doc) {
  const l = doc.light ?? {};
  const dim = Number(l.dim) || 0;
  const bright = Number(l.bright) || 0;
  if (dim <= 0 && bright <= 0) return null;
  return {
    id: `token:${doc.id ?? doc._id}`,
    tokenId: doc.id ?? doc._id,
    x: 0,
    y: 0,
    elevation: 0,
    dim,
    bright,
    color: colorToHex(l.color) ?? 0xffd59a,
    alpha: l.alpha !== undefined ? Number(l.alpha) : 0.5,
    hidden: false,
    negative: false,
    animation: l.animation?.type || null,
  };
}

/** Accepts "#rrggbb", numbers, or Foundry Color objects (which coerce to numbers). */
export function colorToHex(c) {
  if (c === null || c === undefined || c === "") return null;
  if (typeof c === "number") return c;
  if (typeof c === "string") {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    return m ? parseInt(m[1], 16) : null;
  }
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pick at most `max` lights to render, closest to `focus` (canvas px) first. Hidden and
 * negative (darkness) lights are skipped.
 */
export function selectLights(lights, focus, max = 8) {
  return lights
    .filter((l) => !l.hidden && !l.negative && Math.max(l.dim, l.bright) > 0)
    .map((l) => ({ l, d: Math.hypot(l.x - focus.x, l.y - focus.y) - Math.max(l.dim, l.bright) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((e) => e.l);
}

/** Global light multiplier for a darkness level in [0,1]. */
export function ambientForDarkness(darkness) {
  const d = Math.min(1, Math.max(0, Number(darkness) || 0));
  return 1 - 0.85 * d;
}

/* ------------------------------------------------------------------------------------------ */
/* Tiles                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export function tileData(doc) {
  const tex = doc.texture ?? {};
  return {
    id: doc.id ?? doc._id,
    x: Number(doc.x) || 0,
    y: Number(doc.y) || 0,
    width: Number(doc.width) || 0,
    height: Number(doc.height) || 0,
    rotation: Number(doc.rotation) || 0,
    src: tex.src ?? doc.img ?? null,
    scaleX: Number(tex.scaleX ?? 1) || 1,
    scaleY: Number(tex.scaleY ?? 1) || 1,
    alpha: doc.alpha !== undefined ? Number(doc.alpha) : 1,
    hidden: !!doc.hidden,
    elevation: Number(doc.elevation) || 0,
    sort: Number(doc.sort) || 0,
    // Read raw data: v13+ keep a deprecated TileDocument#overhead getter that warns when touched.
    overhead: (doc._source ?? doc).overhead !== undefined ? !!(doc._source ?? doc).overhead : null,
    level: doc.level ?? null,
    // 3D model shown instead of the image: a built-in id ("tree", "crate"...) or a .glb/.gltf path.
    model: doc.flags?.["foundry-3d-view"]?.modelFile || doc.flags?.["foundry-3d-view"]?.model || null,
    modelHeight: Number(doc.flags?.["foundry-3d-view"]?.modelHeight) || 1,
  };
}

/** Is the tile a roof? Explicit `overhead` (older data) wins; otherwise elevation >= foreground. */
export function isOverheadTile(t, foregroundElevation) {
  if (t.overhead !== null) return t.overhead;
  return Number.isFinite(foregroundElevation) && t.elevation >= foregroundElevation;
}

/**
 * World placement of a tile plane.
 * @param {object} t        tileData()
 * @param {object} grid
 * @param {object} o
 * @param {number} o.floorY world Y of the ground under the tile (floor tiles sit on it)
 * @param {number} o.roofY  world Y for roofs
 * @param {boolean} o.overhead
 */
export function tilePlacement(t, grid, { floorY = 0, roofY = 1.5, overhead = false }) {
  const c = canvasToWorld(grid, t.x + t.width / 2, t.y + t.height / 2);
  return {
    cx: c.x,
    cz: c.z,
    width: (t.width / grid.size) * Math.abs(t.scaleX),
    depth: (t.height / grid.size) * Math.abs(t.scaleY),
    // Foundry rotation is clockwise on screen; a positive three.js Y rotation is counter-clockwise
    // seen from above, hence the minus.
    angle: -(t.rotation * Math.PI) / 180,
    y: overhead ? roofY + 0.02 : floorY + 0.004 + Math.min(t.sort, 1000) * 1e-5,
    mirrorX: t.scaleX < 0,
    mirrorY: t.scaleY < 0,
  };
}

/** Does a (possibly rotated) tile cover canvas point (px, py)? */
export function tileContainsPoint(t, px, py) {
  const cx = t.x + t.width / 2, cy = t.y + t.height / 2;
  const a = (-t.rotation * Math.PI) / 180;
  const dx = px - cx, dy = py - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= t.width / 2 && Math.abs(ly) <= t.height / 2;
}

/* ------------------------------------------------------------------------------------------ */
/* Levels (Foundry v14 scene levels; best effort)                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * Read a scene's levels into [{id, name, bottom, top, background:{src, offsetX, offsetY}}],
 * sorted by bottom. Returns [] when the scene has no level collection (v13).
 */
export function levelsFromScene(scene) {
  const coll = scene?.levels;
  if (!coll) return [];
  const list = Array.from(coll.contents ?? coll.values?.() ?? coll);
  return list
    .map((l, i) => {
      const elev = l.elevation ?? {};
      const bottom = Number(elev.bottom ?? l.bottom ?? l.elevation ?? 0);
      const top = Number(elev.top ?? l.top ?? Infinity);
      const bg = l.background ?? {};
      // v14: image offsets live in level.textures; older/mock data kept them on background.
      const tx = l.textures ?? {};
      return {
        id: l.id ?? l._id ?? `level${i}`,
        name: l.name ?? `Level ${i + 1}`,
        bottom: Number.isFinite(bottom) ? bottom : 0,
        top: Number.isFinite(top) ? top : Infinity,
        sort: Number(l.sort) || 0,
        background: {
          src: bg.src ?? null,
          color: bg.color ? String(bg.color) : null,
          offsetX: Number(tx.offsetX ?? bg.offsetX) || 0,
          offsetY: Number(tx.offsetY ?? bg.offsetY) || 0,
        },
      };
    })
    .sort((a, b) => a.bottom - b.bottom || a.sort - b.sort);
}

/** Does this scene use v14 native levels (every v14 scene has at least one)? */
export function hasNativeLevels(scene) {
  const coll = scene?.levels;
  if (!coll || typeof coll !== "object") return false;
  return (coll.size ?? coll.contents?.length ?? coll.length ?? 0) > 0;
}

/**
 * Index of the level a document belongs to: an explicit level id (doc.level or first of
 * doc.levels) wins, otherwise its elevation (bottom of the wall / token elevation).
 */
export function levelIndexFor(doc, levels) {
  if (!levels.length) return 0;
  const ids = [];
  if (doc.level) ids.push(typeof doc.level === "string" ? doc.level : doc.level.id);
  if (doc.levels) for (const l of doc.levels) ids.push(typeof l === "string" ? l : l?.id);
  for (const id of ids) {
    const i = levels.findIndex((l) => l.id === id);
    if (i >= 0) return i;
  }
  const e = Number(doc.elevation ?? doc.bottom ?? 0) || 0;
  let idx = 0;
  for (let i = 0; i < levels.length; i++) if (e >= levels[i].bottom - 1e-6) idx = i;
  return idx;
}

/** World Y of a level floor. */
export function levelFloorY(level, grid) {
  return unitsToWorldY(grid, level?.bottom ?? 0);
}

/* ------------------------------------------------------------------------------------------ */
/* Measurement                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Foundry v12+ CONST.GRID_DIAGONALS. */
export const DIAGONALS = Object.freeze({
  EQUIDISTANT: 0, EXACT: 1, APPROXIMATE: 2, RECTILINEAR: 3, ALTERNATING_1: 4, ALTERNATING_2: 5, ILLEGAL: 6,
});

/** Number of squares between two cells under a diagonal rule. */
export function gridSquares(a, b, rule = DIAGONALS.EQUIDISTANT) {
  const dx = Math.abs(b.col - a.col);
  const dy = Math.abs(b.row - a.row);
  const diag = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diag;
  switch (rule) {
    case DIAGONALS.EXACT: return straight + diag * Math.SQRT2;
    case DIAGONALS.APPROXIMATE: return straight + diag * 1.5;
    case DIAGONALS.RECTILINEAR:
    case DIAGONALS.ILLEGAL: return dx + dy;
    case DIAGONALS.ALTERNATING_1: return straight + diag + Math.floor(diag / 2); // 5/10/5
    case DIAGONALS.ALTERNATING_2: return straight + diag + Math.ceil(diag / 2); // 10/5/10
    default: return straight + diag;
  }
}

/** Cells on a straight line between two cells (inclusive), for drawing a path. */
export function lineCells(a, b) {
  const out = [];
  const n = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push({ col: Math.round(a.col + (b.col - a.col) * t), row: Math.round(a.row + (b.row - a.row) * t) });
  }
  return out;
}

/** "30 ft" / "7.5 m" style label, with an optional height difference. */
export function formatDistance(squares, distance, units, heightDiffUnits = 0) {
  const d = Math.round(squares * distance * 100) / 100;
  let s = `${d}${units ? ` ${units}` : ""}`;
  const h = Math.round(heightDiffUnits * 100) / 100;
  if (h) s += ` (${h > 0 ? "+" : ""}${h})`;
  return s;
}
