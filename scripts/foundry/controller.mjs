/**
 * Foundry glue: builds the overlay, feeds the View3D from the current scene and keeps it in sync
 * through document hooks. Everything Foundry-specific lives here and in main.mjs.
 */
import { MODULE_ID, GRID_TYPE } from "../core/constants.mjs";
import { buildSceneModel, tokenData } from "../core/scene-model.mjs";
import { wallData } from "../core/walls.mjs";
import { heightMapsEqual, normalizeHeightMap } from "../core/heights.mjs";
import { View3D } from "../render/view3d.mjs";
import { createHud } from "../ui/hud.mjs";

const t = (key) => game.i18n.localize(key);

export class Tactics3DController {
  constructor() {
    this.view = null;
    this.hud = null;
    this.overlay = null;
    this._hooks = [];
    this._visTimer = null;
    this._saveTimer = null;
    this._pendingHeights = null;
    this._opening = null;
  }

  get isOpen() {
    return !!this.overlay;
  }

  toggle() {
    return this.isOpen ? this.close() : this.open();
  }

  async open() {
    if (this.isOpen || this._opening) return;
    const scene = canvas?.scene;
    if (!canvas?.ready || !scene) {
      ui.notifications.warn(t("F3D.Notify.NoScene"));
      return;
    }
    const gridType = scene.grid?.type ?? canvas.grid?.type;
    if (gridType !== GRID_TYPE.SQUARE && gridType !== GRID_TYPE.GRIDLESS) {
      ui.notifications.warn(t("F3D.Notify.SquareOnly"));
      return;
    }
    this._opening = this._build().finally(() => (this._opening = null));
    await this._opening;
    ui.controls?.render?.();
  }

  async _build() {
    const overlay = document.createElement("div");
    overlay.id = "f3d-overlay";
    if (game.settings.get(MODULE_ID, "windowed")) overlay.classList.add("f3d-windowed");
    const viewport = document.createElement("div");
    viewport.className = "f3d-viewport";
    overlay.appendChild(viewport);
    const board = document.getElementById("board");
    if (board?.parentElement) board.after(overlay);
    else document.body.appendChild(overlay);
    this.overlay = overlay;

    this.view = new View3D(viewport, {
      isGM: game.user.isGM,
      wallHeight: Number(game.settings.get(MODULE_ID, "wallHeight")) || 1.5,
      showGrid: game.settings.get(MODULE_ID, "showGrid"),
    });
    await this._loadScene();

    const distance = canvas.dimensions.distance ?? canvas.scene.grid.distance;
    this.hud = createHud(overlay, {
      view: this.view,
      t,
      isGM: game.user.isGM,
      step: Math.round((Number(game.settings.get(MODULE_ID, "heightStep")) || 0.5) * distance * 1000) / 1000,
      unitLabel: canvas.scene.grid?.units ?? "",
      getWalls: () => Array.from(canvas.scene.walls).map(wallData),
      getFocus: () => this._focusPoint(),
      onHeightsChanged: (h) => this._queueSaveHeights(h),
      onClose: () => this.close(),
      confirm: (msg) => confirmDialog(msg),
    });
    this._addWindowToggle();
    this._registerHooks();
    this._visTimer = setInterval(() => this.syncVisibility(), 300);
  }

  _addWindowToggle() {
    const group = document.createElement("div");
    group.className = "f3d-group";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "f3d-btn";
    b.title = t("F3D.HUD.Windowed");
    b.innerHTML = `<i class="fa-solid fa-window-restore"></i><span>${t("F3D.HUD.Windowed")}</span>`;
    b.addEventListener("click", () => {
      const on = !this.overlay.classList.contains("f3d-windowed");
      this.overlay.classList.toggle("f3d-windowed", on);
      game.settings.set(MODULE_ID, "windowed", on);
    });
    group.appendChild(b);
    this.hud.element.insertBefore(group, this.hud.element.lastChild);
  }

  async _loadScene() {
    const model = buildSceneModel(canvas.scene, canvas.dimensions);
    model.background.src = resolveSrc(model.background.src);
    for (const tok of model.tokens) tok.src = resolveSrc(tok.src);
    await this.view.load(model);
    this.syncVisibility(true);
    const focus = this._focusPoint();
    if (focus) this.view.resetCamera(focus);
  }

  /** Controlled token, else the user's first owned visible token, else scene centre (null). */
  _focusPoint() {
    const tok = canvas.tokens?.controlled?.[0] ?? canvas.tokens?.placeables?.find((p) => p.isOwner && p.isVisible);
    if (!tok) return null;
    return { x: tok.document.x + (tok.document.width * canvas.grid.size) / 2, y: tok.document.y + (tok.document.height * canvas.grid.size) / 2 };
  }

  close() {
    if (!this.isOpen) return;
    for (const [name, id] of this._hooks) Hooks.off(name, id);
    this._hooks = [];
    clearInterval(this._visTimer);
    this._flushHeights();
    this.hud?.destroy();
    this.view?.dispose();
    this.overlay?.remove();
    this.view = this.hud = this.overlay = null;
    ui.controls?.render?.();
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Live sync                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  _on(name, fn) {
    this._hooks.push([name, Hooks.on(name, fn)]);
  }

  _registerHooks() {
    const inScene = (doc) => doc?.parent?.id === canvas.scene?.id;

    this._on("createWall", (doc) => inScene(doc) && this.view.upsertWall(wallData(doc)));
    this._on("updateWall", (doc) => inScene(doc) && this.view.upsertWall(wallData(doc)));
    this._on("deleteWall", (doc) => inScene(doc) && this.view.removeWall(doc.id));

    this._on("createToken", async (doc) => {
      if (!inScene(doc)) return;
      const data = tokenData(doc);
      data.src = resolveSrc(data.src);
      await this.view.upsertToken(data);
      this.syncVisibility();
    });
    this._on("updateToken", (doc, changes) => {
      if (!inScene(doc)) return;
      const data = tokenData(doc);
      data.src = resolveSrc(data.src);
      // Position is animated through refreshToken; here we only need the final state.
      this.view.upsertToken(data);
      if ("hidden" in changes) this.syncVisibility();
    });
    this._on("deleteToken", (doc) => inScene(doc) && this.view.removeToken(doc.id));

    // Follow Foundry's own token movement animation frame by frame.
    this._on("refreshToken", (token) => {
      if (!token?.document || token.document.parent?.id !== canvas.scene?.id) return;
      const x = Number.isFinite(token.x) ? token.x : token.document.x;
      const y = Number.isFinite(token.y) ? token.y : token.document.y;
      this.view.moveToken(token.document.id, { x, y, elevation: token.document.elevation });
    });

    this._on("updateScene", (doc, changes) => {
      if (doc.id !== canvas.scene?.id) return;
      const raw = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.heights`);
      if (raw !== undefined) {
        const next = normalizeHeightMap(doc.getFlag(MODULE_ID, "heights"), this.view.grid.cols, this.view.grid.rows);
        if (!this._pendingHeights || heightMapsEqual(next, this._pendingHeights)) this.view.setHeights(next);
      }
    });

    // Scene switched or redrawn (grid/background/dimension changes trigger a redraw).
    this._on("canvasReady", () => {
      if (!this.isOpen) return;
      const type = canvas.scene?.grid?.type;
      if (!canvas.scene || (type !== GRID_TYPE.SQUARE && type !== GRID_TYPE.GRIDLESS)) return this.close();
      this._loadScene();
    });

    this._on("sightRefresh", () => this.syncVisibility());
    this._on("controlToken", () => this.syncVisibility());
  }

  /**
   * Players only see tokens their vision allows (Foundry's own Token#isVisible). The GM sees
   * everything; hidden tokens are drawn as ghosts.
   * TODO(lighting/fog milestone): walls/terrain are not fog-limited yet.
   */
  syncVisibility() {
    if (!this.view || !canvas.tokens) return;
    const isGM = game.user.isGM;
    for (const doc of canvas.scene.tokens) {
      const placeable = canvas.tokens.get(doc.id);
      if (isGM) {
        this.view.setTokenVisibility(doc.id, true, doc.hidden);
        continue;
      }
      const visible = placeable ? (placeable.isVisible ?? placeable.visible) : !doc.hidden;
      this.view.setTokenVisibility(doc.id, !!visible && !doc.hidden, false);
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Heights persistence                                                                      */
  /* ---------------------------------------------------------------------------------------- */

  _queueSaveHeights(heights) {
    this._pendingHeights = heights;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flushHeights(), 400);
  }

  _flushHeights() {
    clearTimeout(this._saveTimer);
    const heights = this._pendingHeights;
    this._pendingHeights = null;
    if (!heights || !game.user.isGM || !canvas.scene) return;
    canvas.scene.update({ [`flags.${MODULE_ID}.heights`]: { cols: heights.cols, rows: heights.rows, data: heights.data } });
  }
}

/** Foundry stores paths relative to the data folder; make them loadable by three.js. */
export function resolveSrc(src) {
  if (!src || typeof src !== "string") return src;
  if (/^(https?:|data:|blob:|\/)/i.test(src)) return src;
  const route = foundry.utils?.getRoute;
  return route ? route(src) : `/${src}`;
}

async function confirmDialog(message) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2) return !!(await DialogV2.confirm({ window: { title: game.i18n.localize("F3D.Title") }, content: `<p>${message}</p>` }));
  return window.confirm(message);
}
