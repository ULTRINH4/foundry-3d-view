import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import { indoorMap, wallCutDecision, occludingWalls, normalizeCutMode } from "../scripts/core/cutaway.mjs";

const grid = makeGrid({ size: 100, sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000, distance: 5 });
const K = (c, r) => r * grid.cols + c;
// A room from (200,200) to (600,600): columns/rows 2..5
const north = { c: [200, 200, 600, 200] };
const south = { c: [200, 600, 600, 600] };
const west = { c: [200, 200, 200, 600] };
const east = { c: [600, 200, 600, 600] };
const room = [north, south, west, east];

describe("indoor map", () => {
  it("squares inside a closed room are indoors", () => {
    const m = indoorMap(room, grid);
    expect(m[K(3, 3)]).toBe(1);
    expect(m[K(5, 5)]).toBe(1);
    expect(m[K(1, 1)]).toBe(0);
    expect(m[K(6, 3)]).toBe(0);
  });
  it("a gap in the walls leaves the room outdoors", () => {
    const m = indoorMap([north, west, east, { c: [200, 600, 400, 600] }], grid);
    expect(m[K(3, 3)]).toBe(0);
  });
  it("walls along the scene edge enclose everything", () => {
    const m = indoorMap([{ c: [0, 0, 1000, 0] }, { c: [1000, 0, 1000, 1000] }, { c: [1000, 1000, 0, 1000] }, { c: [0, 1000, 0, 0] }], grid);
    expect(m.every((v) => v === 1)).toBe(true);
  });
});

describe("which walls are cut", () => {
  const m = indoorMap(room, grid);
  it("camera to the south: south wall (front) cut, north wall (back) stays", () => {
    const cam = { x: 400, y: 5000 };
    expect(wallCutDecision(south.c, cam, m, grid)).toBe(true);
    expect(wallCutDecision(north.c, cam, m, grid)).toBe(false);
  });
  it("turning the camera around swaps them", () => {
    const cam = { x: 400, y: -5000 };
    expect(wallCutDecision(south.c, cam, m, grid)).toBe(false);
    expect(wallCutDecision(north.c, cam, m, grid)).toBe(true);
  });
  it("diagonal (tactics) camera cuts the two front walls", () => {
    const cam = { x: 5000, y: 5000 };
    expect(wallCutDecision(south.c, cam, m, grid)).toBe(true);
    expect(wallCutDecision(east.c, cam, m, grid)).toBe(true);
    expect(wallCutDecision(north.c, cam, m, grid)).toBe(false);
    expect(wallCutDecision(west.c, cam, m, grid)).toBe(false);
  });
  it("edge-on walls keep their previous state (null)", () => {
    expect(wallCutDecision(east.c, { x: 600, y: 50000 }, m, grid)).toBeNull();
  });
  it("an inner wall in front of the room behind it is cut", () => {
    const two = [...room, { c: [200, 600, 200, 900] }, { c: [600, 600, 600, 900] }, { c: [200, 900, 600, 900] }];
    const m2 = indoorMap(two, grid);
    // Camera to the north: the shared wall (y=600) hides the southern room -> cut
    expect(wallCutDecision(south.c, { x: 400, y: -5000 }, m2, grid)).toBe(true);
    // ...and the far wall of the southern room stays up
    expect(wallCutDecision([200, 900, 600, 900], { x: 400, y: -5000 }, m2, grid)).toBe(false);
  });
});

describe("walls hiding tokens", () => {
  const walls = [{ id: "w", ax: -1, az: 1, bx: 1, bz: 1, top: 2 }];
  it("a tall wall between the token and the camera hides it", () => {
    expect(occludingWalls(walls, [{ x: 0, y: 0.5, z: 0 }], { x: 0, y: 3, z: 3 }).has("w")).toBe(true);
  });
  it("a wall behind the token doesn't", () => {
    expect(occludingWalls(walls, [{ x: 0, y: 0.5, z: 0 }], { x: 0, y: 3, z: -3 }).size).toBe(0);
  });
  it("a camera high above sees over a low wall", () => {
    expect(occludingWalls([{ ...walls[0], top: 0.6 }], [{ x: 0, y: 0.5, z: 0 }], { x: 0, y: 30, z: 3 }).size).toBe(0);
  });
});

describe("modes", () => {
  it("old boolean setting maps to the new modes", () => {
    expect(normalizeCutMode(true)).toBe("cutaway");
    expect(normalizeCutMode(false)).toBe("up");
    expect(normalizeCutMode("down")).toBe("down");
    expect(normalizeCutMode(undefined)).toBe("cutaway");
  });
});
