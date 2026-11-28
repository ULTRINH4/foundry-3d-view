import { describe, it, expect } from "vitest";
import { bulkWallUpdate } from "../scripts/foundry/wall-config.mjs";

const F = "flags.foundry-3d-view";
describe("bulk wall tool", () => {
  it("sets texture and a height preset", () => {
    expect(bulkWallUpdate("a", { texture: "glass.png", preset: "half" })).toEqual({ _id: "a", [`${F}.texture`]: "glass.png", [`${F}.height`]: 0.5 });
  });
  it("keeps fields left empty", () => {
    expect(bulkWallUpdate("a", { texture: "", preset: "keep" })).toEqual({ _id: "a" });
  });
  it("custom height and clearing", () => {
    expect(bulkWallUpdate("a", { preset: "custom", custom: "0.8" })[`${F}.height`]).toBe(0.8);
    const u = bulkWallUpdate("a", { clearTexture: true, texture: "x.png", preset: "default" });
    expect(u).toEqual({ _id: "a", [`${F}.-=texture`]: null, [`${F}.-=height`]: null });
  });
  it("ignores a non-positive custom height", () => {
    expect(bulkWallUpdate("a", { preset: "custom", custom: "0" })).toEqual({ _id: "a" });
  });
  it("walls get the wall texture (with fit and size), doors only the door texture", () => {
    const v = { texture: "brick.png", doorTexture: "oak.png", fit: "height", scale: "2", preset: "keep" };
    expect(bulkWallUpdate("w", v)).toEqual({ _id: "w", [`${F}.texture`]: "brick.png", [`${F}.textureFit`]: "height", [`${F}.textureScale`]: 2 });
    expect(bulkWallUpdate("d", v, true)).toEqual({ _id: "d", [`${F}.doorTexture`]: "oak.png" });
    expect(bulkWallUpdate("d", { clearTexture: true, preset: "keep" }, true)).toEqual({ _id: "d", [`${F}.-=doorTexture`]: null });
  });
});
