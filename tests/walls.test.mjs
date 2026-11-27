import { describe, it, expect } from "vitest";
import { makeGrid } from "../scripts/core/coords.mjs";
import {
  wallData, wallBox, doorPose, doorFreeEnd, isRenderableWall, showAsDoor, isDoorOpen, wallVerticalExtent,
  wallMaterialKey, WALL_MODES, wallKind, WALL_KIND, windowSections, glassMaterialKey,
} from "../scripts/core/walls.mjs";
import { DOOR_STATE, WALL_DOOR, WALL_SENSE } from "../scripts/core/constants.mjs";

const grid = makeGrid({ size: 100, sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000, distance: 5 });
// world origin = canvas (500, 500)

/** Where three.js would put local (x,0,0) after rotating by `angle` around +Y. */
const rotX = (angle, len) => ({ x: Math.cos(angle) * len, z: -Math.sin(angle) * len });

describe("wallData", () => {
  it("fills defaults and reads Wall Height flags", () => {
    const w = wallData({ _id: "a", c: [0, 0, 100, 0], flags: { "wall-height": { top: 10, bottom: "" } } });
    expect(w).toMatchObject({ id: "a", move: 20, sight: 20, door: 0, ds: 0, top: 10, bottom: null });
  });
});

describe("wallBox", () => {
  it("horizontal wall: centred, unrotated, right length", () => {
    const b = wallBox(wallData({ c: [500, 500, 700, 500] }), grid, { height: 2, thickness: 0.1 });
    expect(b.cx).toBeCloseTo(1);
    expect(b.cz).toBeCloseTo(0);
    expect(b.length).toBeCloseTo(2);
    expect(b.angle).toBeCloseTo(0);
    expect([b.bottom, b.top, b.thickness]).toEqual([0, 2, 0.1]);
  });

  it.each([
    [[500, 500, 500, 800]], // pointing down the map (+z)
    [[500, 500, 300, 300]], // diagonal up-left
    [[600, 450, 650, 900]],
  ])("rotation maps local X onto the segment %j", (c) => {
    const w = wallData({ c });
    const b = wallBox(w, grid, { height: 1 });
    const half = rotX(b.angle, b.length / 2);
    // centre +/- half-length along local X must land on the endpoints
    expect(b.cx - half.x).toBeCloseTo((c[0] - 500) / 100);
    expect(b.cz - half.z).toBeCloseTo((c[1] - 500) / 100);
    expect(b.cx + half.x).toBeCloseTo((c[2] - 500) / 100);
    expect(b.cz + half.z).toBeCloseTo((c[3] - 500) / 100);
  });

  it("stands on the terrain base and honours explicit top/bottom", () => {
    const w = wallData({ c: [0, 0, 100, 0] });
    expect(wallBox(w, grid, { height: 2, base: 1.5 }).top).toBe(3.5);
    const tall = wallData({ c: [0, 0, 100, 0], flags: { "wall-height": { top: 20, bottom: 5 } } });
    expect(wallVerticalExtent(tall, grid, { height: 2 })).toEqual({ bottom: 1, top: 4 });
  });
});

describe("doors", () => {
  const door = (ds) => wallData({ c: [500, 500, 600, 500], door: WALL_DOOR.DOOR, ds });

  it("closed door free end sits on the far endpoint", () => {
    const end = doorFreeEnd(doorPose(door(DOOR_STATE.CLOSED), grid, { height: 2 }));
    expect(end.x).toBeCloseTo(1);
    expect(end.z).toBeCloseTo(0);
  });

  it("open door swings 90 degrees around the hinge", () => {
    const pose = doorPose(door(DOOR_STATE.OPEN), grid, { height: 2 });
    expect(pose.hx).toBeCloseTo(0);
    expect(pose.angle - pose.closedAngle).toBeCloseTo(Math.PI / 2);
    const end = doorFreeEnd(pose);
    expect(Math.hypot(end.x - pose.hx, end.z - pose.hz)).toBeCloseTo(1);
    expect(end.x).toBeCloseTo(0);
    expect(Math.abs(end.z)).toBeCloseTo(1);
  });

  it("locked counts as closed", () => {
    expect(isDoorOpen(door(DOOR_STATE.LOCKED))).toBe(false);
    expect(isDoorOpen(door(DOOR_STATE.OPEN))).toBe(true);
  });

  it("secret doors look like walls to players until opened", () => {
    const s = (ds) => wallData({ c: [0, 0, 1, 0], door: WALL_DOOR.SECRET, ds });
    expect(showAsDoor(s(DOOR_STATE.CLOSED), false)).toBe(false);
    expect(showAsDoor(s(DOOR_STATE.CLOSED), true)).toBe(true);
    expect(showAsDoor(s(DOOR_STATE.OPEN), false)).toBe(true);
  });
});

describe("isRenderableWall", () => {
  it("skips invisible and zero-length walls, keeps doors", () => {
    expect(isRenderableWall(wallData({ c: [0, 0, 1, 0] }))).toBe(true);
    expect(isRenderableWall(wallData({ c: [0, 0, 1, 0], sight: WALL_SENSE.NONE }))).toBe(false);
    expect(isRenderableWall(wallData({ c: [0, 0, 1, 0], sight: WALL_SENSE.NONE }), { invisible: "glass" })).toBe(true);
    expect(isRenderableWall(wallData({ c: [0, 0, 1, 0], sight: WALL_SENSE.NONE, move: WALL_SENSE.NONE }), { invisible: "glass" })).toBe(false);
    expect(isRenderableWall(wallData({ c: [0, 0, 1, 0], sight: WALL_SENSE.NONE, door: 1 }))).toBe(true);
    expect(isRenderableWall(wallData({ c: [5, 5, 5, 5] }))).toBe(false);
  });
});

describe("wallMaterialKey", () => {
  const plain = wallData({ c: [0, 0, 1, 0] });
  const custom = wallData({ c: [0, 0, 1, 0], flags: { "foundry-3d-view": { texture: "brick.webp" } } });
  const door = wallData({ c: [0, 0, 1, 0], door: WALL_DOOR.DOOR });
  const secret = wallData({ c: [0, 0, 1, 0], door: WALL_DOOR.SECRET });

  it("reads the per-wall texture flag", () => {
    expect(custom.texture).toBe("brick.webp");
    expect(plain.texture).toBeNull();
  });
  it("map mode inherits the scene image, falls back to flat without one", () => {
    expect(wallMaterialKey(plain, { mode: WALL_MODES.MAP })).toBe("map");
    expect(wallMaterialKey(plain, { mode: WALL_MODES.MAP, hasMap: false })).toBe("flat");
    expect(wallMaterialKey(door, { mode: WALL_MODES.MAP, asDoor: true })).toBe("map");
  });
  it("texture mode uses the global texture, flat without one", () => {
    expect(wallMaterialKey(plain, { mode: WALL_MODES.TEXTURE, wallTexture: "stone.png" })).toBe("tex:stone.png");
    expect(wallMaterialKey(plain, { mode: WALL_MODES.TEXTURE })).toBe("flat");
  });
  it("per-wall texture wins, door texture applies to doors only", () => {
    expect(wallMaterialKey(custom, { mode: WALL_MODES.FLAT })).toBe("tex:brick.webp");
    expect(wallMaterialKey(door, { mode: WALL_MODES.FLAT, doorTexture: "wood.png", asDoor: true })).toBe("tex:wood.png");
    expect(wallMaterialKey(plain, { mode: WALL_MODES.FLAT, doorTexture: "wood.png" })).toBe("flat");
    expect(wallMaterialKey(door, { mode: WALL_MODES.FLAT, asDoor: true })).toBe("door");
  });
  it("secret doors seen as doors keep their own colour", () => {
    expect(wallMaterialKey(secret, { mode: WALL_MODES.MAP, asDoor: true })).toBe("secretDoor");
    // seen as a wall by players: it blends in like any wall
    expect(wallMaterialKey(secret, { mode: WALL_MODES.MAP, asDoor: false })).toBe("map");
  });
});

describe("wall kinds, heights, windows and glass", () => {
  const W = (extra) => wallData({ c: [500, 500, 700, 500], ...extra });
  it("classifies walls like Foundry's wall tools", () => {
    expect(W({}).kind).toBe(WALL_KIND.WALL);
    expect(W({ door: 1 }).kind).toBe(WALL_KIND.DOOR);
    expect(W({ sight: WALL_SENSE.PROXIMITY, light: 30 }).kind).toBe(WALL_KIND.WINDOW);
    expect(W({ sight: WALL_SENSE.DISTANCE }).kind).toBe(WALL_KIND.WINDOW);
    expect(W({ sight: WALL_SENSE.LIMITED }).kind).toBe(WALL_KIND.TERRAIN);
    expect(W({ sight: WALL_SENSE.NONE }).kind).toBe(WALL_KIND.INVISIBLE);
    expect(W({ sight: WALL_SENSE.NONE, move: WALL_SENSE.NONE }).kind).toBe(WALL_KIND.ETHEREAL);
    expect(wallKind({ door: 0, sight: 20, move: 20 })).toBe("wall");
  });
  it("per-wall 3D height makes half walls on top of the terrain", () => {
    const half = W({ flags: { "foundry-3d-view": { height: 0.5 } } });
    expect(half.height).toBe(0.5);
    expect(wallVerticalExtent(half, grid, { height: 2, base: 1 })).toEqual({ bottom: 0, top: 1.5 });
  });
  it("Wall Height flags win over the 3D height", () => {
    const w = W({ flags: { "wall-height": { top: 5 }, "foundry-3d-view": { height: 0.5 } } });
    expect(wallVerticalExtent(w, grid, { height: 2 }).top).toBe(1);
  });
  it("v14 level height bounds a wall when given", () => {
    const w = W({});
    expect(wallVerticalExtent(w, grid, { height: 2, level: { bottom: 10, top: 15 } })).toEqual({ bottom: 2, top: 3 });
    expect(wallVerticalExtent(w, grid, { height: 2, level: { bottom: 0, top: Infinity } })).toEqual({ bottom: 0, top: 2 });
  });
  it("window opening sections", () => {
    const s = windowSections(0, 2);
    expect(s.lower).toEqual({ bottom: 0, top: 0.7 });
    expect(s.glass).toEqual({ bottom: 0.7, top: 1.6 });
    expect(s.upper).toEqual({ bottom: 1.6, top: 2 });
  });
  it("material keys for windows and glass", () => {
    const win = W({ sight: WALL_SENSE.PROXIMITY });
    expect(wallMaterialKey(win, { mode: WALL_MODES.MAP, windowTexture: "frame.png" })).toBe("tex:frame.png");
    expect(wallMaterialKey(win, { mode: WALL_MODES.MAP })).toBe("map");
    const inv = W({ sight: WALL_SENSE.NONE });
    expect(glassMaterialKey(inv)).toBe("glass");
    expect(glassMaterialKey(inv, { glassTexture: "glass.png" })).toBe("glass:glass.png");
    const invTex = W({ sight: WALL_SENSE.NONE, flags: { "foundry-3d-view": { texture: "ice.png" } } });
    expect(glassMaterialKey(invTex, { glassTexture: "glass.png" })).toBe("glass:ice.png");
    expect(glassMaterialKey(win, { glassTexture: "glass.png" })).toBe("glass:glass.png");
  });
});
