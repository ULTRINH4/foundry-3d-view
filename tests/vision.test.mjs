import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import {
  computeLOS, pointInPolygon, blocksSight, visibleCells, losVisibilityTest, fogStates, FOG, cellSamplePoints,
} from "../scripts/core/vision.mjs";

const grid = makeGrid({ size: 100, sceneX: 0, sceneY: 0, sceneWidth: 600, sceneHeight: 300 });
const bounds = { x: 0, y: 0, width: 600, height: 300 };
// A vertical wall at x=300 splitting the map in two, with a door segment in the middle row.
const wall = (c, extra = {}) => ({ c, sight: 20, door: 0, ds: 0, ...extra });
const split = (ds) => [wall([300, 0, 300, 100]), wall([300, 100, 300, 200], { door: 1, ds }), wall([300, 200, 300, 300])];

describe("blocksSight", () => {
  it("open doors and sight-NONE walls do not block", () => {
    expect(blocksSight(wall([0, 0, 1, 1]))).toBe(true);
    expect(blocksSight(wall([0, 0, 1, 1], { sight: 0 }))).toBe(false);
    expect(blocksSight(wall([0, 0, 1, 1], { door: 1, ds: 1 }))).toBe(false);
    expect(blocksSight(wall([0, 0, 1, 1], { door: 1, ds: 2 }))).toBe(true);
  });
});

describe("pointInPolygon", () => {
  it("square", () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInPolygon(5, 5, sq)).toBe(true);
    expect(pointInPolygon(15, 5, sq)).toBe(false);
  });
});

describe("computeLOS", () => {
  it("a closed wall hides the other half", () => {
    const poly = computeLOS({ x: 150, y: 150 }, split(0), { bounds });
    expect(pointInPolygon(50, 50, poly)).toBe(true);
    expect(pointInPolygon(250, 250, poly)).toBe(true);
    expect(pointInPolygon(450, 150, poly)).toBe(false);
  });
  it("an open door lets you see straight through it", () => {
    const poly = computeLOS({ x: 150, y: 150 }, split(1), { bounds });
    expect(pointInPolygon(450, 150, poly)).toBe(true);
    expect(pointInPolygon(450, 20, poly)).toBe(false); // still behind the wall
  });
  it("radius limits the polygon", () => {
    const poly = computeLOS({ x: 150, y: 150 }, [], { radius: 100 });
    expect(pointInPolygon(200, 150, poly)).toBe(true);
    expect(pointInPolygon(280, 150, poly)).toBe(false);
  });
});

describe("visible cells and fog", () => {
  it("cells behind a closed door are not visible", () => {
    const test = losVisibilityTest([{ x: 150, y: 150 }], split(0), grid);
    const vis = visibleCells(grid, test);
    expect(Array.from(vis)).toEqual([1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0]);
  });
  it("vision radius limits cells", () => {
    const test = losVisibilityTest([{ x: 50, y: 50, radius: 120 }], [], grid);
    const vis = visibleCells(grid, test);
    expect(vis[0]).toBe(1);
    expect(vis[1]).toBe(1);
    expect(vis[5]).toBe(0);
  });
  it("sample points stay inside the cell", () => {
    for (const [x, y] of cellSamplePoints(grid, 2, 1)) {
      expect(x).toBeGreaterThan(200);
      expect(x).toBeLessThan(300);
      expect(y).toBeGreaterThan(100);
      expect(y).toBeLessThan(200);
    }
  });
  it("explored memory persists after leaving", () => {
    const a = fogStates(null, Uint8Array.from([1, 0, 0]));
    expect(Array.from(a.states)).toEqual([FOG.VISIBLE, FOG.UNSEEN, FOG.UNSEEN]);
    const b = fogStates(a.explored, Uint8Array.from([0, 1, 0]));
    expect(Array.from(b.states)).toEqual([FOG.EXPLORED, FOG.VISIBLE, FOG.UNSEEN]);
  });
});
