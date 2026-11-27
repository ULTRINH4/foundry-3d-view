import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import {
  createHeightMap, normalizeHeightMap, getHeight, setHeight, bumpHeight, maxHeightUnderRect,
  maxHeightAlongSegment, wallBaseHeight, wallRegions, autoHeightsFromWalls, segmentsIntersect, heightMapsEqual,
} from "../scripts/core/heights.mjs";

const grid = makeGrid({ size: 100, sceneX: 100, sceneY: 100, sceneWidth: 600, sceneHeight: 400, distance: 5 });
// 6 x 4 cells; cell (c,r) spans canvas x 100+100c .. , y 100+100r ..

describe("height map basics", () => {
  it("get/set are immutable and bounds-safe", () => {
    const m = createHeightMap(6, 4);
    const m2 = setHeight(m, 2, 1, 5);
    expect(getHeight(m, 2, 1)).toBe(0);
    expect(getHeight(m2, 2, 1)).toBe(5);
    expect(getHeight(m2, -1, 0)).toBe(0);
    expect(setHeight(m2, 99, 0, 1)).toBe(m2);
  });
  it("bump clamps and rounds", () => {
    let m = createHeightMap(2, 2);
    m = bumpHeight(m, 0, 0, -5);
    expect(getHeight(m, 0, 0)).toBe(0);
    for (let i = 0; i < 3; i++) m = bumpHeight(m, 0, 0, 0.1);
    expect(getHeight(m, 0, 0)).toBe(0.3);
    m = bumpHeight(m, 0, 0, 10, { max: 2 });
    expect(getHeight(m, 0, 0)).toBe(2);
  });
  it("normalize keeps values by cell when the scene is resized and drops garbage", () => {
    const raw = { cols: 2, rows: 2, data: [1, 2, 3, "x"] };
    const m = normalizeHeightMap(raw, 3, 1);
    expect(m).toEqual({ cols: 3, rows: 1, data: [1, 2, 0] });
    expect(normalizeHeightMap(raw, 2, 2).data).toEqual([1, 2, 3, 0]);
    expect(normalizeHeightMap(null, 2, 1).data).toEqual([0, 0]);
    expect(normalizeHeightMap({ cols: -1, rows: 2, data: [] }, 1, 1).data).toEqual([0]);
  });
  it("equality", () => {
    expect(heightMapsEqual(createHeightMap(2, 2), createHeightMap(2, 2))).toBe(true);
    expect(heightMapsEqual(createHeightMap(2, 2), setHeight(createHeightMap(2, 2), 0, 0, 1))).toBe(false);
  });
});

describe("height lookups", () => {
  let m = createHeightMap(6, 4);
  m = setHeight(m, 1, 1, 5);
  m = setHeight(m, 2, 1, 10);

  it("max under a token footprint ignores neighbours touching the border", () => {
    // 1x1 token exactly on cell (1,1)
    expect(maxHeightUnderRect(m, grid, 200, 200, 100, 100)).toBe(5);
    // 2x1 token over cells (1,1),(2,1)
    expect(maxHeightUnderRect(m, grid, 200, 200, 200, 100)).toBe(10);
    // token outside the map clamps to the nearest cells
    expect(maxHeightUnderRect(m, grid, -500, -500, 100, 100)).toBe(0);
  });
  it("wall base is the lower side of the wall", () => {
    // horizontal wall on the line between row 0 (flat) and row 1 (cells 1,2 raised)
    expect(wallBaseHeight(m, grid, [200, 200, 400, 200])).toBe(0);
    // vertical wall between cell (1,1)=5 and (2,1)=10, only spanning row 1
    expect(wallBaseHeight(m, grid, [300, 200, 300, 300])).toBe(5);
  });
  it("max along a wall", () => {
    expect(maxHeightAlongSegment(m, grid, [100, 250, 700, 250])).toBe(10);
    expect(maxHeightAlongSegment(m, grid, [100, 450, 700, 450])).toBe(0);
  });
});

describe("segmentsIntersect", () => {
  it("handles crossing, parallel and touching", () => {
    expect(segmentsIntersect(0, 0, 10, 10, 0, 10, 10, 0)).toBe(true);
    expect(segmentsIntersect(0, 0, 10, 0, 0, 1, 10, 1)).toBe(false);
    expect(segmentsIntersect(0, 0, 10, 0, 10, 0, 10, 10)).toBe(true);
    expect(segmentsIntersect(0, 0, 4, 0, 5, -1, 5, 1)).toBe(false);
  });
});

describe("auto rough pass", () => {
  // A 2x2 room on cells (2..3, 1..2): walls on its grid lines; door on the bottom edge.
  const room = [
    { c: [300, 200, 500, 200] },
    { c: [500, 200, 500, 400] },
    { c: [300, 400, 400, 400] },
    { c: [400, 400, 500, 400], door: 1, ds: 1 }, // open door still separates regions
    { c: [300, 200, 300, 400] },
  ];

  it("finds the enclosed room as its own region", () => {
    const { labels, regions } = wallRegions(room, grid);
    expect(regions).toHaveLength(2);
    const inside = labels[1 * 6 + 2];
    expect(labels[2 * 6 + 3]).toBe(inside);
    expect(regions[inside]).toMatchObject({ size: 4, touchesBorder: false });
    expect(regions[labels[0]].touchesBorder).toBe(true);
  });

  it("ignores walls that do not block movement", () => {
    const ethereal = room.map((w) => ({ ...w, move: 0, door: 0 }));
    expect(wallRegions(ethereal, grid).regions).toHaveLength(1);
  });

  it("'outside' raises the exterior, 'rooms' raises the room", () => {
    const out = autoHeightsFromWalls(room, grid, { mode: "outside", step: 5 });
    expect(getHeight(out, 0, 0)).toBe(5);
    expect(getHeight(out, 2, 1)).toBe(0);
    const rooms = autoHeightsFromWalls(room, grid, { mode: "rooms", step: 2.5 });
    expect(getHeight(rooms, 0, 0)).toBe(0);
    expect(getHeight(rooms, 3, 2)).toBe(2.5);
  });

  it("stays flat when nothing is enclosed", () => {
    const m = autoHeightsFromWalls([{ c: [300, 100, 300, 300] }], grid);
    expect(m.data.every((v) => v === 0)).toBe(true);
  });
});
