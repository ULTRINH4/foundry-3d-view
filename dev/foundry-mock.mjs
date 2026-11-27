/**
 * A tiny fake of the Foundry VTT globals the module touches (Hooks, game, canvas, ui, foundry,
 * CONST and documents that fire hooks on update). It lets scripts/main.mjs and the controller run
 * end to end in a plain browser. It is NOT Foundry: it only mirrors the public API shapes we use
 * (v13 style). URL params: ?gm=0 (play as a player), ?selftest=1.
 */
import { segmentsIntersect } from "../scripts/core/heights.mjs";
import { losVisibilityTest, blocksSight } from "../scripts/core/vision.mjs";
import { wallData } from "../scripts/core/walls.mjs";
import { gridSquares, DIAGONALS } from "../scripts/core/scene-extras.mjs";
import { makeGrid } from "../scripts/core/coords.mjs";

const params = new URLSearchParams(location.search);
const IS_GM = params.get("gm") !== "0";
const MODULE_ID = "foundry-3d-view";

/* --- utils ----------------------------------------------------------------------------------- */
function getProperty(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function hasProperty(obj, path) {
  return getProperty(obj, path) !== undefined;
}
function expandObject(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split(".");
    let o = out;
    parts.slice(0, -1).forEach((p) => (o = o[p] ??= {}));
    o[parts.at(-1)] = v;
  }
  return out;
}
function mergeInto(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof HTMLCanvasElement)) {
      target[k] ??= {};
      mergeInto(target[k], v);
    } else target[k] = v;
  }
}

/* --- Hooks ----------------------------------------------------------------------------------- */
const hookMap = new Map();
let hookId = 0;
const Hooks = {
  on(name, fn) {
    const id = ++hookId;
    if (!hookMap.has(name)) hookMap.set(name, new Map());
    hookMap.get(name).set(id, fn);
    return id;
  },
  once(name, fn) {
    const id = Hooks.on(name, (...a) => {
      Hooks.off(name, id);
      return fn(...a);
    });
    return id;
  },
  off(name, id) {
    hookMap.get(name)?.delete(id);
  },
  callAll(name, ...args) {
    for (const fn of [...(hookMap.get(name)?.values() ?? [])]) fn(...args);
    return true;
  },
  count: (name) => hookMap.get(name)?.size ?? 0,
};

/* --- documents ------------------------------------------------------------------------------- */
class Collection {
  constructor(docs = []) {
    this.map = new Map(docs.map((d) => [d.id, d]));
  }
  get(id) {
    return this.map.get(id);
  }
  get contents() {
    return [...this.map.values()];
  }
  get size() {
    return this.map.size;
  }
  set(doc) {
    this.map.set(doc.id, doc);
  }
  delete(id) {
    this.map.delete(id);
  }
  [Symbol.iterator]() {
    return this.map.values();
  }
}

class MockDocument {
  constructor(type, data, parent) {
    Object.assign(this, structuredCloneSafe(data));
    this.documentName = type;
    this.id = data._id ?? data.id;
    this._id = this.id;
    this.parent = parent;
  }
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }
  async update(changes) {
    const nested = expandObject(changes);
    mergeInto(this, nested);
    Hooks.callAll(`update${this.documentName}`, this, nested, {}, "user");
    return this;
  }
}
function structuredCloneSafe(d) {
  const out = {};
  for (const [k, v] of Object.entries(d)) out[k] = v instanceof HTMLCanvasElement ? v : (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
  if (d.texture?.src instanceof HTMLCanvasElement) out.texture = { ...JSON.parse(JSON.stringify({ ...d.texture, src: null })), src: d.texture.src };
  if (d.background?.src instanceof HTMLCanvasElement) out.background = { ...d.background };
  return out;
}

class MockToken {
  constructor(doc) {
    this.document = doc;
    this.x = doc.x;
    this.y = doc.y;
    this.controlled = false;
  }
  get center() {
    const s = canvas.dimensions.size;
    return { x: this.x + (this.document.width * s) / 2, y: this.y + (this.document.height * s) / 2 };
  }
  get isOwner() {
    return game.user.isGM || this.document.disposition === 1;
  }
  get isVisible() {
    if (game.user.isGM) return true;
    if (this.document.hidden) return false;
    if (this.isOwner) return true;
    return canvas.visibility.testVisibility(this.center);
  }
  control({ releaseOthers = true } = {}) {
    if (releaseOthers) canvas.tokens.releaseAll(this);
    this.controlled = true;
    Hooks.callAll("controlToken", this, true);
    return true;
  }
  release() {
    this.controlled = false;
    Hooks.callAll("controlToken", this, false);
  }
  checkCollision(dest) {
    const o = this.center;
    return canvas.scene.walls.contents.some((w) => {
      const d = wallData(w);
      if (d.move === 0 || (d.door && d.ds === 1)) return false;
      return segmentsIntersect(o.x, o.y, dest.x, dest.y, d.c[0], d.c[1], d.c[2], d.c[3]);
    });
  }
}

/* --- build the world from the sample scene ---------------------------------------------------- */
export async function bootMockFoundry({ art }) {
  const json = await fetch("./sample-scene.json").then((r) => r.json());
  const lang = await fetch(`../lang/${params.get("lang") ?? "en"}.json`).then((r) => r.json());
  const g = json.grid;
  const scene = new MockDocument("Scene", { _id: "scene1", name: json.name, flags: { [MODULE_ID]: { heights: json.heights } } }, null);
  scene.grid = { type: 1, size: g.size, distance: g.distance, units: "ft", diagonals: DIAGONALS.ALTERNATING_1 };
  scene.background = { src: art.dungeon, offsetX: 0, offsetY: 0 };
  scene.backgroundColor = json.backgroundColor;
  scene.tokenVision = true;
  scene.environment = { darknessLevel: json.darkness };
  scene.foregroundElevation = json.foregroundElevation;
  scene.walls = new Collection(json.walls.map((w) => new MockDocument("Wall", { move: 20, sight: 20, door: 0, ds: 0, ...w }, scene)));
  scene.tokens = new Collection(json.tokens.map((t) => new MockDocument("Token", { ...t, texture: { src: art.token(t) } }, scene)));
  scene.tiles = new Collection(json.tiles.map((t) => new MockDocument("Tile", { ...t, texture: { src: art.tile(t) } }, scene)));
  scene.lights = new Collection(json.lights.map((l) => new MockDocument("AmbientLight", l, scene)));
  // Levels need v14; keep the mock v13-like (no levels) unless ?levels=1.
  if (params.has("levels")) scene.levels = { contents: json.levels.map((l) => ({ id: l.id, name: l.name, elevation: { bottom: l.bottom }, background: { src: art.level(l) } })) };

  const dims = makeGrid(g);
  const placeables = new Map(scene.tokens.contents.map((d) => [d.id, new MockToken(d)]));

  globalThis.CONST = { WALL_SENSE_TYPES: { NONE: 0, NORMAL: 20 }, GRID_TYPES: { GRIDLESS: 0, SQUARE: 1 } };
  globalThis.Hooks = Hooks;
  globalThis.foundry = {
    utils: { getProperty, hasProperty, getRoute: (p) => `/${p}` },
    applications: { api: { DialogV2: { confirm: async () => true } } },
  };
  const notes = [];
  globalThis.ui = {
    notifications: { warn: (m) => notes.push(["warn", m]), info: (m) => notes.push(["info", m]), log: notes },
    controls: { render: () => {} },
  };
  const settings = new Map();
  globalThis.game = {
    user: { id: "user", isGM: IS_GM },
    paused: false,
    i18n: { localize: (k) => lang[k] ?? k },
    settings: {
      register: (mod, key, cfg) => settings.set(`${mod}.${key}`, { cfg, value: cfg.default }),
      get: (mod, key) => {
        if (mod === "core" && key === "gridDiagonals") return DIAGONALS.EQUIDISTANT;
        return settings.get(`${mod}.${key}`)?.value;
      },
      set: async (mod, key, v) => {
        const entry = settings.get(`${mod}.${key}`);
        entry.value = v;
        entry.cfg.onChange?.(v);
        return v;
      },
      registry: settings,
    },
    keybindings: { register: (mod, key, cfg) => (game.keybindings.registry[`${mod}.${key}`] = cfg), registry: {} },
    modules: new Map([[MODULE_ID, { id: MODULE_ID, active: true }]]),
    scenes: { viewed: scene },
  };
  globalThis.canvas = {
    ready: true,
    scene,
    dimensions: { size: g.size, sceneX: g.sceneX, sceneY: g.sceneY, sceneWidth: g.sceneWidth, sceneHeight: g.sceneHeight, width: dims.width, height: dims.height, distance: g.distance },
    grid: {
      type: 1,
      size: g.size,
      measurePath: ([a, b]) => {
        const ca = { col: Math.floor((a.x - g.sceneX) / g.size), row: Math.floor((a.y - g.sceneY) / g.size) };
        const cb = { col: Math.floor((b.x - g.sceneX) / g.size), row: Math.floor((b.y - g.sceneY) / g.size) };
        return { distance: gridSquares(ca, cb, DIAGONALS.ALTERNATING_1) * g.distance };
      },
    },
    environment: { darknessLevel: json.darkness },
    tokens: {
      get: (id) => placeables.get(id),
      get placeables() {
        return [...placeables.values()];
      },
      get controlled() {
        return [...placeables.values()].filter((p) => p.controlled);
      },
      releaseAll(except) {
        for (const p of placeables.values()) if (p !== except && p.controlled) p.release();
      },
    },
    visibility: {
      testVisibility(point) {
        if (game.user.isGM) return true;
        const sources = [...placeables.values()].filter((p) => p.isOwner).map((p) => ({ ...p.center, radius: Infinity }));
        const walls = scene.walls.contents.map((w) => wallData(w)).filter(blocksSight);
        return losVisibilityTest(sources, walls, dims)(point.x, point.y);
      },
    },
  };

  // Token updates move the placeable (instantly, then a refreshToken like Foundry's animation end).
  Hooks.on("updateToken", (doc, changes) => {
    const p = placeables.get(doc.id);
    if (p && ("x" in changes || "y" in changes)) {
      p.x = doc.x;
      p.y = doc.y;
      Hooks.callAll("refreshToken", p, {});
      Hooks.callAll("sightRefresh");
    }
  });
  Hooks.on("updateWall", () => Hooks.callAll("sightRefresh"));

  // Load the real module and run Foundry's lifecycle.
  await import("../scripts/main.mjs");
  Hooks.callAll("init");
  Hooks.callAll("setup");
  Hooks.callAll("ready");
  Hooks.callAll("canvasReady", canvas);
  return { scene, placeables, notes, settings };
}
