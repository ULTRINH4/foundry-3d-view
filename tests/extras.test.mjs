import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import {
  isWallTowardCamera, lightData, tokenLightData, colorToHex, selectLights, ambientForDarkness,
  tileData, isOverheadTile, tilePlacement, tileContainsPoint, levelsFromScene, levelIndexFor, levelFloorY,
  DIAGONALS, gridSquares, lineCells, formatDistance,
} from "../scripts/core/scene-extras.mjs";
import { createHeightMap, brushCells, bumpBrush, getHeight, HeightHistory } from "../scripts/core/heights.mjs";

const grid = makeGrid({ size: 100, sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000, distance: 5 });

describe("cutaway", () => {
  const target = { x: 0, z: 0 };
  const camera = { x: 0, z: 10 }; // camera south of the target
  it("lowers walls between camera and target only", () => {
    expect(isWallTowardCamera(0, 3, target, camera)).toBe(true);
    expect(isWallTowardCamera(5, 2, target, camera)).toBe(true);
    expect(isWallTowardCamera(0, -3, target, camera)).toBe(false);
    expect(isWallTowardCamera(0, 0.3, target, camera)).toBe(false); // inside the margin
  });
  it("nothing is lowered when looking straight down", () => {
    expect(isWallTowardCamera(0, 3, target, { x: 0, z: 0 })).toBe(false);
  });
});

describe("lights", () => {
  it("normalizes ambient and token lights", () => {
    const l = lightData({ _id: "l", x: 10, y: 20, config: { dim: 30, bright: 15, color: "#ff8000" } });
    expect(l).toMatchObject({ id: "l", dim: 30, bright: 15, color: 0xff8000, hidden: false });
    expect(tokenLightData({ _id: "t", light: { dim: 0, bright: 0 } })).toBeNull();
    expect(tokenLightData({ _id: "t", light: { dim: 20 } })).toMatchObject({ id: "token:t", tokenId: "t", dim: 20 });
  });
  it("colour parsing", () => {
    expect(colorToHex("#00ff00")).toBe(0x00ff00);
    expect(colorToHex(255)).toBe(255);
    expect(colorToHex("nope")).toBeNull();
    expect(colorToHex(null)).toBeNull();
  });
  it("selects the nearest visible lights, skipping hidden and darkness", () => {
    const ls = [
      { id: "far", x: 5000, y: 0, dim: 10, bright: 0 },
      { id: "near", x: 10, y: 0, dim: 10, bright: 0 },
      { id: "hidden", x: 0, y: 0, dim: 10, bright: 0, hidden: true },
      { id: "dark", x: 0, y: 0, dim: 10, bright: 0, negative: true },
      { id: "mid", x: 500, y: 0, dim: 10, bright: 0 },
    ];
    expect(selectLights(ls, { x: 0, y: 0 }, 2).map((l) => l.id)).toEqual(["near", "mid"]);
  });
  it("darkness dims ambient", () => {
    expect(ambientForDarkness(0)).toBe(1);
    expect(ambientForDarkness(1)).toBeCloseTo(0.15);
    expect(ambientForDarkness(5)).toBeCloseTo(0.15);
  });
});

describe("tiles", () => {
  const t = tileData({ _id: "t", x: 100, y: 200, width: 200, height: 100, rotation: 90, texture: { src: "a.png" }, elevation: 20 });
  it("overhead detection", () => {
    expect(isOverheadTile(t, 20)).toBe(true);
    expect(isOverheadTile({ ...t, elevation: 0 }, 20)).toBe(false);
    expect(isOverheadTile({ ...t, overhead: false }, 0)).toBe(false);
  });
  it("placement: centre, size in squares, rotation sign, height", () => {
    const p = tilePlacement(t, grid, { floorY: 1, roofY: 2, overhead: false });
    expect(p.cx).toBeCloseTo(-3);
    expect(p.cz).toBeCloseTo(-2.5);
    expect([p.width, p.depth]).toEqual([2, 1]);
    expect(p.angle).toBeCloseTo(-Math.PI / 2);
    expect(p.y).toBeGreaterThan(1);
    expect(tilePlacement(t, grid, { roofY: 2, overhead: true }).y).toBeCloseTo(2.02);
  });
  it("contains point honours rotation", () => {
    const flat = { ...t, rotation: 0 };
    expect(tileContainsPoint(flat, 290, 210)).toBe(true);
    expect(tileContainsPoint(flat, 200, 310)).toBe(false);
    // rotated 90°: now 100 wide, 200 tall around the centre (200, 250)
    expect(tileContainsPoint(t, 200, 340)).toBe(true);
    expect(tileContainsPoint(t, 290, 250)).toBe(false);
  });
});

describe("levels", () => {
  const scene = {
    levels: {
      contents: [
        { id: "up", name: "Upper", elevation: { bottom: 10, top: 20 }, background: { src: "up.webp" } },
        { id: "ground", name: "Ground", elevation: { bottom: 0, top: 10 }, background: { src: "g.webp" } },
      ],
    },
  };
  const levels = levelsFromScene(scene);
  it("reads and sorts levels", () => {
    expect(levels.map((l) => l.id)).toEqual(["ground", "up"]);
    expect(levels[1].background.src).toBe("up.webp");
    expect(levelsFromScene({})).toEqual([]);
  });
  it("assigns documents by explicit level, then elevation", () => {
    expect(levelIndexFor({ level: "up", elevation: 0 }, levels)).toBe(1);
    expect(levelIndexFor({ levels: [{ id: "ground" }] }, levels)).toBe(0);
    expect(levelIndexFor({ elevation: 12 }, levels)).toBe(1);
    expect(levelIndexFor({ elevation: 3 }, levels)).toBe(0);
    expect(levelIndexFor({ elevation: 50 }, [])).toBe(0);
  });
  it("floor height in world units", () => {
    expect(levelFloorY(levels[1], grid)).toBe(2);
  });
});

describe("measurement", () => {
  const a = { col: 0, row: 0 };
  const b = { col: 3, row: 2 };
  it("diagonal rules", () => {
    expect(gridSquares(a, b, DIAGONALS.EQUIDISTANT)).toBe(3);
    expect(gridSquares(a, b, DIAGONALS.ALTERNATING_1)).toBe(4);
    expect(gridSquares(a, b, DIAGONALS.ALTERNATING_2)).toBe(4);
    expect(gridSquares(a, { col: 3, row: 3 }, DIAGONALS.ALTERNATING_1)).toBe(4);
    expect(gridSquares(a, b, DIAGONALS.RECTILINEAR)).toBe(5);
    expect(gridSquares(a, b, DIAGONALS.EXACT)).toBeCloseTo(1 + 2 * Math.SQRT2);
  });
  it("line cells and labels", () => {
    expect(lineCells(a, { col: 2, row: 0 })).toEqual([a, { col: 1, row: 0 }, { col: 2, row: 0 }]);
    expect(formatDistance(4, 5, "ft")).toBe("20 ft");
    expect(formatDistance(1, 1.5, "m", -2.5)).toBe("1.5 m (-2.5)");
  });
});

describe("height brush and history", () => {
  it("brush clips to the map", () => {
    const m = createHeightMap(4, 4);
    expect(brushCells(m, 0, 0, 3)).toHaveLength(4);
    expect(brushCells(m, 1, 1, 3)).toHaveLength(9);
    expect(brushCells(m, 1, 1, 1)).toEqual([{ col: 1, row: 1 }]);
    const m2 = bumpBrush(m, 1, 1, 3, 5);
    expect(getHeight(m2, 0, 0)).toBe(5);
    expect(getHeight(m2, 3, 3)).toBe(0);
    expect(getHeight(bumpBrush(m2, 1, 1, 3, -10), 1, 1)).toBe(0);
  });
  it("history is bounded", () => {
    const h = new HeightHistory(2);
    h.push(1); h.push(2); h.push(3);
    expect(h.size).toBe(2);
    expect(h.pop()).toBe(3);
    expect(h.pop()).toBe(2);
    expect(h.pop()).toBeNull();
  });
});

describe("tileData on real documents", () => {
  it("does not touch the deprecated TileDocument#overhead getter", () => {
    const doc = { id: "t", x: 0, y: 0, width: 100, height: 100, texture: { src: "a.png" }, _source: { elevation: 0 } };
    Object.defineProperty(doc, "overhead", { get() { throw new Error("deprecated overhead read"); } });
    expect(() => tileData(doc)).not.toThrow();
    expect(tileData(doc).overhead).toBeNull();
    expect(tileData({ ...doc, _source: { overhead: true } }).overhead).toBe(true);
  });
});
