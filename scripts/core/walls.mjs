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
  const f3d = doc.flags?.["foundry-3d-view"] ?? {};
  const w = {
    id: doc.id ?? doc._id,
    c,
    move: doc.move ?? WALL_SENSE.NORMAL,
    sight: doc.sight ?? WALL_SENSE.NORMAL,
    door: doc.door ?? WALL_DOOR.NONE,
    ds: doc.ds ?? DOOR_STATE.CLOSED,
    // Optional vertical extent in grid distance units (compatible with the "Wall Height" module flags).
    top: finiteOrNull(wh.top),
    bottom: finiteOrNull(wh.bottom),
    // Optional per-wall 3D height in grid squares above the ground (0.5 = half wall).
    height: finiteOrNull(f3d.height),
    // Optional per-wall texture (set in the Wall config sheet or the bulk tool), how it fits
    // ("repeat" tiles, "height" spans the wall height) and its tile size in squares.
    texture: f3d.texture || null,
    textureFit: TEXTURE_FITS.includes(f3d.textureFit) ? f3d.textureFit : null,
    textureScale: finiteOrNull(f3d.textureScale) > 0 ? finiteOrNull(f3d.textureScale) : null,
    // Doors have their own texture, separate from the walls ("fit": one image per door leaf).
    doorTexture: f3d.doorTexture || null,
    doorTextureMode: DOOR_TEXTURE_MODES.includes(f3d.doorTextureMode) ? f3d.doorTextureMode : null,
  };
  w.kind = wallKind(w);
  return w;
}

/** What a wall is, for rendering. Mirrors Foundry's wall tools (walls layer presets). */
export const WALL_KIND = Object.freeze({
  WALL: "wall", DOOR: "door", WINDOW: "window", TERRAIN: "terrain", INVISIBLE: "invisible", ETHEREAL: "ethereal",
});

/**
 * Foundry's "Window" tool creates walls with PROXIMITY (or DISTANCE) sight; "Invisible" walls block
 * movement but not sight; "Ethereal" walls block neither (only light/sound); "Terrain" = LIMITED.
 */
export function wallKind(w) {
  if (w.door === WALL_DOOR.DOOR || w.door === WALL_DOOR.SECRET) return WALL_KIND.DOOR;
  if (w.sight === WALL_SENSE.NONE) return w.move === WALL_SENSE.NONE ? WALL_KIND.ETHEREAL : WALL_KIND.INVISIBLE;
  if (w.sight === WALL_SENSE.PROXIMITY || w.sight === WALL_SENSE.DISTANCE) return WALL_KIND.WINDOW;
  if (w.sight === WALL_SENSE.LIMITED) return WALL_KIND.TERRAIN;
  return WALL_KIND.WALL;
}

/**
 * Vertical layout of a window wall with an opening: solid below the sill and above the lintel,
 * a glass pane in between. Fractions of the wall height.
 */
export function windowSections(bottom, top, { sill = 0.35, lintel = 0.8 } = {}) {
  const h = top - bottom;
  const s = bottom + h * sill;
  const l = bottom + h * lintel;
  return {
    lower: { bottom, top: s },
    glass: { bottom: s, top: l },
    upper: { bottom: l, top },
  };
}

/** Material key for see-through parts (invisible walls, window panes). */
export function glassMaterialKey(w, { glassTexture = "" } = {}) {
  if (w.kind === WALL_KIND.INVISIBLE && w.texture) return `glass:${w.texture}`;
  return glassTexture ? `glass:${glassTexture}` : "glass";
}

/** Wall appearance modes (module setting). */
export const WALL_MODES = Object.freeze({ MAP: "map", TEXTURE: "texture", FLAT: "flat" });

/** Wall texture fits: "repeat" (tiles keeping the image's proportions) or "height" (spans the wall). */
export const TEXTURE_FITS = ["repeat", "height"];
/** Door texture modes: "fit" (one image stretched over each door leaf) or "repeat" (tiled). */
export const DOOR_TEXTURE_MODES = ["fit", "repeat"];

/** Material key of a wall texture: "tex:<fit>:<scale>:<src>". */
export function texKey(fit, scale, src) {
  return `tex:${fit === "height" ? "height" : "repeat"}:${Number(scale) > 0 ? Number(scale) : 1}:${src}`;
}

/** Parse a texKey (src may itself contain ":"). */
export function parseTexKey(key) {
  const m = /^tex:(repeat|height):([0-9.]+):(.+)$/.exec(key ?? "");
  return m ? { fit: m[1], scale: Number(m[2]), src: m[3] } : null;
}

/** Parse a door material key "door:<mode>:<src>". */
export function parseDoorKey(key) {
  const m = /^door:(fit|repeat):(.+)$/.exec(key ?? "");
  return m ? { mode: m[1], src: m[2] } : null;
}

/**
 * Which material a wall or door uses. Walls sharing a key are drawn together.
 *   "flat"          plain colour
 *   "map"           takes its look from the scene background image
 *   "tex:<src>"     a tiled texture
 *   "door" / "secretDoor"  plain door colours
 * Priority: per-wall texture > (doors) door texture > mode.
 * Closed secret doors seen by the GM always use "secretDoor" so they stay recognisable.
 * @param {object} w            wallData()
 * @param {object} o
 * @param {string} o.mode       WALL_MODES value
 * @param {string} [o.wallTexture]
 * @param {string} [o.doorTexture]
 * @param {boolean} [o.asDoor]  drawn as a door (see showAsDoor)
 * @param {boolean} [o.hasMap]  a background image is available
 */
export function wallMaterialKey(w, {
  mode = WALL_MODES.MAP, wallTexture = "", doorTexture = "", windowTexture = "", asDoor = false, hasMap = true,
  wallFit = "repeat", wallScale = 1, doorMode = "fit",
} = {}) {
  // Doors are separate from walls: their own texture, else the module's wooden door.
  if (asDoor) {
    if (w.door === WALL_DOOR.SECRET) return "secretDoor";
    const src = w.doorTexture || doorTexture;
    return src ? `door:${w.doorTextureMode || doorMode || "fit"}:${src}` : "door";
  }
  const src = w.texture || (w.kind === WALL_KIND.WINDOW && windowTexture) || (mode === WALL_MODES.TEXTURE && wallTexture) || "";
  if (src) return texKey(w.textureFit || wallFit, w.textureScale || wallScale, src);
  if (mode === WALL_MODES.MAP && hasMap) return "map";
  return "flat";
}

function finiteOrNull(v) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
}

/**
 * Should this wall be drawn? Doors always; ethereal walls never; invisible walls (they block
 * movement but not sight) only when `invisible` is not "hide" (they are drawn as glass).
 */
export function isRenderableWall(w, { invisible = "hide" } = {}) {
  if (w.door !== WALL_DOOR.NONE) return true;
  if (w.c[0] === w.c[2] && w.c[1] === w.c[3]) return false;
  const kind = w.kind ?? wallKind(w);
  if (kind === WALL_KIND.ETHEREAL) return false;
  if (kind === WALL_KIND.INVISIBLE) return invisible !== "hide";
  return true;
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
export function wallVerticalExtent(w, grid, { height, base = 0, level = null }) {
  // v14: a wall on a level can span that level's height (level = {bottom, top} in units).
  const levelBottom = level && Number.isFinite(level.bottom) ? unitsToWorldY(grid, level.bottom) : null;
  const levelTop = level && Number.isFinite(level.top) ? unitsToWorldY(grid, level.top) : null;
  const bottom = w.bottom !== null ? unitsToWorldY(grid, w.bottom) : levelBottom ?? 0;
  let top;
  if (w.top !== null) top = unitsToWorldY(grid, w.top); // Wall Height module flags
  else if (w.height !== null && w.height !== undefined) top = base + w.height; // per-wall 3D height (half walls)
  else if (levelTop !== null) top = levelTop;
  else top = base + height;
  return { bottom, top: Math.max(top, bottom + 0.01) };
}

/**
 * Box for a wall segment.
 * @returns {{cx:number, cz:number, length:number, angle:number, thickness:number, bottom:number, top:number}}
 */
export function wallBox(w, grid, { height, thickness = 0.12, base = 0, level = null }) {
  const a = canvasToWorld(grid, w.c[0], w.c[1]);
  const b = canvasToWorld(grid, w.c[2], w.c[3]);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const { bottom, top } = wallVerticalExtent(w, grid, { height, base, level });
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
export function doorPose(w, grid, { height, base = 0, level = null, open = isDoorOpen(w) }) {
  const box = wallBox(w, grid, { height, base, level });
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
