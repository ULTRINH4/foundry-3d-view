import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import { createHeightMap, setHeight } from "../scripts/core/heights.mjs";
import { reachable, pathTo, attackRing, wallBlocker, cursorStep, diagonalCostFor } from "../scripts/core/movement.mjs";
import { DIAGONALS } from "../scripts/core/scene-extras.mjs";

const grid = makeGrid({ size: 100, sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000, distance: 5 });
const K = (c, r) => r * grid.cols + c;

describe("reachable (blue squares)", () => {
  it("orthogonal range forms a diamond", () => {
    const reach = reachable(grid, { col: 5, row: 5 }, 2, { diagonalCost: Infinity });
    expect(reach.size).toBe(13);
    expect(reach.has(K(7, 5))).toBe(true);
    expect(reach.has(K(6, 6))).toBe(true);
    expect(reach.has(K(7, 6))).toBe(false);
  });
  it("equidistant diagonals form a square", () => {
    expect(reachable(grid, { col: 5, row: 5 }, 2, { diagonalCost: 1 }).size).toBe(25);
  });
  it("walls block and doors only when closed", () => {
    // A wall along x=600 from y=0 to 1000 (between columns 5 and 6)
    const walls = [{ c: [600, 0, 600, 1000] }];
    const reach = reachable(grid, { col: 5, row: 5 }, 3, { blocked: wallBlocker(walls, grid), diagonalCost: 1 });
    expect(reach.has(K(6, 5))).toBe(false);
    expect(reach.has(K(4, 5))).toBe(true);
    const door = [{ c: [600, 500, 600, 600], door: 1, ds: 1 }];
    expect(reachable(grid, { col: 5, row: 5 }, 1, { blocked: wallBlocker(door, grid) }).has(K(6, 5))).toBe(true);
    const closed = [{ c: [600, 500, 600, 600], door: 1, ds: 0 }];
    expect(reachable(grid, { col: 5, row: 5 }, 1, { blocked: wallBlocker(closed, grid), diagonalCost: Infinity }).has(K(6, 5))).toBe(false);
  });
  it("a diagonal can't squeeze past a wall corner", () => {
    const walls = [{ c: [600, 500, 600, 600] }]; // blocks (5,5)->(6,5)
    const reach = reachable(grid, { col: 5, row: 5 }, 1, { blocked: wallBlocker(walls, grid), diagonalCost: 1 });
    expect(reach.has(K(6, 4))).toBe(false);
  });
  it("ledges cost one extra", () => {
    let h = createHeightMap(10, 10);
    h = setHeight(h, 6, 5, 10);
    const reach = reachable(grid, { col: 5, row: 5 }, 1, { heights: h, climbUnits: 2.5, diagonalCost: Infinity });
    expect(reach.has(K(6, 5))).toBe(false); // costs 2
    expect(reachable(grid, { col: 5, row: 5 }, 2, { heights: h, climbUnits: 2.5 }).get(K(6, 5)).cost).toBe(2);
  });
  it("occupied squares can't be entered", () => {
    const reach = reachable(grid, { col: 5, row: 5 }, 1, { occupied: new Set([K(6, 5)]), diagonalCost: Infinity });
    expect(reach.has(K(6, 5))).toBe(false);
  });
});

describe("path and attack ring", () => {
  it("path follows the cheapest route around a wall", () => {
    const walls = [{ c: [600, 400, 600, 600] }]; // wall between columns 5|6 on rows 4..5
    const reach = reachable(grid, { col: 5, row: 5 }, 6, { blocked: wallBlocker(walls, grid), diagonalCost: Infinity });
    const p = pathTo(grid, reach, { col: 6, row: 5 });
    expect(p[0]).toEqual({ col: 5, row: 5 });
    expect(p.at(-1)).toEqual({ col: 6, row: 5 });
    expect(p.length).toBeGreaterThan(2); // had to go around
    expect(pathTo(grid, reach, { col: 9, row: 0 })).toBeNull();
  });
  it("red ring surrounds the blue area", () => {
    const reach = reachable(grid, { col: 5, row: 5 }, 1, { diagonalCost: Infinity });
    const ring = attackRing(grid, reach, 1);
    expect(ring.has(K(7, 5))).toBe(true);
    expect(ring.has(K(6, 6))).toBe(true);
    expect(ring.has(K(5, 5))).toBe(false);
    expect(attackRing(grid, reach, 0).size).toBe(0);
  });
  it("red ring doesn't leak through walls", () => {
    const walls = [{ c: [700, 0, 700, 1000] }]; // wall between columns 6 and 7
    const blocked = wallBlocker(walls, grid);
    const reach = reachable(grid, { col: 5, row: 5 }, 1, { blocked, diagonalCost: Infinity });
    const ring = attackRing(grid, reach, 2, { blocked });
    expect(ring.has(K(7, 5))).toBe(false);
    expect(ring.has(K(3, 5))).toBe(true);
  });
});

describe("helpers", () => {
  it("diagonal costs by rule", () => {
    expect(diagonalCostFor(DIAGONALS.EQUIDISTANT)).toBe(1);
    expect(diagonalCostFor(DIAGONALS.ALTERNATING_1)).toBe(1.5);
    expect(diagonalCostFor(DIAGONALS.RECTILINEAR)).toBe(Infinity);
  });
  it("cursor moves relative to the camera", () => {
    // Camera south of the target (yaw 0): up = north (row - 1), right = east (col + 1)
    expect(cursorStep("up", 0)).toEqual({ dc: 0, dr: -1 });
    expect(cursorStep("right", 0)).toEqual({ dc: 1, dr: 0 });
    // Camera east of the target (yaw 90°): up = west
    expect(cursorStep("up", Math.PI / 2)).toEqual({ dc: -1, dr: 0 });
    expect(cursorStep("right", Math.PI / 2)).toEqual({ dc: 0, dr: -1 });
    // Tactics diagonal (45°): still a single grid step
    const s = cursorStep("up", Math.PI / 4);
    expect(Math.abs(s.dc) + Math.abs(s.dr)).toBe(1);
  });
});

describe("token footprint and turn budget", () => {
  it("1×1 token: anchor is its own square, and back", async () => {
    const { tokenAnchorCell, tokenPositionForCell } = await import("../scripts/core/movement.mjs");
    const t = { x: 300, y: 400, width: 1, height: 1 };
    expect(tokenAnchorCell(grid, t)).toEqual({ col: 3, row: 4 });
    expect(tokenPositionForCell(grid, t, { col: 6, row: 2 })).toEqual({ x: 600, y: 200 });
  });
  it("2×2 token: anchor is the square under its center, round trip keeps the position", async () => {
    const { tokenAnchorCell, tokenPositionForCell, tokenCellKeys } = await import("../scripts/core/movement.mjs");
    const t = { x: 300, y: 400, width: 2, height: 2 };
    const a = tokenAnchorCell(grid, t);
    expect(a).toEqual({ col: 4, row: 5 });
    expect(tokenPositionForCell(grid, t, a)).toEqual({ x: 300, y: 400 });
    expect(tokenCellKeys(grid, t).sort((x, y) => x - y)).toEqual([K(3, 4), K(4, 4), K(3, 5), K(4, 5)]);
  });
  it("movement left this turn resets when the turn changes", async () => {
    const { remainingMove } = await import("../scripts/core/movement.mjs");
    expect(remainingMove(6, { key: "c:1:0", cost: 4 }, "c:1:0")).toBe(2);
    expect(remainingMove(6, { key: "c:1:0", cost: 9 }, "c:1:0")).toBe(0);
    expect(remainingMove(6, { key: "c:1:0", cost: 4 }, "c:1:1")).toBe(6);
    expect(remainingMove(6, { key: "c:1:0", cost: 4 }, null)).toBe(6);
  });
});
