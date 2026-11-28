import { describe, it, expect } from "vitest";
import { LIBRARY, THEMES, THEME_LIST, libraryOf, libraryEntry, isLibrarySrc, resolveSceneStyle, weatherFor, flickerFactor } from "../scripts/core/library.mjs";

describe("texture library", () => {
  it("has the agreed set", () => {
    expect(libraryOf("wall").length).toBe(12);
    expect(libraryOf("door").length).toBe(7);
    expect(libraryOf("window").length).toBe(2);
    expect(libraryOf("glass").length).toBe(3);
    expect(new Set(LIBRARY.map((e) => e.id)).size).toBe(LIBRARY.length);
  });
  it("library paths", () => {
    expect(isLibrarySrc("f3d:wall/marble")).toBe(true);
    expect(isLibrarySrc("f3d:wall/nope")).toBe(false);
    expect(isLibrarySrc("textures/marble.png")).toBe(false);
    expect(libraryEntry("f3d:door/iron-gate").alpha).toBe(true);
  });
  it("every theme uses existing textures of the right kind", () => {
    expect(THEME_LIST.length).toBe(7);
    for (const t of Object.values(THEMES)) {
      expect(libraryEntry(t.wallTexture).kind).toBe("wall");
      expect(libraryEntry(t.doorTexture).kind).toBe("door");
      expect(libraryEntry(t.windowTexture).kind).toBe("window");
      expect(libraryEntry(t.glassTexture).kind).toBe("glass");
    }
  });
});

describe("scene style", () => {
  const world = { wallMode: "map", wallTexture: "", doorTexture: "oak.png", windowTexture: "", glassTexture: "" };
  it("no scene flags: the world settings", () => {
    const s = resolveSceneStyle(world, {});
    expect(s.wallMode).toBe("map");
    expect(s.doorTexture).toBe("oak.png");
    expect(s.sky).toBeNull();
    expect(s.dust).toBe(false);
  });
  it("a theme sets everything and switches walls to textures", () => {
    const s = resolveSceneStyle(world, { theme: "dungeon" });
    expect(s.wallMode).toBe("texture");
    expect(s.wallTexture).toBe("f3d:wall/dungeon-stone");
    expect(s.doorTexture).toBe("f3d:door/reinforced");
    expect(s.dust).toBe(true);
    expect(s.sky).toBe("#07070b");
  });
  it("the scene's own picks beat its theme", () => {
    const s = resolveSceneStyle(world, { theme: "dungeon", doorTexture: "f3d:door/iron-gate", dust: false });
    expect(s.doorTexture).toBe("f3d:door/iron-gate");
    expect(s.wallTexture).toBe("f3d:wall/dungeon-stone");
    expect(s.dust).toBe(false);
  });
});

describe("weather and flicker", () => {
  it("maps Foundry weather ids", () => {
    expect(weatherFor("rain").kind).toBe("rain");
    expect(weatherFor("blizzard").kind).toBe("snow");
    expect(weatherFor("fog").kind).toBe("fog");
    expect(weatherFor("")).toBeNull();
  });
  it("torches flicker, plain lights don't", () => {
    expect(flickerFactor(null, 1)).toBe(1);
    const vals = Array.from({ length: 50 }, (_, i) => flickerFactor("torch", i * 0.05));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0.78 - 1e-9);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.05);
  });
});
