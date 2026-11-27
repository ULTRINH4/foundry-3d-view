/**
 * Foundry glue: builds the overlay, feeds the View3D from the current scene and keeps it in sync
 * through document hooks. Everything Foundry-specific lives here and in main.mjs.
 */
import { MODULE_ID, GRID_TYPE, DOOR_STATE, WALL_DOOR } from "../core/constants.mjs";
import { buildSceneModel, tokenData } from "../core/scene-model.mjs";
import { wallData } from "../core/walls.mjs";
import { heightMapsEqual, normalizeHeightMap, getHeight } from "../core/heights.mjs";
import { visibleCells, fogStates, losVisibilityTest } from "../core/vision.mjs";
import { lightLevels } from "../core/lighting.mjs";
import {
  tileData, lightData, tokenLightData, levelIndexFor, gridSquares, formatDistance, DIAGONALS,
} from "../core/scene-extras.mjs";
import { cellCenter, tokenCenter } from "../core/coords.mjs";
import { View3D } from "../render/view3d.mjs";
import { createHud } from "../ui/hud.mjs";
import { createInteraction } from "../ui/interact.mjs";
import { EffectsBridge } from "./effects-bridge.mjs";

const t = (key) => game.i18n.localize(key);

export class Tactics3DController {
  constructor() {
    this.view = null;
    this.hud = null;
    this.interaction = null;
    this.overlay = null;
    this.model = null;
    this._hooks = [];
    this._visTimer = null;
    this._saveTimer = null;
    this._pendingHeights = null;
    this._opening = null;
    this._explored = new Map(); // sceneId -> Uint8Array (fog memory for this session)
    this.effects = new EffectsBridge();
    this._fogQueued = false;
  }

  get isOpen() {
    return !!this.overlay;
  }

  toggle() {
    // Guard against two triggers for one user action (e.g. a button firing two callbacks).
    const now = Date.now();
    if (now - (this._lastToggle ?? 0) < 250) return;
    this._lastToggle = now;
    return this.isOpen ? this.close() : this.open();
  }

  async open() {
    if (this.isOpen || this._opening) return;
    const scene = canvas?.scene;
    if (!canvas?.ready || !scene) {
      ui.notifications.warn(t("F3D.Notify.NoScene"));
      return;
    }
    if (!isSupportedGrid(scene)) {
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
      cutaway: game.settings.get(MODULE_ID, "cutaway"),
      showRoofs: game.settings.get(MODULE_ID, "showRoofs"),
      startHidden: !game.user.isGM,
      cameraMode: game.settings.get(MODULE_ID, "cameraMode"),
      spriteFacing: game.settings.get(MODULE_ID, "spriteFacing"),
      ...wallStyle(),
      resolveSrc,
    });
    await this._loadScene();
    if (this.overlay !== overlay) return; // closed while loading
    this._buildHud();
    this._buildInteraction();
    this._registerHooks();
    this._hudTimer = setInterval(() => {
      const hud = canvas.tokens?.hud ?? canvas.hud?.token;
      if (hud?.rendered && hud.object) this._positionTokenHUD(hud);
    }, 100);
    this._visTimer = setInterval(() => {
      this.syncVisibility();
      this._updateRoofFocus();
      this._queueFog();
    }, 400);
  }

  _buildHud() {
    this.hud?.destroy();
    const distance = canvas.dimensions.distance ?? canvas.scene.grid.distance;
    this.hud = createHud(this.overlay, {
      view: this.view,
      t,
      isGM: game.user.isGM,
      step: Math.round((Number(game.settings.get(MODULE_ID, "heightStep")) || 0.5) * distance * 1000) / 1000,
      unitLabel: canvas.scene.grid?.units ?? "",
      levels: this.model.levels,
      viewedLevelIndex: this.model.viewedLevelIndex,
      initial: {
        cutaway: game.settings.get(MODULE_ID, "cutaway"),
        showRoofs: game.settings.get(MODULE_ID, "showRoofs"),
        cameraMode: game.settings.get(MODULE_ID, "cameraMode"),
        spriteFacing: game.settings.get(MODULE_ID, "spriteFacing"),
      },
      onViewSettings: ({ cutaway, showRoofs, cameraMode, spriteFacing }) => {
        game.settings.set(MODULE_ID, "cutaway", cutaway);
        game.settings.set(MODULE_ID, "showRoofs", showRoofs);
        if (cameraMode) game.settings.set(MODULE_ID, "cameraMode", cameraMode);
        if (spriteFacing) game.settings.set(MODULE_ID, "spriteFacing", spriteFacing);
      },
      getWalls: () => Array.from(canvas.scene.walls).map(wallData).filter((w) => !w.levelIndex),
      getFocus: () => this._focusPoint(),
      onHeightsChanged: (h) => this._queueSaveHeights(h),
      onClose: () => this.close(),
      confirm: (msg) => confirmDialog(msg),
    });
    this._addWindowToggle();
  }

  _buildInteraction() {
    this.interaction?.destroy();
    this.interaction = createInteraction(this.view, {
      isBusy: () => !!this.hud?.state.painting,
      getControlled: () => (canvas.tokens?.controlled ?? []).map((p) => p.document.id),
      canControl: (id) => {
        const p = canvas.tokens?.get(id);
        return !!p && (game.user.isGM || p.isOwner);
      },
      onSelectToken: (id, additive) => canvas.tokens?.get(id)?.control({ releaseOthers: !additive }),
      onReleaseAll: () => canvas.tokens?.releaseAll(),
      onMoveToken: (id, cell) => this._moveToken(id, cell),
      onToggleDoor: (id) => this._toggleDoor(id),
      onTokenContext: (id) => this._openTokenHUD(id),
      measure: (from, to) => this._measure(from, to),
    });
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
    const model = buildSceneModel(canvas.scene, canvas.dimensions, { viewedLevelId: canvas.level?.id ?? null });
    model.background.src = resolveSrc(model.background.src);
    for (const tok of model.tokens) {
      tok.src = resolveSrc(tok.src);
      if (tok.sheet) tok.sheet.src = resolveSrc(tok.sheet.src);
    }
    for (const tile of model.tiles) tile.src = resolveSrc(tile.src);
    for (const lv of model.levels) lv.background.src = resolveSrc(lv.background.src);
    model.darkness = currentDarkness();
    this.model = model;
    const view = this.view;
    await view.load(model);
    if (this.view !== view) return; // closed (or reopened) while loading
    this.syncVisibility(true);
    this._updateFog();
    this._syncSelection();
    if (game.settings.get(MODULE_ID, "mirrorAnimations")) this.effects.start(view);
    else this.effects.stop();
    this._syncCombat(false);
    this._updateRoofFocus();
    const focus = this._focusPoint();
    if (focus) this.view.resetCamera(focus);
  }

  /** Controlled token, else the user's first owned visible token, else scene centre (null). */
  _focusPoint() {
    const tok = canvas.tokens?.controlled?.[0] ?? canvas.tokens?.placeables?.find((p) => p.isOwner && p.isVisible);
    if (!tok) return null;
    return tokenCenter(canvas.grid, tok.document);
  }

  /** Re-read the wall look settings and rebuild the walls (settings onChange). */
  applyWallStyle() {
    this.view?.setWallStyle(wallStyle());
  }

  close() {
    if (!this.isOpen) return;
    for (const [name, id] of this._hooks) Hooks.off(name, id);
    this._hooks = [];
    clearInterval(this._visTimer);
    clearInterval(this._hudTimer);
    this._flushHeights();
    this.effects.stop();
    if (this._patchedHUD) {
      delete this._patchedHUD.setPosition; // back to the class method
      delete this._patchedHUD._f3dSetPosition;
      this._patchedHUD.render?.();
      this._patchedHUD = null;
    }
    this.interaction?.destroy();
    this.hud?.destroy();
    this.view?.dispose();
    this.overlay?.remove();
    this.view = this.hud = this.overlay = this.interaction = this.model = null;
    ui.controls?.render?.();
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Actions from the 3D view                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  async _moveToken(id, cell) {
    const p = canvas.tokens?.get(id);
    if (!p) return;
    const doc = p.document;
    if (!game.user.isGM && game.paused) return ui.notifications.warn(t("F3D.Notify.Paused"));
    const g = canvas.dimensions;
    const x = g.sceneX + cell.col * g.size;
    const y = g.sceneY + cell.row * g.size;
    if (x === doc.x && y === doc.y) return;
    // Respect walls for players, like dragging in 2D does.
    const dest = { x: x + (doc.width * g.size) / 2, y: y + (doc.height * g.size) / 2 };
    if (!game.user.isGM && typeof p.checkCollision === "function") {
      try {
        if (p.checkCollision(dest, { type: "move", mode: "any" })) return ui.notifications.warn(t("F3D.Notify.Blocked"));
      } catch (e) {
        console.warn("foundry-3d-view | collision check failed", e);
      }
    }
    await doc.update({ x, y });
  }

  async _toggleDoor(id) {
    const wall = canvas.scene.walls.get(id);
    if (!wall || wall.door === WALL_DOOR.NONE) return;
    if (!game.user.isGM) {
      if (game.paused) return ui.notifications.warn(t("F3D.Notify.Paused"));
      if (wall.ds === DOOR_STATE.LOCKED) return ui.notifications.info(t("F3D.Notify.DoorLocked"));
      if (wall.door === WALL_DOOR.SECRET && wall.ds !== DOOR_STATE.OPEN) return;
    }
    const ds = wall.ds === DOOR_STATE.OPEN ? DOOR_STATE.CLOSED : DOOR_STATE.OPEN;
    await wall.update({ ds });
  }

  _measure(from, to) {
    const g = canvas.dimensions;
    const a = cellCenter(this.view.grid, from.col, from.row);
    const b = cellCenter(this.view.grid, to.col, to.row);
    let squares = null;
    let distance = null;
    try {
      const r = canvas.grid.measurePath?.([a, b]);
      if (r && Number.isFinite(r.distance)) distance = r.distance;
    } catch {
      /* fall back below */
    }
    if (distance === null) {
      const rule = canvas.scene.grid?.diagonals ?? game.settings.get("core", "gridDiagonals") ?? DIAGONALS.EQUIDISTANT;
      squares = gridSquares(from, to, rule);
      distance = squares * g.distance;
    }
    const h = this.view.getHeights();
    const dh = getHeight(h, to.col, to.row) - getHeight(h, from.col, from.row);
    return formatDistance(distance / g.distance, g.distance, canvas.scene.grid?.units ?? "", dh);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Live sync                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  _on(name, fn) {
    this._hooks.push([name, Hooks.on(name, fn)]);
  }

  _withLevel(doc, data) {
    return { ...data, levelIndex: levelIndexFor(doc, this.model?.levels ?? []) };
  }

  _registerHooks() {
    const inScene = (doc) => doc?.parent?.id === canvas.scene?.id;
    const wall = (doc) => {
      const w = wallData(doc);
      return this._withLevel({ level: doc.level, levels: doc.levels, elevation: w.bottom ?? 0 }, w);
    };

    this._on("createWall", (doc) => inScene(doc) && (this.view.upsertWall(wall(doc)), this._queueFog()));
    this._on("updateWall", (doc) => inScene(doc) && (this.view.upsertWall(wall(doc)), this._queueFog()));
    this._on("deleteWall", (doc) => inScene(doc) && (this.view.removeWall(doc.id), this._queueFog()));

    const token = (doc) => {
      const data = this._withLevel(doc, tokenData(doc));
      data.src = resolveSrc(data.src);
      if (data.sheet) data.sheet.src = resolveSrc(data.sheet.src);
      return data;
    };
    this._on("createToken", async (doc) => {
      if (!inScene(doc)) return;
      await this.view.upsertToken(token(doc));
      this._refreshLights();
      this.syncVisibility();
    });
    this._on("updateToken", (doc, changes) => {
      if (!inScene(doc)) return;
      // Position is animated through refreshToken; here we only need the final state.
      this.view.upsertToken(token(doc));
      if ("light" in changes) this._refreshLights();
      if ("hidden" in changes) this.syncVisibility();
    });
    this._on("deleteToken", (doc) => {
      if (!inScene(doc)) return;
      this.view.removeToken(doc.id);
      this._refreshLights();
    });

    // Follow Foundry's own token movement animation frame by frame.
    this._on("refreshToken", (tok) => {
      if (!tok?.document || tok.document.parent?.id !== canvas.scene?.id) return;
      const x = Number.isFinite(tok.x) ? tok.x : tok.document.x;
      const y = Number.isFinite(tok.y) ? tok.y : tok.document.y;
      this.view.moveToken(tok.document.id, { x, y, elevation: tok.document.elevation });
    });
    this._on("controlToken", () => {
      this._syncSelection();
      this._updateRoofFocus();
      this.interaction?.refresh();
      this.syncVisibility();
    });

    const tile = (doc) => {
      const data = this._withLevel(doc, tileData(doc));
      data.src = resolveSrc(data.src);
      return data;
    };
    this._on("createTile", (doc) => inScene(doc) && this.view.upsertTile(tile(doc)));
    this._on("updateTile", (doc) => inScene(doc) && this.view.upsertTile(tile(doc)));
    this._on("deleteTile", (doc) => inScene(doc) && this.view.removeTile(doc.id));

    for (const hook of ["createAmbientLight", "updateAmbientLight", "deleteAmbientLight"]) {
      this._on(hook, (doc) => inScene(doc) && this._refreshLights());
    }
    this._on("lightingRefresh", () => {
      this._refreshDarkness();
      this._queueFog();
    });

    // v14 scene levels: edits change floors/backgrounds, so rebuild (switching the viewed level
    // already redraws the canvas and reloads us through canvasReady).
    const reloadForLevel = foundry.utils.debounce?.(async () => {
      if (!this.isOpen) return;
      await this._loadScene();
      if (!this.isOpen) return;
      this._buildHud();
      this._buildInteraction();
    }, 300) ?? (() => {});
    for (const hook of ["createLevel", "updateLevel", "deleteLevel"]) {
      this._on(hook, (doc) => inScene(doc) && reloadForLevel());
    }

    this._on("updateScene", (doc, changes) => {
      if (doc.id !== canvas.scene?.id) return;
      const raw = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.heights`);
      if (raw !== undefined) {
        const next = normalizeHeightMap(doc.getFlag(MODULE_ID, "heights"), this.view.grid.cols, this.view.grid.rows);
        if (!this._pendingHeights || heightMapsEqual(next, this._pendingHeights)) this.view.setHeights(next);
      }
      if (foundry.utils.hasProperty(changes, "environment") || "darkness" in changes) this._refreshDarkness();
      if ("tokenVision" in changes) this._queueFog();
    });

    // Scene switched or redrawn (grid/background/dimension changes trigger a redraw).
    this._on("canvasReady", async () => {
      if (!this.isOpen) return;
      if (!canvas.scene || !isSupportedGrid(canvas.scene)) return this.close();
      await this._loadScene();
      if (!this.isOpen) return;
      this._buildHud();
      this._buildInteraction();
    });

    // Combat: follow the active combatant and mark it.
    for (const hook of ["combatStart", "combatTurn", "combatRound", "deleteCombat", "createCombat"]) {
      this._on(hook, () => setTimeout(() => this._syncCombat(true), 50));
    }
    this._on("updateCombat", (combat, changes) => {
      if ("turn" in changes || "round" in changes || "started" in changes || "combatants" in changes) setTimeout(() => this._syncCombat(true), 50);
    });
    // Foundry's Token HUD: keep it over the 3D standee while the view is open.
    this._on("renderTokenHUD", (hud) => this._positionTokenHUD(hud));
    this._on("sightRefresh", () => {
      this.syncVisibility();
      this._queueFog();
    });
  }

  /** Mark the combatant whose turn it is and (optionally) pan the camera to it. */
  _syncCombat(pan) {
    if (!this.view) return;
    const combat = game.combat;
    const active = combat?.started && (!combat.scene || combat.scene.id === canvas.scene?.id) ? combat.combatant : null;
    const id = active?.tokenId ?? active?.token?.id ?? null;
    const shown = id && this.view.tokens.get(id)?.group.visible;
    this.view.setActiveToken(shown ? id : null);
    if (pan && shown && game.settings.get(MODULE_ID, "combatFollow")) {
      const doc = canvas.scene.tokens.get(id);
      if (doc) this.view.panToCanvasPoint(...Object.values(tokenCenter(canvas.grid, doc)));
    }
  }

  /** Right-click on a standee: control it and open Foundry's Token HUD over it. */
  _openTokenHUD(id) {
    const p = canvas.tokens?.get(id);
    if (!p || !(game.user.isGM || p.isOwner)) return;
    if (!p.controlled) p.control({ releaseOthers: true });
    const hud = canvas.tokens.hud ?? canvas.hud?.token;
    if (!hud) return;
    if (hud.object === p && hud.rendered) return hud.close?.();
    hud.bind(p);
  }

  /** Move the Token HUD (drawn in canvas coordinates under #hud) onto the standee's screen rect. */
  _positionTokenHUD(hud) {
    if (!this.view || !hud?.object) return;
    // Foundry repositions the HUD on its own (canvas pan, token refresh): run ours after it.
    if (!hud._f3dSetPosition && typeof hud.setPosition === "function") {
      hud._f3dSetPosition = hud.setPosition;
      hud.setPosition = (...args) => {
        const out = hud._f3dSetPosition.apply(hud, args);
        if (this.view) this._positionTokenHUD(hud);
        return out;
      };
      this._patchedHUD = hud;
    }
    const rect = this.view.tokenScreenRect(hud.object.document.id);
    const el = hud.element instanceof HTMLElement ? hud.element : hud.element?.[0];
    if (!rect || !el || !canvas.stage) return;
    const inv = canvas.stage.worldTransform;
    const a = inv.applyInverse({ x: rect.x, y: rect.y });
    const b = inv.applyInverse({ x: rect.x + rect.width, y: rect.y + rect.height });
    Object.assign(el.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px` });
    el.dataset.f3d = "1";
  }

  _syncSelection() {
    if (!this.view) return;
    for (const [id] of this.view.tokens) this.view.setTokenSelected(id, !!canvas.tokens?.get(id)?.controlled);
  }

  /** Roofs fade over the tokens this user is looking through. */
  _updateRoofFocus() {
    if (!this.view || !canvas.tokens) return;
    const toks = canvas.tokens.controlled.length
      ? canvas.tokens.controlled
      : canvas.tokens.placeables.filter((p) => !game.user.isGM && p.isOwner);
    this.view.setRoofFocus(toks.map((p) => ({ x: p.center.x, y: p.center.y })));
  }

  _refreshLights() {
    if (!this.view) return;
    const lights = [
      ...Array.from(canvas.scene.lights ?? []).map(lightData),
      ...Array.from(canvas.scene.tokens ?? []).map(tokenLightData).filter(Boolean),
    ];
    this.view.setLights(lights, currentDarkness());
  }

  _refreshDarkness() {
    if (!this.view) return;
    const d = currentDarkness();
    if (Math.abs(d - this.view.darkness) > 0.01) this.view.setLights(this.view.lights, d);
  }

  /**
   * Players only see tokens their vision allows (Foundry's own Token#isVisible). The GM sees
   * everything; hidden tokens are drawn as ghosts.
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
      // v14 only creates placeables for the viewed level: no placeable means another level, which
      // a player must not see (falling back to !hidden would leak tokens from other floors).
      const visible = placeable ? (placeable.isVisible ?? placeable.visible) : false;
      this.view.setTokenVisibility(doc.id, !!visible && !doc.hidden, false);
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Fog of war in 3D                                                                         */
  /* ---------------------------------------------------------------------------------------- */

  _queueFog() {
    if (this._fogQueued) return;
    this._fogQueued = true;
    setTimeout(() => {
      this._fogQueued = false;
      this._updateFog();
    }, 120);
  }

  _fogEnabled() {
    return !game.user.isGM && !!canvas.scene?.tokenVision && game.settings.get(MODULE_ID, "fog3d");
  }

  /**
   * Per-square fog: a square is "visible" if Foundry's visibility test passes for any of a few
   * points inside it (this honours lights, darkvision, walls and every vision mode). Squares seen
   * before stay "explored" for the rest of the session.
   */
  _updateFog() {
    if (!this.view?.grid) return;
    if (!this._fogEnabled()) {
      this.view.setFog(null);
      this._updateLighting(null);
      return;
    }
    const g = this.view.grid;
    let test;
    const vis = canvas.visibility;
    if (vis?.testVisibility) {
      test = (x, y) => vis.testVisibility({ x, y }, { tolerance: 1 });
    } else {
      // Fallback: our own line of sight from owned tokens with vision.
      const sources = canvas.tokens.placeables
        .filter((p) => p.isOwner && p.document.sight?.enabled !== false)
        .map((p) => ({ x: p.center.x, y: p.center.y, radius: sightRadiusPx(p.document) }));
      test = losVisibilityTest(sources, Array.from(canvas.scene.walls).map(wallData), g);
    }
    const id = canvas.scene.id;
    const visible = visibleCells(g, test);
    const fog = fogStates(this._explored.get(id) ?? null, visible);
    this._explored.set(id, fog.explored);
    this.view.setFog(fog.states);
    this._updateLighting(visible);
  }

  /**
   * Shade the 3D view with Foundry's lighting: each square is lit by the real light sources
   * (ambient lights and token lights, clipped by walls), unlit squares get the scene darkness, and
   * for players squares seen without light (darkvision) show in greys.
   * @param {Uint8Array|null} visible  squares the player sees (null for the GM)
   */
  _updateLighting(visible) {
    if (!this.view?.grid) return;
    const darkness = currentDarkness();
    const global = !!canvas.environment?.globalLightSource?.active;
    if (!game.settings.get(MODULE_ID, "foundryLighting") || darkness < 0.05 || global) {
      this.view.setLightMap(null);
      return;
    }
    const sources = [];
    for (const src of canvas.effects?.lightSources?.values?.() ?? []) {
      if (!src?.active || src.isGlobal || src.isDarkness || src.constructor?.name === "GlobalLightSource") continue;
      const d = src.data ?? {};
      const shape = src.shape;
      sources.push({
        x: Number(d.x) || 0, y: Number(d.y) || 0, bright: Number(d.bright) || 0, dim: Number(d.dim) || 0,
        contains: typeof shape?.contains === "function" ? (x, y) => shape.contains(x, y) : null,
      });
    }
    const levels = lightLevels(this.view.grid, sources);
    // Magical darkness areas (v12+ darkness sources) stay dark.
    if (typeof canvas.effects?.testInsideDarkness === "function") {
      const g = this.view.grid;
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const i = r * g.cols + c;
          if (!levels[i]) continue;
          const p = cellCenter(g, c, r);
          try {
            if (canvas.effects.testInsideDarkness({ x: p.x, y: p.y })) levels[i] = 0;
          } catch {
            /* API differences: ignore */
          }
        }
      }
    }
    this.view.setLightMap(levels, { vision: visible });
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

/** Wall look from the module settings. */
function wallStyle() {
  return {
    wallMode: game.settings.get(MODULE_ID, "wallMode"),
    wallTexture: game.settings.get(MODULE_ID, "wallTexture"),
    doorTexture: game.settings.get(MODULE_ID, "doorTexture"),
    wallTextureScale: Number(game.settings.get(MODULE_ID, "wallTextureScale")) || 1,
    windowTexture: game.settings.get(MODULE_ID, "windowTexture"),
    glassTexture: game.settings.get(MODULE_ID, "glassTexture"),
    windowOpenings: game.settings.get(MODULE_ID, "windowOpenings"),
    invisibleWalls: game.settings.get(MODULE_ID, "invisibleWalls"),
    useLevelHeight: game.settings.get(MODULE_ID, "useLevelHeight"),
  };
}

function isSupportedGrid(scene) {
  const type = scene.grid?.type ?? canvas.grid?.type;
  return type === GRID_TYPE.SQUARE || type === GRID_TYPE.GRIDLESS;
}

/** Live darkness (animated transitions included) with fallbacks for older APIs. */
function currentDarkness() {
  const d = canvas.environment?.darknessLevel ?? canvas.darknessLevel ?? canvas.scene?.environment?.darknessLevel ?? canvas.scene?.darkness ?? 0;
  return Number(d) || 0;
}

/** Token sight range in px (Infinity when unlimited). */
function sightRadiusPx(doc) {
  const range = Number(doc.sight?.range);
  if (!Number.isFinite(range) || range <= 0) return Infinity;
  return (range / canvas.dimensions.distance) * canvas.dimensions.size;
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
