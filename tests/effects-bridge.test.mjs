import { describe, it, expect } from "vitest";
import { spritePlacement, findTexturedChild } from "../scripts/foundry/effects-bridge.mjs";

/** Minimal 2D affine matrix with PIXI.Matrix's apply/invert/clone. */
class M {
  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) { Object.assign(this, { a, b, c, d, tx, ty }); }
  apply(p) { return { x: this.a * p.x + this.c * p.y + this.tx, y: this.b * p.x + this.d * p.y + this.ty }; }
  clone() { return new M(this.a, this.b, this.c, this.d, this.tx, this.ty); }
  invert() {
    const { a, b, c, d, tx, ty } = this;
    const n = a * d - b * c;
    return Object.assign(this, { a: d / n, b: -b / n, c: -c / n, d: a / n, tx: (c * ty - d * tx) / n, ty: -(a * ty - b * tx) / n });
  }
}

describe("effects bridge", () => {
  it("reads canvas placement through the stage zoom/pan", () => {
    const stage = new M(0.5, 0, 0, 0.5, 100, 50); // canvas zoomed out to 50% and panned
    // A 200x100 sprite centred (anchor .5) at canvas (1000, 800), rotated 90° clockwise.
    const cos = Math.cos(Math.PI / 2), sin = Math.sin(Math.PI / 2);
    const local = new M(cos, sin, -sin, cos, 1000, 800);
    const world = new M(
      stage.a * local.a + stage.c * local.b, stage.b * local.a + stage.d * local.b,
      stage.a * local.c + stage.c * local.d, stage.b * local.c + stage.d * local.d,
      stage.a * local.tx + stage.c * local.ty + stage.tx, stage.b * local.tx + stage.d * local.ty + stage.ty,
    );
    const obj = { worldTransform: world, texture: { orig: { width: 200, height: 100 } }, anchor: { x: 0.5, y: 0.5 } };
    const p = spritePlacement(obj, stage);
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(800);
    expect(p.width).toBeCloseTo(200);
    expect(p.height).toBeCloseTo(100);
    expect(p.rotation).toBeCloseTo(Math.PI / 2);
  });
  it("finds the textured child of an effect container", () => {
    const video = { tagName: "VIDEO" };
    const sprite = { texture: { baseTexture: { resource: { source: video } } }, children: [] };
    const effect = { children: [{ children: [sprite] }] };
    expect(findTexturedChild(effect)).toBe(sprite);
    expect(findTexturedChild({ children: [] })).toBeNull();
    // A textured wrapper around a textured mesh: the mesh (what renders) wins.
    const wrapper = { texture: sprite.texture, children: [sprite] };
    expect(findTexturedChild({ children: [wrapper] })).toBe(sprite);
  });
});
