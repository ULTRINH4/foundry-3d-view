import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import { lightLevels, unlitBrightness, LIGHT } from "../scripts/core/lighting.mjs";

const grid = makeGrid({ size: 100, sceneX: 0, sceneY: 0, sceneWidth: 600, sceneHeight: 100 });
const at = (lv, c) => lv[c];

describe("light levels", () => {
  it("bright, dim and dark rings", () => {
    const lv = lightLevels(grid, [{ x: 50, y: 50, bright: 150, dim: 350 }]);
    expect(at(lv, 0)).toBe(LIGHT.BRIGHT);
    expect(at(lv, 1)).toBe(LIGHT.BRIGHT);
    expect(at(lv, 2)).toBe(LIGHT.DIM);
    expect(at(lv, 3)).toBe(LIGHT.DIM);
    expect(at(lv, 4)).toBe(LIGHT.DARK);
  });
  it("respects the source's wall-clipped shape", () => {
    const lv = lightLevels(grid, [{ x: 50, y: 50, bright: 400, dim: 400, contains: (x) => x < 200 }]);
    expect(at(lv, 1)).toBe(LIGHT.BRIGHT);
    expect(at(lv, 2)).toBe(LIGHT.DARK);
  });
  it("brightest source wins; global light lights everything", () => {
    const lv = lightLevels(grid, [{ x: 50, y: 50, bright: 0, dim: 300 }, { x: 550, y: 50, bright: 300, dim: 300 }]);
    expect(at(lv, 0)).toBe(LIGHT.DIM);
    expect(at(lv, 5)).toBe(LIGHT.BRIGHT);
    expect([...lightLevels(grid, [], { global: true })].every((v) => v === LIGHT.BRIGHT)).toBe(true);
  });
  it("unlit brightness by darkness", () => {
    expect(unlitBrightness(0)).toBe(1);
    expect(unlitBrightness(1)).toBeCloseTo(0.12);
  });
});
