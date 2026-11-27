/**
 * Module entry point: settings, keybinding, scene control button, public API.
 */
import { MODULE_ID } from "./core/constants.mjs";
import { Tactics3DController } from "./foundry/controller.mjs";

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
  game.settings.register(MODULE_ID, "cutaway", { scope: "client", config: false, type: Boolean, default: false });
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
    onChange: () => controller.toggle(),
    onClick: () => controller.toggle(),
  };
  if (Array.isArray(controls)) {
    const tokens = controls.find((c) => c.name === "token" || c.name === "tokens");
    tokens?.tools.push(tool);
  } else {
    const tokens = controls.tokens ?? controls.token;
    if (tokens?.tools) tokens.tools[TOOL] = tool;
  }
});

// Leaving the game view (e.g. scene deleted) must not leave a stale overlay around.
Hooks.on("canvasTearDown", () => {
  if (controller.isOpen && !game.scenes?.viewed) controller.close();
});
