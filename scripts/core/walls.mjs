/**
 * Foundry wall segment -> 3D box parameters. Pure math, no three.js.
 *
 * A wall becomes a box whose local X axis runs along the segment. In three.js a rotation of
 * `angle` around +Y maps local (1,0,0) to (cos a, 0, -sin a), so for a segment direction
 * (dx, dz) we use angle = atan2(-dz, dx).
 */
import { canvasToWorld, unitsToWorldY } from "./coords.mjs";
import { DOOR_STATE, WALL_DOOR, WALL_SENSE } from "./constants.mjs";

/** Normalize a wall document (or its toObject()) to the fields we use. */
export function wallData(doc) {
  const c = Array.from(doc.c ?? [0, 0, 0, 0]).map(Number);
  const wh = doc.flags?.["wall-height"] ?? {};
  return {
    id: doc.id ?? doc._id,
    c,
    move: doc.move ?? WALL_SENSE.NORMAL,
    sight: doc.sight ?? WALL_SENSE.NORMAL,
    door: doc.door ?? WALL_DOOR.NONE,
    ds: doc.ds ?? DOOR_STATE.CLOSED,
    // Optional vertical extent in grid distance units (compatible with the "Wall Height" module flags).
    top: finiteOrNull(wh.top),
    bottom: finiteOrNull(wh.bottom),
  };
}

function finiteOrNull(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
}

/**
 * Should this wall be drawn? Invisible walls (they do not block sight) are skipped; doors
 * are always drawn.
 */
export function isRenderableWall(w) {
  if (w.door !== WALL_DOOR.NONE) return true;
  if (w.c[0] === w.c[2] && w.c[1] === w.c[3]) return false;
  return w.sight !== WALL_SENSE.NONE;
}

export function isDoor(w) {
  return w.door === WALL_DOOR.DOOR || w.door === WALL_DOOR.SECRET;
}

export function isDoorOpen(w) {
  return isDoor(w) && w.ds === DOOR_STATE.OPEN;
}

/**
 * Should a door be drawn as a door (true) or disguised as a plain wall (false) for this user?
 * Closed secret doors look like walls to players.
 */
export function showAsDoor(w, isGM) {
  if (w.door === WALL_DOOR.DOOR) return true;
  if (w.door === WALL_DOOR.SECRET) return isGM || w.ds === DOOR_STATE.OPEN;
  return false;
}

/**
 * Vertical extent of a wall in world units.
 * @param {object} w            wallData()
 * @param {object} grid         makeGrid()
 * @param {object} opts
 * @param {number} opts.height  default wall height in world units (squares)
 * @param {number} [opts.base=0] world Y of the terrain under the wall
 */
export function wallVerticalExtent(w, grid, { height, base = 0 }) {
  const bottom = w.bottom !== null ? unitsToWorldY(grid, w.bottom) : 0;
  const top = w.top !== null ? unitsToWorldY(grid, w.top) : base + height;
  return { bottom, top: Math.max(top, bottom + 0.01) };
}

/**
 * Box for a wall segment.
 * @returns {{cx:number, cz:number, length:number, angle:number, thickness:number, bottom:number, top:number}}
 */
export function wallBox(w, grid, { height, thickness = 0.12, base = 0 }) {
  const a = canvasToWorld(grid, w.c[0], w.c[1]);
  const b = canvasToWorld(grid, w.c[2], w.c[3]);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const { bottom, top } = wallVerticalExtent(w, grid, { height, base });
  return {
    cx: (a.x + b.x) / 2,
    cz: (a.z + b.z) / 2,
    length: Math.hypot(dx, dz),
    angle: Math.atan2(-dz, dx),
    thickness,
    bottom,
    top,
  };
}

/**
 * Door pose: the door rotates around a hinge at the segment's first endpoint. The door mesh is
 * a child offset by +length/2 on local X. When open it swings 90 degrees.
 * @returns {{hx:number, hz:number, length:number, angle:number, closedAngle:number, bottom:number, top:number}}
 */
export function doorPose(w, grid, { height, base = 0, open = isDoorOpen(w) }) {
  const box = wallBox(w, grid, { height, base });
  const a = canvasToWorld(grid, w.c[0], w.c[1]);
  const swing = open ? Math.PI / 2 : 0;
  return {
    hx: a.x,
    hz: a.z,
    length: box.length,
    closedAngle: box.angle,
    angle: box.angle + swing,
    bottom: box.bottom,
    top: box.top,
  };
}

/** World position of the free (non-hinge) end of a door for a given pose; handy for tests. */
export function doorFreeEnd(pose) {
  return {
    x: pose.hx + Math.cos(pose.angle) * pose.length,
    z: pose.hz - Math.sin(pose.angle) * pose.length,
  };
}
