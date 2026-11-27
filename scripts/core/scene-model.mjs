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
 *   tiles:      tileData()[]
 *   lights:     lightData()[] (+ token lights)  // canvas px, radii in grid units
 *   darkness:   0..1
 *   foregroundElevation: number                 // tiles at/above it are roofs
 *   levels:     [{ id, name, bottom, top, background:{src,x,y,width,height} }]  // [] = single level
 * }
 * Walls, tokens and tiles carry `levelIndex` (0 = ground / only level).
 */
import { makeGrid } from "./coords.mjs";
import { normalizeHeightMap } from "./heights.mjs";
import { wallData } from "./walls.mjs";
import { MODULE_ID } from "./constants.mjs";
import { tileData, lightData, tokenLightData, levelsFromScene, levelIndexFor, hasNativeLevels } from "./scene-extras.mjs";

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
 * Find the ground background in a version-tolerant way. v14 keeps it on the lowest level (the
 * Scene#background getter is deprecated there and always reads the first-created level, so it is
 * never touched); v13 has scene.background.
 */
export function sceneBackground(scene) {
  if (hasNativeLevels(scene)) {
    const ground = levelsFromScene(scene)[0];
    return { src: ground?.background.src ?? null, offsetX: ground?.background.offsetX ?? 0, offsetY: ground?.background.offsetY ?? 0 };
  }
  const bg = scene.background ?? null;
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
 * @param {object} [options]
 * @param {string} [options.viewedLevelId]  v14: id of the level being viewed (canvas.level.id)
 */
export function buildSceneModel(scene, dimensions, { viewedLevelId = null } = {}) {
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
  const levels = levelsFromScene(scene).map((l) => ({
    ...l,
    background: {
      src: l.background.src,
      color: l.background.color,
      x: grid.sceneX + l.background.offsetX,
      y: grid.sceneY + l.background.offsetY,
      width: grid.sceneWidth,
      height: grid.sceneHeight,
    },
  }));
  const withLevel = (doc, data) => ({ ...data, levelIndex: levelIndexFor(doc, levels) });
  const walls = Array.from(scene.walls ?? []).map((d) => {
    const w = wallData(d);
    return withLevel({ level: d.level, levels: d.levels, elevation: w.bottom ?? 0 }, w);
  });
  const tokenDocs = Array.from(scene.tokens ?? []);
  const tokens = tokenDocs.map((d) => withLevel(d, tokenData(d)));
  const tiles = Array.from(scene.tiles ?? []).map((d) => withLevel(d, tileData(d)));
  const lights = [
    ...Array.from(scene.lights ?? []).map(lightData),
    ...tokenDocs.map(tokenLightData).filter(Boolean),
  ];
  const heights = normalizeHeightMap(scene.flags?.[MODULE_ID]?.heights, grid.cols, grid.rows);
  const native = hasNativeLevels(scene);
  const viewedIdx = Math.max(0, levels.findIndex((l) => l.id === viewedLevelId));
  const viewed = levels[viewedIdx];
  // v14: colour and roof height come from the viewed level (the Scene getters are deprecated).
  const backgroundColor = native ? viewed?.background.color ?? levels[0]?.background.color : scene.backgroundColor;
  const fgElevation = native
    ? (Number.isFinite(viewed?.top) ? viewed.top : (viewed?.bottom ?? 0) + (Number(scene.grid?.distance) || 5) * 4)
    : scene.foregroundElevation;
  return {
    grid,
    background: {
      src: bg.src,
      x: grid.sceneX + bg.offsetX,
      y: grid.sceneY + bg.offsetY,
      width: grid.sceneWidth,
      height: grid.sceneHeight,
    },
    backgroundColor: backgroundColor ?? "#1b1b1f",
    viewedLevelIndex: levels.length > 1 ? viewedIdx : null,
    walls,
    tokens,
    tiles,
    lights,
    darkness: Number(scene.environment?.darknessLevel ?? scene.darkness ?? 0) || 0,
    foregroundElevation: Number(fgElevation ?? scene.grid?.distance * 4) || 20,
    levels,
    heights,
  };
}

/** Same as buildSceneModel but from a plain JSON description (dev page / tests). */
export function modelFromJSON(json) {
  const grid = makeGrid(json.grid);
  const levels = (json.levels ?? []).map((l, i) => ({
    id: l.id ?? `level${i}`,
    name: l.name ?? `Level ${i + 1}`,
    bottom: Number(l.bottom) || 0,
    top: l.top ?? Infinity,
    background: {
      src: l.background?.src ?? null,
      x: l.background?.x ?? grid.sceneX,
      y: l.background?.y ?? grid.sceneY,
      width: l.background?.width ?? grid.sceneWidth,
      height: l.background?.height ?? grid.sceneHeight,
    },
  }));
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
    walls: (json.walls ?? []).map((d) => ({ ...wallData(d), levelIndex: levelIndexFor(d, levels) })),
    tokens: (json.tokens ?? []).map((d) => ({ ...tokenData(d), levelIndex: levelIndexFor(d, levels) })),
    tiles: (json.tiles ?? []).map((d) => ({ ...tileData(d), levelIndex: levelIndexFor(d, levels) })),
    lights: [...(json.lights ?? []).map(lightData), ...(json.tokens ?? []).map(tokenLightData).filter(Boolean)],
    darkness: Number(json.darkness) || 0,
    foregroundElevation: Number(json.foregroundElevation ?? 20),
    levels,
    heights: normalizeHeightMap(json.heights, grid.cols, grid.rows),
  };
}
