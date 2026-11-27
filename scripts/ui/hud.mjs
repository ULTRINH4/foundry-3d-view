/**
 * Toolbar over the 3D view + the GM height painting tool. Plain DOM so it works both inside
 * Foundry and on the standalone dev page.
 */
import { bumpHeight, createHeightMap, autoHeightsFromWalls } from "../core/heights.mjs";

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
 * @param {()=>void} [o.onClose]
 * @param {(msg:string)=>Promise<boolean>} [o.confirm]
 */
export function createHud(root, o) {
  const { view, t } = o;
  const state = { painting: false, topDown: false };
  const bar = el("div", "f3d-hud");
  root.appendChild(bar);

  const button = (icon, label, onClick, cls = "") => {
    const b = el("button", `f3d-btn ${cls}`);
    b.type = "button";
    b.title = label;
    b.innerHTML = `<i class="${icon}"></i><span>${label}</span>`;
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      onClick(b);
    });
    return b;
  };

  const camGroup = el("div", "f3d-group");
  const topBtn = button("fa-solid fa-map", t("F3D.HUD.TopDown"), (b) => {
    state.topDown = !state.topDown;
    view.setTopDown(state.topDown);
    b.classList.toggle("active", state.topDown);
  });
  camGroup.append(
    topBtn,
    button("fa-solid fa-rotate-left", t("F3D.HUD.RotateLeft"), () => view.rotateBy(-45)),
    button("fa-solid fa-rotate-right", t("F3D.HUD.RotateRight"), () => view.rotateBy(45)),
    button("fa-solid fa-crosshairs", t("F3D.HUD.Recenter"), () => view.resetCamera(o.getFocus?.() ?? null)),
  );
  bar.appendChild(camGroup);

  let paintGroup = null;
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
    const apply = (map) => {
      view.setHeights(map);
      o.onHeightsChanged(view.getHeights());
    };
    const auto = (mode) => apply(autoHeightsFromWalls(o.getWalls(), view.grid, { mode, step: o.step }));
    paintGroup.append(
      paintBtn,
      stepLabel,
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
      apply(bumpHeight(view.getHeights(), cell.col, cell.row, delta, { min: 0 }));
      view.highlightCell(cell);
    });
    canvas.addEventListener("pointermove", (ev) => {
      if (!state.painting || ev.buttons) return;
      view.highlightCell(view.pickCell(ev.clientX, ev.clientY));
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  if (o.onClose) {
    const closeGroup = el("div", "f3d-group");
    closeGroup.appendChild(button("fa-solid fa-xmark", t("F3D.HUD.Close"), () => o.onClose(), "f3d-close"));
    bar.appendChild(closeGroup);
  }

  return {
    element: bar,
    state,
    destroy: () => bar.remove(),
  };
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
