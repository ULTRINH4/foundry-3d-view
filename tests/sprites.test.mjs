import { describe, it, expect } from "vitest";
import {
  tokenFacingYaw, directionRow, animationColumn, sheetCellUV, sheetData, snapTacticsYaw, normAngle,
} from "../scripts/core/sprites.mjs";
import { tokenData } from "../scripts/core/scene-model.mjs";

const D = Math.PI / 180;

describe("directional sprites", () => {
  const south = tokenFacingYaw(0); // facing +z
  it("front when the camera is in front of the token", () => {
    expect(directionRow(4, south, 0)).toBe(0); // camera south of the token
  });
  it("back when the camera is behind it", () => {
    expect(directionRow(4, south, 180 * D)).toBe(2);
    expect(directionRow(8, south, 180 * D)).toBe(4);
  });
  it("sides", () => {
    // camera at +x (east). A token facing south has its left hand to the east.
    expect(directionRow(4, south, 90 * D)).toBe(1);
    expect(directionRow(4, south, -90 * D)).toBe(3);
    expect(directionRow(8, south, 45 * D)).toBe(1);
  });
  it("token rotation turns the sprite", () => {
    // rotated 180°: now facing north, so a camera to the south sees its back
    expect(directionRow(4, tokenFacingYaw(180), 0)).toBe(2);
    expect(directionRow(1, tokenFacingYaw(180), 0)).toBe(0);
  });
  it("animation columns loop at fps", () => {
    expect(animationColumn(4, 8, 0)).toBe(0);
    expect(animationColumn(4, 8, 0.13)).toBe(1);
    expect(animationColumn(4, 8, 0.5)).toBe(0);
    expect(animationColumn(1, 8, 3)).toBe(0);
    expect(animationColumn(4, 0, 3)).toBe(0);
  });
  it("sheet cell UVs (rows from the top)", () => {
    expect(sheetCellUV(4, 4, 0, 0)).toEqual({ repeat: [0.25, 0.25], offset: [0, 0.75] });
    expect(sheetCellUV(4, 4, 3, 3)).toEqual({ repeat: [0.25, 0.25], offset: [0.75, 0] });
  });
  it("sheet flag normalization and token data", () => {
    expect(sheetData(null)).toBeNull();
    expect(sheetData({ src: "a.png", directions: 3, frames: 0 })).toEqual({ src: "a.png", directions: 1, frames: 1, fps: 8 });
    const t = tokenData({ _id: "t", rotation: 90, flags: { "foundry-3d-view": { sheet: { src: "s.png", directions: 8, frames: 4, fps: 12 } } } });
    expect(t.rotation).toBe(90);
    expect(t.sheet).toEqual({ src: "s.png", directions: 8, frames: 4, fps: 12 });
  });
});

describe("tactics camera", () => {
  it("snaps to the nearest diagonal", () => {
    expect(snapTacticsYaw(0.1) / D).toBeCloseTo(45);
    expect(snapTacticsYaw(100 * D) / D).toBeCloseTo(135);
    expect(normAngle(snapTacticsYaw(-100 * D)) / D).toBeCloseTo(225);
  });
});
