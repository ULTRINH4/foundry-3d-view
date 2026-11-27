import { describe, it, expect } from "vitest";
import {
  makeGrid, canvasToWorld, worldToCanvas, canvasToCell, worldToCell, cellCenter, cellRect,
  tokenCenter, unitsToWorldY, worldYToUnits,
} from "../scripts/core/coords.mjs";

// 20x10 squares of 100px with 25% padding rounded up to whole squares (Foundry style).
const grid = makeGrid({ size: 100, sceneX: 500, sceneY: 300, sceneWidth: 2000, sceneHeight: 1000, distance: 5 });

describe("makeGrid", () => {
  it("derives columns, rows and centre", () => {
    expect(grid.cols).toBe(20);
    expect(grid.rows).toBe(10);
    expect(grid.centerX).toBe(1500);
    expect(grid.centerY).toBe(800);
    expect(grid.width).toBe(3000);
  });
  it("rounds partial squares up", () => {
    const g = makeGrid({ size: 100, sceneWidth: 250, sceneHeight: 101 });
    expect([g.cols, g.rows]).toEqual([3, 2]);
  });
  it("rejects a zero grid size and defaults distance", () => {
    expect(() => makeGrid({ size: 0, sceneWidth: 1, sceneHeight: 1 })).toThrow();
    expect(makeGrid({ size: 50, sceneWidth: 1, sceneHeight: 1 }).distance).toBe(5);
  });
});

describe("canvas <-> world", () => {
  it("maps the scene centre to the origin", () => {
    expect(canvasToWorld(grid, 1500, 800)).toEqual({ x: 0, z: 0 });
  });
  it("uses one world unit per grid square, +z downward on the map", () => {
    expect(canvasToWorld(grid, 1600, 1000)).toEqual({ x: 1, z: 2 });
    expect(canvasToWorld(grid, 500, 300)).toEqual({ x: -10, z: -5 });
  });
  it("round-trips", () => {
    const w = canvasToWorld(grid, 1234, 567);
    const c = worldToCanvas(grid, w.x, w.z);
    expect(c.x).toBeCloseTo(1234);
    expect(c.y).toBeCloseTo(567);
  });
  it("converts distance units to world height", () => {
    expect(unitsToWorldY(grid, 10)).toBe(2);
    expect(unitsToWorldY(grid, undefined)).toBe(0);
    expect(worldYToUnits(grid, 1.5)).toBe(7.5);
  });
});

describe("cells", () => {
  it("finds cells relative to the scene rect (padding excluded)", () => {
    expect(canvasToCell(grid, 500, 300)).toEqual({ col: 0, row: 0 });
    expect(canvasToCell(grid, 2499, 1299)).toEqual({ col: 19, row: 9 });
    expect(canvasToCell(grid, 499, 300)).toBeNull();
    expect(canvasToCell(grid, 2500, 300)).toBeNull();
  });
  it("cell centre/rect and world lookup agree", () => {
    expect(cellCenter(grid, 2, 3)).toEqual({ x: 750, y: 650 });
    expect(cellRect(grid, 2, 3)).toEqual({ x: 700, y: 600, width: 100, height: 100 });
    const w = canvasToWorld(grid, 750, 650);
    expect(worldToCell(grid, w.x, w.z)).toEqual({ col: 2, row: 3 });
  });
  it("token centre accounts for size in squares", () => {
    expect(tokenCenter(grid, { x: 700, y: 600, width: 2, height: 2 })).toEqual({ x: 800, y: 700 });
    expect(tokenCenter(grid, { x: 700, y: 600 })).toEqual({ x: 750, y: 650 });
  });
});
