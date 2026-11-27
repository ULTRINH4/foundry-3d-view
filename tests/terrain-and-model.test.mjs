import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import { createHeightMap, setHeight } from "../scripts/core/heights.mjs";
import { buildTerrainArrays, buildGridLines, triangleNormal } from "../scripts/core/terrain.mjs";
import { buildSceneModel, modelFromJSON, tokenData, sceneBackground } from "../scripts/core/scene-model.mjs";
import { MODULE_ID } from "../scripts/core/constants.mjs";

const grid = makeGrid({ size: 100, sceneX: 0, sceneY: 0, sceneWidth: 200, sceneHeight: 100, distance: 5 });
const bg = { x: 0, y: 0, width: 200, height: 100 };

function triangles(arr) {
  const out = [];
  const p = (i) => [arr.positions[i * 3], arr.positions[i * 3 + 1], arr.positions[i * 3 + 2]];
  const n = (i) => [arr.normals[i * 3], arr.normals[i * 3 + 1], arr.normals[i * 3 + 2]];
  for (let t = 0; t < arr.indices.length; t += 3) {
    const [a, b, c] = [arr.indices[t], arr.indices[t + 1], arr.indices[t + 2]];
    out.push({ pts: [p(a), p(b), p(c)], normal: n(a) });
  }
  return out;
}

describe("buildTerrainArrays", () => {
  it("flat map: one top quad per cell plus outer edge sides only when raised", () => {
    const arr = buildTerrainArrays(createHeightMap(2, 1), grid, bg);
    expect(arr.groups[0].count).toBe(2 * 6);
    expect(arr.groups[1].count).toBe(0);
    expect(arr.positions.length / 3).toBe(8);
  });

  it("raised cell gets side walls down to its neighbours and the map edge", () => {
    const map = setHeight(createHeightMap(2, 1), 0, 0, 10); // 2 world units tall
    const arr = buildTerrainArrays(map, grid, bg);
    // cell 0 is raised: 4 sides (3 map edges + the edge toward cell 1)
    expect(arr.groups[1].count).toBe(4 * 6);
    const ys = new Set();
    for (let i = 1; i < arr.positions.length; i += 3) ys.add(arr.positions[i]);
    expect([...ys].sort()).toEqual([0, 2]);
  });

  it("every triangle faces along its declared normal (correct winding)", () => {
    let map = createHeightMap(2, 1);
    map = setHeight(map, 1, 0, 5);
    const arr = buildTerrainArrays(map, grid, bg);
    for (const tri of triangles(arr)) {
      const n = triangleNormal(...tri.pts);
      const dot = n[0] * tri.normal[0] + n[1] * tri.normal[1] + n[2] * tri.normal[2];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("UVs map the background rect with v flipped (three.js flipY)", () => {
    const arr = buildTerrainArrays(createHeightMap(2, 1), grid, bg);
    // first vertex = top-left corner of cell 0 = canvas (0,0) -> uv (0,1)
    expect([arr.uvs[0], arr.uvs[1]]).toEqual([0, 1]);
    // third vertex = bottom-right of cell 0 = canvas (100,100) -> uv (0.5, 0)
    expect([arr.uvs[4], arr.uvs[5]]).toEqual([0.5, 0]);
  });

  it("grid lines: 4 segments per cell lifted above the top", () => {
    const lines = buildGridLines(setHeight(createHeightMap(2, 1), 0, 0, 5), grid, 0.01);
    expect(lines.length).toBe(2 * 4 * 2 * 3);
    expect(lines[1]).toBeCloseTo(1.01);
  });
});

describe("scene model", () => {
  it("normalizes tokens", () => {
    const t = tokenData({ _id: "t", x: 100, y: 200, texture: { src: "a.png", scaleX: -1.5 }, elevation: "10" });
    expect(t).toMatchObject({ id: "t", width: 1, height: 1, elevation: 10, src: "a.png", scaleX: 1.5, mirrorX: true });
  });

  it("finds the background on v13 and v14-like scenes", () => {
    expect(sceneBackground({ background: { src: "a.webp", offsetX: 5 } })).toEqual({ src: "a.webp", offsetX: 5, offsetY: 0 });
    expect(sceneBackground({ levels: { contents: [{ background: { src: "l.webp" } }] } }).src).toBe("l.webp");
    expect(sceneBackground({ img: "old.png" }).src).toBe("old.png");
  });

  it("builds from a Foundry-like scene", () => {
    const scene = {
      background: { src: "map.webp", offsetX: 10, offsetY: -20 },
      walls: [{ id: "w", c: [0, 0, 100, 0] }],
      tokens: [{ id: "t", x: 0, y: 0, texture: { src: "x.png" } }],
      flags: { [MODULE_ID]: { heights: { cols: 2, rows: 1, data: [5, 0] } } },
      grid: { distance: 5 },
    };
    const dims = { size: 100, sceneX: 100, sceneY: 100, sceneWidth: 200, sceneHeight: 100, width: 400, height: 300 };
    const m = buildSceneModel(scene, dims);
    expect(m.grid).toMatchObject({ cols: 2, rows: 1, distance: 5 });
    expect(m.background).toEqual({ src: "map.webp", x: 110, y: 80, width: 200, height: 100 });
    expect(m.heights.data).toEqual([5, 0]);
    expect(m.walls[0].id).toBe("w");
    expect(m.tokens[0].src).toBe("x.png");
  });

  it("builds from JSON with sensible defaults", () => {
    const m = modelFromJSON({ grid: { size: 50, sceneWidth: 100, sceneHeight: 100 } });
    expect(m.heights).toEqual({ cols: 2, rows: 2, data: [0, 0, 0, 0] });
    expect(m.background).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("Foundry v14 scenes (native levels)", () => {
  /** A v14-like scene whose deprecated Scene getters throw if touched. */
  function v14Scene() {
    const scene = {
      walls: [
        { id: "wAll", c: [0, 0, 100, 0], levels: new Set() },
        { id: "wUp", c: [0, 100, 100, 100], levels: new Set(["up"]) },
      ],
      tokens: [
        { id: "tG", x: 0, y: 0, level: "ground" },
        { id: "tU", x: 100, y: 0, level: "up", elevation: 10 },
      ],
      tiles: [{ id: "roof", x: 0, y: 0, width: 100, height: 100, elevation: 10, texture: { src: "r.png" }, levels: new Set(["ground"]) }],
      lights: [],
      flags: {},
      grid: { distance: 5 },
      levels: {
        size: 2,
        contents: [
          { id: "up", name: "Upper", sort: 1, elevation: { bottom: 10, top: 20 }, background: { src: "up.webp", color: "#000000" }, textures: { offsetX: 0, offsetY: 0 } },
          { id: "ground", name: "Ground", sort: 0, elevation: { bottom: -Infinity, top: 10 }, background: { src: "g.webp", color: "#223344" }, textures: { offsetX: 7, offsetY: -3 } },
        ],
      },
    };
    for (const k of ["background", "backgroundColor", "foreground", "foregroundElevation"]) {
      Object.defineProperty(scene, k, { get() { throw new Error(`deprecated Scene#${k} read`); } });
    }
    return scene;
  }
  const dims = { size: 100, sceneX: 100, sceneY: 100, sceneWidth: 200, sceneHeight: 100, width: 400, height: 300, distance: 5 };

  it("never reads the deprecated Scene getters", () => {
    expect(() => buildSceneModel(v14Scene(), dims, { viewedLevelId: "ground" })).not.toThrow();
  });

  it("ground background, colour and offsets come from the lowest level", () => {
    const m = buildSceneModel(v14Scene(), dims, { viewedLevelId: "ground" });
    expect(m.background).toEqual({ src: "g.webp", x: 107, y: 97, width: 200, height: 100 });
    expect(m.backgroundColor).toBe("#223344");
    expect(m.levels.map((l) => l.id)).toEqual(["ground", "up"]);
    expect(m.levels[0].bottom).toBe(0); // -Infinity treated as the ground
  });

  it("documents land on their level (empty wall levels = ground)", () => {
    const m = buildSceneModel(v14Scene(), dims, { viewedLevelId: "up" });
    const byId = (arr, id) => arr.find((d) => d.id === id);
    expect(byId(m.walls, "wAll").levelIndex).toBe(0);
    expect(byId(m.walls, "wUp").levelIndex).toBe(1);
    expect(byId(m.tokens, "tU").levelIndex).toBe(1);
    expect(byId(m.tiles, "roof").levelIndex).toBe(0);
  });

  it("viewed level drives the level cutoff and the roof height", () => {
    const g = buildSceneModel(v14Scene(), dims, { viewedLevelId: "ground" });
    expect(g.viewedLevelIndex).toBe(0);
    expect(g.foregroundElevation).toBe(10);
    const u = buildSceneModel(v14Scene(), dims, { viewedLevelId: "up" });
    expect(u.viewedLevelIndex).toBe(1);
    expect(u.foregroundElevation).toBe(20);
  });

  it("a single default level behaves like a v13 scene", () => {
    const s = v14Scene();
    s.levels = { size: 1, contents: [s.levels.contents[1]] };
    const m = buildSceneModel(s, dims, { viewedLevelId: "ground" });
    expect(m.viewedLevelIndex).toBeNull();
    expect(m.levels).toHaveLength(1);
    expect(m.background.src).toBe("g.webp");
  });
});
