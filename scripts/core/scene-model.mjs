/**
 * Plain "scene model" consumed by the 3D renderer. It can be produced from a live Foundry scene
 * (see foundry/adapter.mjs) or written by hand as JSON (see dev/sample-scene.json).
 *
 * {
 *   grid:       makeGrid() input  { size, sceneX, sceneY, sceneWidth, sceneHeight, width, height, distance }
 *   background: { src, x, y, width, height }   // canvas px; src may be a URL or a canvas/image element
 *   walls:      wallData()[]
 *   tokens:     tokenData()[]
 *   heights:    { cols, rows, data }            // grid distance units
 * }
 */
import { makeGrid } from "./coords.mjs";
import { normalizeHeightMap } from "./heights.mjs";
import { wallData } from "./walls.mjs";
import { MODULE_ID } from "./constants.mjs";

/** Normalize a token document (or plain object) to what the renderer needs. */
export function tokenData(doc) {
  const tex = doc.texture ?? {};
  return {
    id: doc.id ?? doc._id,
    name: doc.name ?? "",
    x: Number(doc.x) || 0,
    y: Number(doc.y) || 0,
    width: Number(doc.width) || 1,
    height: Number(doc.height) || 1,
    elevation: Number(doc.elevation) || 0,
    src: tex.src ?? doc.src ?? null,
    scaleX: Math.abs(Number(tex.scaleX ?? 1)) || 1,
    scaleY: Math.abs(Number(tex.scaleY ?? 1)) || 1,
    mirrorX: Number(tex.scaleX ?? 1) < 0,
    hidden: !!doc.hidden,
    disposition: Number(doc.disposition ?? 0),
  };
}

/**
 * Find the scene background in a version-tolerant way (v13 `scene.background`, v14 levels,
 * legacy `scene.img`).
 */
export function sceneBackground(scene) {
  const bg =
    scene.background ??
    scene.initialLevel?.background ??
    scene.firstLevel?.background ??
    scene.levels?.contents?.[0]?.background ??
    null;
  return {
    src: bg?.src ?? scene.img ?? null,
    offsetX: Number(bg?.offsetX) || 0,
    offsetY: Number(bg?.offsetY) || 0,
  };
}

/**
 * Build the model from Foundry-like objects.
 * @param {object} scene       Scene document (needs walls, tokens, flags, background)
 * @param {object} dimensions  canvas.dimensions (size, sceneX, sceneY, sceneWidth, sceneHeight, width, height, distance)
 */
export function buildSceneModel(scene, dimensions) {
  const grid = makeGrid({
    size: dimensions.size,
    sceneX: dimensions.sceneX,
    sceneY: dimensions.sceneY,
    sceneWidth: dimensions.sceneWidth,
    sceneHeight: dimensions.sceneHeight,
    width: dimensions.width,
    height: dimensions.height,
    distance: dimensions.distance ?? scene.grid?.distance,
  });
  const bg = sceneBackground(scene);
  const walls = Array.from(scene.walls ?? []).map(wallData);
  const tokens = Array.from(scene.tokens ?? []).map(tokenData);
  const heights = normalizeHeightMap(scene.flags?.[MODULE_ID]?.heights, grid.cols, grid.rows);
  return {
    grid,
    background: {
      src: bg.src,
      x: grid.sceneX + bg.offsetX,
      y: grid.sceneY + bg.offsetY,
      width: grid.sceneWidth,
      height: grid.sceneHeight,
    },
    backgroundColor: scene.backgroundColor ?? "#1b1b1f",
    walls,
    tokens,
    heights,
  };
}

/** Same as buildSceneModel but from a plain JSON description (dev page / tests). */
export function modelFromJSON(json) {
  const grid = makeGrid(json.grid);
  return {
    grid,
    background: {
      src: json.background?.src ?? null,
      x: json.background?.x ?? grid.sceneX,
      y: json.background?.y ?? grid.sceneY,
      width: json.background?.width ?? grid.sceneWidth,
      height: json.background?.height ?? grid.sceneHeight,
    },
    backgroundColor: json.backgroundColor ?? "#1b1b1f",
    walls: (json.walls ?? []).map(wallData),
    tokens: (json.tokens ?? []).map(tokenData),
    heights: normalizeHeightMap(json.heights, grid.cols, grid.rows),
  };
}
