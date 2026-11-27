/**
 * Module entry point: settings, keybinding, scene control button, public API.
 */
import { MODULE_ID } from "./core/constants.mjs";
import { Tactics3DController } from "./foundry/controller.mjs";
import { injectWallConfig, openBulkWallDialog } from "./foundry/wall-config.mjs";
import { injectTokenConfig } from "./foundry/token-config.mjs";
import { injectTileConfig, exportModelsToData } from "./foundry/tile-config.mjs";

const controller = new Tactics3DController();
const TOOL = "f3dToggle";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "wallHeight", {
    name: "F3D.Settings.WallHeight.Name",
    hint: "F3D.Settings.WallHeight.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1.5,
    range: { min: 0.25, max: 10, step: 0.25 },
  });
  game.settings.register(MODULE_ID, "heightStep", {
    name: "F3D.Settings.HeightStep.Name",
    hint: "F3D.Settings.HeightStep.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0.5,
    range: { min: 0.1, max: 4, step: 0.1 },
  });
  const restyle = () => controller.applyWallStyle();
  game.settings.register(MODULE_ID, "wallMode", {
    name: "F3D.Settings.WallMode.Name",
    hint: "F3D.Settings.WallMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      map: "F3D.Settings.WallMode.Map",
      texture: "F3D.Settings.WallMode.Texture",
      flat: "F3D.Settings.WallMode.Flat",
    },
    default: "map",
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "wallTexture", {
    name: "F3D.Settings.WallTexture.Name",
    hint: "F3D.Settings.WallTexture.Hint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "image",
    default: "",
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "doorTexture", {
    name: "F3D.Settings.DoorTexture.Name",
    hint: "F3D.Settings.DoorTexture.Hint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "image",
    default: "",
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "wallTextureScale", {
    name: "F3D.Settings.WallTextureScale.Name",
    hint: "F3D.Settings.WallTextureScale.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    range: { min: 0.25, max: 4, step: 0.25 },
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "windowTexture", {
    name: "F3D.Settings.WindowTexture.Name",
    hint: "F3D.Settings.WindowTexture.Hint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "image",
    default: "",
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "windowOpenings", {
    name: "F3D.Settings.WindowOpenings.Name",
    hint: "F3D.Settings.WindowOpenings.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "invisibleWalls", {
    name: "F3D.Settings.InvisibleWalls.Name",
    hint: "F3D.Settings.InvisibleWalls.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: { glass: "F3D.Settings.InvisibleWalls.Glass", hide: "F3D.Settings.InvisibleWalls.Hide" },
    default: "glass",
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "glassTexture", {
    name: "F3D.Settings.GlassTexture.Name",
    hint: "F3D.Settings.GlassTexture.Hint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "image",
    default: "",
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "useLevelHeight", {
    name: "F3D.Settings.UseLevelHeight.Name",
    hint: "F3D.Settings.UseLevelHeight.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: restyle,
  });
  game.settings.register(MODULE_ID, "showGrid", {
    name: "F3D.Settings.ShowGrid.Name",
    hint: "F3D.Settings.ShowGrid.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "fog3d", {
    name: "F3D.Settings.Fog3d.Name",
    hint: "F3D.Settings.Fog3d.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "foundryLighting", {
    name: "F3D.Settings.FoundryLighting.Name",
    hint: "F3D.Settings.FoundryLighting.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "combatFollow", {
    name: "F3D.Settings.CombatFollow.Name",
    hint: "F3D.Settings.CombatFollow.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "mirrorAnimations", {
    name: "F3D.Settings.MirrorAnimations.Name",
    hint: "F3D.Settings.MirrorAnimations.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "limitMovement", {
    name: "F3D.Settings.LimitMovement.Name",
    hint: "F3D.Settings.LimitMovement.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "moveRange", {
    name: "F3D.Settings.MoveRange.Name",
    hint: "F3D.Settings.MoveRange.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 6,
    range: { min: 1, max: 30, step: 1 },
  });
  game.settings.register(MODULE_ID, "attackRange", {
    name: "F3D.Settings.AttackRange.Name",
    hint: "F3D.Settings.AttackRange.Hint",
    scope: "world",
    config: true,
    type: Number,
    default: 1,
    range: { min: 0, max: 20, step: 1 },
  });
  game.settings.register(MODULE_ID, "portraits", {
    name: "F3D.Settings.Portraits.Name",
    hint: "F3D.Settings.Portraits.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: (v) => controller.view?.setPortraits(v),
  });
  game.settings.register(MODULE_ID, "cutaway", { scope: "client", config: false, type: Boolean, default: false });
  game.settings.register(MODULE_ID, "cameraMode", {
    name: "F3D.Settings.CameraMode.Name",
    hint: "F3D.Settings.CameraMode.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: { free: "F3D.Settings.CameraMode.Free", tactics: "F3D.Settings.CameraMode.Tactics" },
    default: "tactics",
  });
  game.settings.register(MODULE_ID, "spriteFacing", {
    name: "F3D.Settings.SpriteFacing.Name",
    hint: "F3D.Settings.SpriteFacing.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      camera: "F3D.HUD.Facing.camera",
      billboard: "F3D.HUD.Facing.billboard",
      standee: "F3D.HUD.Facing.standee",
    },
    default: "billboard",
  });
  game.settings.register(MODULE_ID, "showRoofs", { scope: "client", config: false, type: Boolean, default: true });
  game.settings.register(MODULE_ID, "windowed", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  game.keybindings.register(MODULE_ID, "toggle", {
    name: "F3D.Keybind.Toggle",
    editable: [{ key: "KeyV", modifiers: ["Shift"] }],
    onDown: () => {
      controller.toggle();
      return true;
    },
  });
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      open: () => controller.open(),
      close: () => controller.close(),
      toggle: () => controller.toggle(),
      /** Export the built-in 3D models as .glb files into the data folder (GM). */
      exportModels: () => exportModelsToData(),
      get isOpen() {
        return controller.isOpen;
      },
      /** Internal handle for debugging and the dev harness; not a stable API. */
      _controller: controller,
    };
  }
});

// Scene control button in the Token controls. v13+ passes an object keyed by control name;
// older versions passed an array (kept for safety).
Hooks.on("getSceneControlButtons", (controls) => {
  const tool = {
    name: TOOL,
    title: "F3D.Control.Toggle",
    icon: "fa-solid fa-cube",
    order: 100,
    button: true,
    visible: true,
    // v13 calls onChange (and, for compatibility, a legacy onClick too): only define onChange there.
    onChange: () => controller.toggle(),
  };
  if (Array.isArray(controls)) {
    // Older array-based API (v12 and earlier) used onClick for button tools.
    const tokens = controls.find((c) => c.name === "token" || c.name === "tokens");
    tokens?.tools.push({ ...tool, onChange: undefined, onClick: () => controller.toggle() });
  } else {
    const tokens = controls.tokens ?? controls.token;
    if (tokens?.tools) tokens.tools[TOOL] = tool;
    // Walls controls: apply a 3D texture/height to every selected wall (GM only).
    const tiles = controls.tiles;
    if (tiles?.tools && game.user.isGM) {
      tiles.tools.f3dExportModels = {
        name: "f3dExportModels",
        title: "F3D.TileConfig.ExportTool",
        icon: "fa-solid fa-cubes",
        order: 100,
        button: true,
        visible: true,
        onChange: () => exportModelsToData(),
      };
    }
    const walls = controls.walls;
    if (walls?.tools && game.user.isGM) {
      walls.tools.f3dWallStyle = {
        name: "f3dWallStyle",
        title: "F3D.WallTools.Title",
        icon: "fa-solid fa-paint-roller",
        order: 100,
        button: true,
        visible: true,
        onChange: () => openBulkWallDialog(),
      };
    }
  }
});

// Per-wall 3D texture field in the Wall configuration sheet (v13 ApplicationV2; v12 jQuery).
Hooks.on("renderWallConfig", (app, html) => injectWallConfig(app, html));
// Directional / animated sprite sheet fields in the Token configuration sheets.
Hooks.on("renderTokenConfig", (app, html) => injectTokenConfig(app, html));
Hooks.on("renderPrototypeTokenConfig", (app, html) => injectTokenConfig(app, html));
// 3D model fields in the Tile configuration sheet.
Hooks.on("renderTileConfig", (app, html) => injectTileConfig(app, html));

// Leaving the game view (e.g. scene deleted) must not leave a stale overlay around.
Hooks.on("canvasTearDown", () => {
  if (controller.isOpen && !game.scenes?.viewed) controller.close();
});
