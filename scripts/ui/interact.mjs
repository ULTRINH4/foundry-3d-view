/**
 * Pointer interaction in the 3D view (when not painting heights):
 *  - click a token you can control: select it (Shift adds to the selection)
 *  - click a door: open/close it
 *  - click a square with a token selected: move the token there
 *  - hover with a token selected: ruler from the token to the square
 *  - right-click or Escape: release the selection
 * Dragging still orbits/pans the camera. The adapter decides what each action really does.
 */
import { canvasToCell } from "../core/coords.mjs";
import { lineCells } from "../core/scene-extras.mjs";

/**
 * @param {import("../render/view3d.mjs").View3D} view
 * @param {object} o
 * @param {()=>boolean} o.isBusy                         true while another tool owns the pointer (painting)
 * @param {()=>string[]} o.getControlled                 ids of selected tokens
 * @param {(id:string)=>boolean} o.canControl
 * @param {(id:string, additive:boolean)=>void} o.onSelectToken
 * @param {()=>void} o.onReleaseAll
 * @param {(id:string, cell:{col:number,row:number})=>void} o.onMoveToken
 * @param {(wallId:string)=>void} o.onToggleDoor
 * @param {(from:object, to:object, tokenId:string)=>string} o.measure   ruler label
 */
export function createInteraction(view, o) {
  const canvas = view.renderer.domElement;
  let down = null;
  let lastHover = "";

  const tokenCell = (id) => {
    const t = view.tokens.get(id)?.data;
    if (!t) return null;
    const g = view.grid;
    return canvasToCell(g, t.x + g.size / 2, t.y + g.size / 2);
  };

  const clearHover = () => {
    view.showRuler(null);
    view.highlightCell(null);
    lastHover = "";
  };

  const onDown = (ev) => {
    down = { x: ev.clientX, y: ev.clientY, button: ev.button };
  };

  const onUp = (ev) => {
    if (!down || o.isBusy()) return (down = null);
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
    const btn = down.button;
    down = null;
    if (moved > 4) return;
    if (btn === 2) {
      o.onReleaseAll();
      clearHover();
      return;
    }
    if (btn !== 0) return;
    const hit = view.pick(ev.clientX, ev.clientY);
    if (!hit) return;
    if (hit.type === "token") {
      if (o.canControl(hit.id)) o.onSelectToken(hit.id, ev.shiftKey);
      return;
    }
    if (hit.type === "door") {
      o.onToggleDoor(hit.id);
      return;
    }
    const selected = o.getControlled();
    if (hit.type === "cell" && selected.length) {
      o.onMoveToken(selected[0], { col: hit.col, row: hit.row });
      clearHover();
    }
  };

  const onMove = (ev) => {
    if (ev.buttons || o.isBusy()) return;
    const selected = o.getControlled();
    if (!selected.length) {
      if (lastHover) clearHover();
      return;
    }
    const cell = view.pickCell(ev.clientX, ev.clientY);
    const from = tokenCell(selected[0]);
    if (!cell || !from) return clearHover();
    const key = `${from.col},${from.row}>${cell.col},${cell.row}`;
    if (key === lastHover) return;
    lastHover = key;
    view.highlightCell(cell);
    view.showRuler(lineCells(from, cell), o.measure(from, cell, selected[0]));
  };

  let hovering = false;
  canvas.addEventListener("pointerenter", () => (hovering = true));
  canvas.addEventListener("pointerleave", () => (hovering = false));
  const onKey = (ev) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || document.activeElement?.isContentEditable;
    if (hovering && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === "q" || ev.key === "e" || ev.key === "Q" || ev.key === "E")) {
      ev.preventDefault();
      ev.stopPropagation();
      const step = view.cameraMode === "tactics" ? 90 : 45;
      view.rotateBy(ev.key.toLowerCase() === "q" ? -step : step);
      return;
    }
    if (ev.key === "Escape" && o.getControlled().length) {
      o.onReleaseAll();
      clearHover();
    }
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", clearHover);
  window.addEventListener("keydown", onKey, true);

  return {
    refresh: () => {
      lastHover = "";
    },
    clear: clearHover,
    destroy() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", clearHover);
      window.removeEventListener("keydown", onKey, true);
    },
  };
}
