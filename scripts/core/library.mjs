/**
 * The module's built-in texture library and ambience themes. Pure data + helpers (the pictures are
 * drawn in code by render/texture-library.mjs). A library texture is referenced like a file, as
 * "f3d:<kind>/<name>", so it works anywhere a texture path does (settings, wall/door flags).
 */

export const LIBRARY_PREFIX = "f3d:";

/** @typedef {{id:string, kind:"wall"|"door"|"window"|"glass", name:string, alpha?:boolean}} LibraryEntry */

/** @type {LibraryEntry[]} */
export const LIBRARY = [
  // Walls
  { id: "wall/stone-blocks", kind: "wall", name: "StoneBlocks" },
  { id: "wall/dungeon-stone", kind: "wall", name: "DungeonStone" },
  { id: "wall/red-brick", kind: "wall", name: "RedBrick" },
  { id: "wall/mossy-brick", kind: "wall", name: "MossyBrick" },
  { id: "wall/planks", kind: "wall", name: "Planks" },
  { id: "wall/log-cabin", kind: "wall", name: "LogCabin" },
  { id: "wall/plaster", kind: "wall", name: "Plaster" },
  { id: "wall/timber-frame", kind: "wall", name: "TimberFrame" },
  { id: "wall/cave-rock", kind: "wall", name: "CaveRock" },
  { id: "wall/marble", kind: "wall", name: "Marble" },
  { id: "wall/metal-panels", kind: "wall", name: "MetalPanels" },
  { id: "wall/hedge", kind: "wall", name: "Hedge" },
  // Doors
  { id: "door/wood", kind: "door", name: "WoodDoor" },
  { id: "door/reinforced", kind: "door", name: "ReinforcedDoor" },
  { id: "door/double-ornate", kind: "door", name: "OrnateDoor" },
  { id: "door/iron-gate", kind: "door", name: "IronGate", alpha: true },
  { id: "door/stone-slab", kind: "door", name: "StoneDoor" },
  { id: "door/scifi", kind: "door", name: "SciFiDoor" },
  { id: "door/barn", kind: "door", name: "BarnDoor" },
  // Window frames (the solid parts around the pane)
  { id: "window/wood-frame", kind: "window", name: "WoodFrame" },
  { id: "window/stone-frame", kind: "window", name: "StoneFrame" },
  // Glass
  { id: "glass/clear", kind: "glass", name: "ClearGlass", alpha: true },
  { id: "glass/frosted", kind: "glass", name: "FrostedGlass", alpha: true },
  { id: "glass/stained", kind: "glass", name: "StainedGlass", alpha: true },
];

const BY_ID = new Map(LIBRARY.map((e) => [e.id, e]));

/** Is this texture path a library texture? */
export function isLibrarySrc(src) {
  return typeof src === "string" && src.startsWith(LIBRARY_PREFIX) && BY_ID.has(src.slice(LIBRARY_PREFIX.length));
}

/** Library entry for a path ("f3d:wall/marble"), or null. */
export function libraryEntry(src) {
  return typeof src === "string" && src.startsWith(LIBRARY_PREFIX) ? BY_ID.get(src.slice(LIBRARY_PREFIX.length)) ?? null : null;
}

/** Entries of one kind (for the picker). */
export function libraryOf(kind) {
  return LIBRARY.filter((e) => e.kind === kind);
}

export const lib = (id) => LIBRARY_PREFIX + id;

/**
 * Ambience themes: one click sets a scene's walls, doors, window frames, glass, background ("sky")
 * colour and whether dust floats in the air.
 */
export const THEMES = Object.freeze({
  dungeon: { wallTexture: lib("wall/dungeon-stone"), doorTexture: lib("door/reinforced"), windowTexture: lib("window/stone-frame"), glassTexture: lib("glass/frosted"), sky: "#07070b", dust: true },
  tavern: { wallTexture: lib("wall/planks"), doorTexture: lib("door/wood"), windowTexture: lib("window/wood-frame"), glassTexture: lib("glass/clear"), sky: "#140c06", dust: false },
  castle: { wallTexture: lib("wall/stone-blocks"), doorTexture: lib("door/double-ornate"), windowTexture: lib("window/stone-frame"), glassTexture: lib("glass/stained"), sky: "#0a0c14", dust: false },
  cave: { wallTexture: lib("wall/cave-rock"), doorTexture: lib("door/wood"), windowTexture: lib("window/stone-frame"), glassTexture: lib("glass/frosted"), sky: "#050505", dust: true },
  village: { wallTexture: lib("wall/timber-frame"), doorTexture: lib("door/barn"), windowTexture: lib("window/wood-frame"), glassTexture: lib("glass/clear"), sky: "#101820", dust: false },
  mansion: { wallTexture: lib("wall/plaster"), doorTexture: lib("door/double-ornate"), windowTexture: lib("window/wood-frame"), glassTexture: lib("glass/stained"), sky: "#0c0a10", dust: false },
  scifi: { wallTexture: lib("wall/metal-panels"), doorTexture: lib("door/scifi"), windowTexture: lib("window/stone-frame"), glassTexture: lib("glass/clear"), sky: "#03060c", dust: false },
});
export const THEME_LIST = Object.keys(THEMES);

const STYLE_KEYS = ["wallTexture", "doorTexture", "windowTexture", "glassTexture"];

/**
 * The wall style for a scene: the scene's own picks win, then its theme, then the world settings.
 * A scene (or theme) wall texture switches the wall look to "texture" for that scene.
 * @param {object} world   world settings (wallMode, wallTexture, doorTexture, ...)
 * @param {object} [scene] scene flags {theme, wallTexture, doorTexture, windowTexture, glassTexture, sky, dust}
 * @returns {object} world style with overrides, plus `sky` (css colour or null) and `dust` (boolean)
 */
export function resolveSceneStyle(world, scene = {}) {
  const theme = THEMES[scene?.theme] ?? null;
  const out = { ...world, sky: null, dust: false, theme: theme ? scene.theme : null };
  for (const k of STYLE_KEYS) {
    const v = scene?.[k] || theme?.[k];
    if (v) out[k] = v;
  }
  if (scene?.wallTexture || theme?.wallTexture) out.wallMode = "texture";
  out.sky = scene?.sky || theme?.sky || null;
  out.dust = typeof scene?.dust === "boolean" ? scene.dust : !!theme?.dust;
  return out;
}

/** Foundry scene weather ids we draw in 3D, and how. */
export const WEATHER = Object.freeze({
  rain: { kind: "rain", count: 1400, speed: 9 },
  rainStorm: { kind: "rain", count: 2600, speed: 13 },
  snow: { kind: "snow", count: 1200, speed: 1.2 },
  blizzard: { kind: "snow", count: 2600, speed: 3 },
  leaves: { kind: "leaves", count: 260, speed: 0.9 },
  fog: { kind: "fog", count: 70, speed: 0.15 },
});

/** Weather settings for a Foundry weather id (null = none / unknown). */
export function weatherFor(id) {
  return WEATHER[id] ?? null;
}

/**
 * Torch-like flicker for a light's animation type: a smooth pseudo-random multiplier in
 * [1 - depth, 1]. `t` in seconds, `seed` keeps lights out of step.
 */
export function flickerFactor(type, t, seed = 0) {
  const depth = { torch: 0.22, flame: 0.3, fairy: 0.15, candle: 0.18, ghost: 0.25 }[type];
  if (!depth) return 1;
  const n = 0.5 * Math.sin(t * 7.3 + seed) + 0.3 * Math.sin(t * 13.1 + seed * 2.1) + 0.2 * Math.sin(t * 23.7 + seed * 0.7);
  return 1 - depth * (0.5 + 0.5 * n);
}
