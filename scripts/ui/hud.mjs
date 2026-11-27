/**
 * Toolbar over the 3D view + the GM height painting tool. Plain DOM so it works both inside
 * Foundry and on the standalone dev page.
 */
import { bumpBrush, createHeightMap, autoHeightsFromWalls, HeightHistory } from "../core/heights.mjs";
import { CUT_MODE_LIST, normalizeCutMode } from "../core/cutaway.mjs";

const BRUSHES = [1, 3, 5];

/**
 * @param {HTMLElement} root        overlay element
 * @param {object} o
 * @param {import("../render/view3d.mjs").View3D} o.view
 * @param {(key:string)=>string} o.t           localization function
 * @param {boolean} o.isGM
 * @param {number} o.step                      paint step in grid distance units
 * @param {string} o.unitLabel                 e.g. "ft"
 * @param {()=>object[]} o.getWalls            current wallData()[]
 * @param {(heights:object)=>void} o.onHeightsChanged
 * @param {{id:string,name:string}[]} [o.levels]  scene levels (shown as a selector when > 1)
 * @param {number|null} [o.viewedLevelIndex]      level the selector starts at (v14 viewed level)
 * @param {(settings:object)=>void} [o.onViewSettings]  persist cutaway/roofs toggles
 * @param {{cutMode?:string, cutaway?:boolean, showRoofs?:boolean}} [o.initial]
 * @param {()=>{x:number,y:number}|null} [o.getFocus]
 * @param {()=>void} [o.onClose]
 * @param {(msg:string)=>Promise<boolean>} [o.confirm]
 */
export function createHud(root, o) {
  const { view, t } = o;
  const state = {
    painting: false,
    topDown: false,
    cutMode: normalizeCutMode(o.initial?.cutMode ?? o.initial?.cutaway),
    tactics: o.initial?.cameraMode === "tactics",
    spriteFacing: o.initial?.spriteFacing ?? "camera",
    showRoofs: o.initial?.showRoofs ?? true,
    brush: 1,
  };
  const history = new HeightHistory(50);
  const bar = el("div", "f3d-hud");
  root.appendChild(bar);
  view.setCutMode(state.cutMode);
  view.setShowRoofs(state.showRoofs);

  const button = (icon, label, onClick, cls = "") => {
    const b = el("button", `f3d-btn ${cls}`);
    b.type = "button";
    b.title = label;
    b.dataset.tooltip = label; // Foundry's tooltip on hover
    b.dataset.tooltipDirection = "UP";
    b.innerHTML = `<i class="${icon}"></i><span>${label}</span>`;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      onClick(b);
    });
    return b;
  };
  const toggle = (icon, label, key, apply) => {
    const b = button(icon, label, () => {
      state[key] = !state[key];
      b.classList.toggle("active", state[key]);
      apply(state[key]);
      o.onViewSettings?.(viewSettings());
    });
    b.classList.toggle("active", !!state[key]);
    b.dataset.key = key;
    return b;
  };

  const viewSettings = () => ({
    cutMode: state.cutMode, showRoofs: state.showRoofs,
    cameraMode: state.tactics ? "tactics" : "free", spriteFacing: state.spriteFacing,
  });
  const FACINGS = ["camera", "billboard", "standee"];
  const facingLabel = () => `${t("F3D.HUD.Sprites")}: ${t(`F3D.HUD.Facing.${state.spriteFacing}`)}`;
  view.setSpriteFacing?.(state.spriteFacing);
  const camGroup = el("div", "f3d-group");
  camGroup.append(
    toggle("fa-solid fa-map", t("F3D.HUD.TopDown"), "topDown", (on) => view.setTopDown(on)),
    toggle("fa-solid fa-chess-board", t("F3D.HUD.Tactics"), "tactics", (on) => view.setCameraMode(on ? "tactics" : "free")),
    button("fa-solid fa-rotate-left", t("F3D.HUD.RotateLeft"), () => view.rotateBy(state.tactics ? -90 : -45)),
    button("fa-solid fa-rotate-right", t("F3D.HUD.RotateRight"), () => view.rotateBy(state.tactics ? 90 : 45)),
    button("fa-solid fa-crosshairs", t("F3D.HUD.Recenter"), () => view.resetCamera(o.getFocus?.() ?? null)),
    (() => {
      // Walls up / cutaway (The Sims) / down, like The Sims' wall buttons.
      const ICONS = { up: "fa-solid fa-building", cutaway: "fa-solid fa-scissors", down: "fa-solid fa-grip-lines" };
      const label = () => `${t("F3D.HUD.Walls")}: ${t(`F3D.HUD.WallsMode.${state.cutMode}`)}`;
      const b = button(ICONS[state.cutMode], label(), () => {
        state.cutMode = CUT_MODE_LIST[(CUT_MODE_LIST.indexOf(state.cutMode) + 1) % CUT_MODE_LIST.length];
        view.setCutMode(state.cutMode);
        b.querySelector("i").className = ICONS[state.cutMode];
        b.querySelector("span").textContent = label();
        b.title = label();
        b.dataset.tooltip = label();
        b.dataset.mode = state.cutMode;
        b.classList.toggle("active", state.cutMode !== "up");
        o.onViewSettings?.(viewSettings());
      });
      b.dataset.key = "cutaway";
      b.dataset.mode = state.cutMode;
      b.classList.toggle("active", state.cutMode !== "up");
      return b;
    })(),
    toggle("fa-solid fa-house-chimney", t("F3D.HUD.Roofs"), "showRoofs", (on) => view.setShowRoofs(on)),
    (() => {
      const b = button("fa-solid fa-person", facingLabel(), () => {
        state.spriteFacing = FACINGS[(FACINGS.indexOf(state.spriteFacing) + 1) % FACINGS.length];
        view.setSpriteFacing(state.spriteFacing);
        b.querySelector("span").textContent = facingLabel();
        b.title = facingLabel();
        o.onViewSettings?.(viewSettings());
      });
      b.dataset.key = "spriteFacing";
      return b;
    })(),
  );
  if (o.levels && o.levels.length > 1) {
    const sel = el("select", "f3d-level");
    sel.title = t("F3D.HUD.Levels");
    const all = el("option");
    all.value = "all";
    all.textContent = t("F3D.HUD.AllLevels");
    sel.appendChild(all);
    o.levels.forEach((lv, i) => {
      const opt = el("option");
      opt.value = String(i);
      opt.textContent = `≤ ${lv.name}`;
      sel.appendChild(opt);
    });
    if (Number.isInteger(o.viewedLevelIndex)) sel.value = String(o.viewedLevelIndex);
    sel.addEventListener("change", () => view.setLevelCutoff(sel.value === "all" ? Infinity : Number(sel.value)));
    camGroup.appendChild(sel);
  }
  bar.appendChild(camGroup);

  let paintGroup = null;
  let onKey = null;
  if (o.isGM) {
    paintGroup = el("div", "f3d-group f3d-paint");
    const stepLabel = el("span", "f3d-step");
    stepLabel.textContent = `${t("F3D.HUD.Step")}: ${o.step} ${o.unitLabel ?? ""}`.trim();
    const paintBtn = button("fa-solid fa-mountain", t("F3D.HUD.PaintHeights"), (b) => {
      state.painting = !state.painting;
      b.classList.toggle("active", state.painting);
      root.classList.toggle("f3d-painting", state.painting);
      if (!state.painting) view.highlightCell(null);
    });
    paintBtn.dataset.key = "painting";
    const apply = (map) => {
      history.push(view.getHeights());
      view.setHeights(map);
      o.onHeightsChanged(view.getHeights());
      undoBtn.disabled = history.size === 0;
    };
    const undo = () => {
      const prev = history.pop();
      if (!prev) return;
      view.setHeights(prev);
      o.onHeightsChanged(view.getHeights());
      undoBtn.disabled = history.size === 0;
    };
    const auto = (mode) => apply(autoHeightsFromWalls(o.getWalls(), view.grid, { mode, step: o.step }));
    const brushBtn = button("fa-solid fa-brush", `${t("F3D.HUD.Brush")}: 1×1`, (b) => {
      state.brush = BRUSHES[(BRUSHES.indexOf(state.brush) + 1) % BRUSHES.length];
      b.querySelector("span").textContent = `${t("F3D.HUD.Brush")}: ${state.brush}×${state.brush}`;
    });
    brushBtn.dataset.key = "brush";
    const undoBtn = button("fa-solid fa-rotate-left", t("F3D.HUD.Undo"), undo);
    undoBtn.dataset.key = "undo";
    undoBtn.disabled = true;
    paintGroup.append(
      paintBtn,
      stepLabel,
      brushBtn,
      undoBtn,
      button("fa-solid fa-dungeon", t("F3D.HUD.AutoOutside"), () => auto("outside")),
      button("fa-solid fa-house", t("F3D.HUD.AutoRooms"), () => auto("rooms")),
      button("fa-solid fa-eraser", t("F3D.HUD.Clear"), async () => {
        if (o.confirm && !(await o.confirm(t("F3D.HUD.ClearConfirm")))) return;
        apply(createHeightMap(view.grid.cols, view.grid.rows));
      }),
    );
    const hint = el("div", "f3d-hint");
    hint.textContent = t("F3D.HUD.PaintHint");
    paintGroup.appendChild(hint);
    bar.appendChild(paintGroup);

    // Click (not drag) on a cell paints. Left = raise, right or Shift = lower.
    const canvas = view.renderer.domElement;
    let down = null;
    canvas.addEventListener("pointerdown", (ev) => {
      down = { x: ev.clientX, y: ev.clientY, button: ev.button };
    });
    canvas.addEventListener("pointerup", (ev) => {
      if (!state.painting || !down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      const btn = down.button;
      down = null;
      if (moved > 4 || (btn !== 0 && btn !== 2)) return;
      const cell = view.pickCell(ev.clientX, ev.clientY);
      if (!cell) return;
      const delta = btn === 2 || ev.shiftKey ? -o.step : o.step;
      apply(bumpBrush(view.getHeights(), cell.col, cell.row, state.brush, delta, { min: 0 }));
      view.highlightCell(cell);
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!state.painting || ev.buttons) return;
      view.highlightCell(view.pickCell(ev.clientX, ev.clientY));
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
    onKey = (ev) => {
      if (state.painting && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
        ev.preventDefault();
        ev.stopPropagation();
        undo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    state.undo = undo;
  }

  if (o.onClose) {
    const closeGroup = el("div", "f3d-group");
    closeGroup.appendChild(button("fa-solid fa-xmark", t("F3D.HUD.Close"), () => o.onClose(), "f3d-close"));
    bar.appendChild(closeGroup);
  }

  return {
    element: bar,
    state,
    history,
    /** Find a toolbar button by its data-key. */
    button: (key) => bar.querySelector(`[data-key="${key}"]`),
    destroy: () => {
      if (onKey) window.removeEventListener("keydown", onKey, true);
      bar.remove();
    },
  };
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
