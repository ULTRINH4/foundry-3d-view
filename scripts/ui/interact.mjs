/**
 * Pointer + keyboard interaction in the 3D view, Fire Emblem style (when not painting heights):
 *  - click a token you can control (or Enter with the cursor on it): select it; its reachable
 *    squares turn blue and the squares it can attack red
 *  - move the mouse, or the arrow keys / WASD (relative to the camera): a grid cursor moves and a
 *    yellow arrow shows the path; with the keyboard the camera follows the cursor
 *  - click or Enter on a blue square: the token walks there along the arrow
 *  - click a door: open/close it; Q/E: rotate the camera
 *  - right-click on one of your tokens: Foundry's Token HUD; right-click elsewhere or Esc: cancel
 * Dragging still moves the camera. The adapter (Foundry or the dev page) decides what each action
 * really does.
 */
import { canvasToCell } from "../core/coords.mjs";
import { pathTo, cursorStep } from "../core/movement.mjs";

const KEYS = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};

/**
 * @param {import("../render/view3d.mjs").View3D} view
 * @param {object} o
 * @param {()=>boolean} o.isBusy                         true while another tool owns the pointer (painting)
 * @param {()=>string[]} o.getControlled                 ids of selected tokens
 * @param {(id:string)=>boolean} o.canControl
 * @param {(id:string, additive:boolean)=>void} o.onSelectToken
 * @param {()=>void} o.onReleaseAll
 * @param {(id:string, cell:{col:number,row:number}, path:object[]|null)=>void} o.onMoveToken
 * @param {(wallId:string)=>void} o.onToggleDoor
 * @param {(from:object, to:object, tokenId:string)=>string} o.measure   distance label
 * @param {(id:string)=>({reach:Map, attack:Set}|null)} [o.computeRange]  movement range of a token
 * @param {(id:string)=>boolean} [o.canMoveAnywhere]    GM: may move outside the blue squares
 * @param {()=>void} [o.onBlocked]                      a move outside the range was refused
 * @param {(id:string)=>void} [o.onTokenContext]        right-click on a token
 */
export function createInteraction(view, o) {
  const canvas = view.renderer.domElement;
  let down = null;
  let hovering = false;
  let range = null; // { id, reach, attack }
  let cursor = null;

  const g = () => view.grid;
  const tokenCell = (id) => {
    const t = view.tokens.get(id)?.data;
    if (!t || !g()) return null;
    return canvasToCell(g(), t.x + g().size / 2, t.y + g().size / 2);
  };
  const selectedId = () => o.getControlled()[0] ?? null;

  /** Recompute the blue/red squares for the selected token. */
  const refreshRange = () => {
    const id = selectedId();
    if (!id || !o.computeRange) {
      range = null;
      view.clearMoveRange();
      return;
    }
    const r = o.computeRange(id);
    if (!r) {
      range = null;
      view.clearMoveRange();
      return;
    }
    range = { id, ...r };
    view.showMoveRange(r.reach.keys(), r.attack);
    updatePath();
  };

  /** Arrow + distance label from the selected token to the cursor. */
  const updatePath = () => {
    const id = selectedId();
    if (!id || !cursor) {
      view.showPath(null);
      view.showRuler(null);
      return;
    }
    const from = tokenCell(id);
    const path = range?.id === id ? pathTo(g(), range.reach, cursor) : null;
    view.showPath(path);
    if (from && (cursor.col !== from.col || cursor.row !== from.row)) {
      view.showRuler([from, cursor], o.measure(from, cursor, id), { line: false });
    } else view.showRuler(null);
  };

  const setCursor = (cell, { follow = false } = {}) => {
    if (!cell) return;
    cursor = cell;
    view.setCursor(cell);
    if (follow) {
      const gg = g();
      view.panToCanvasPoint(gg.sceneX + (cell.col + 0.5) * gg.size, gg.sceneY + (cell.row + 0.5) * gg.size);
    }
    updatePath();
  };

  const clearAll = () => {
    view.showRuler(null);
    view.showPath(null);
    view.highlightCell(null);
  };

  /** Confirm on a square: move the selected token there along the arrow. */
  const confirmAt = (cell) => {
    const id = selectedId();
    if (!id) return false;
    const path = range?.id === id ? pathTo(g(), range.reach, cell) : null;
    if (path && path.length > 1) {
      o.onMoveToken(id, cell, path);
    } else if (!path && (o.canMoveAnywhere?.(id) || !o.computeRange)) {
      o.onMoveToken(id, cell, null);
    } else if (!path) {
      o.onBlocked?.();
      return false;
    }
    view.showPath(null);
    view.showRuler(null);
    return true;
  };

  /** Token under a cell (one of the view's standees), if any. */
  const tokenAt = (cell) => {
    for (const [id, t] of view.tokens) {
      if (!t.group.visible) continue;
      const c = tokenCell(id);
      if (c && c.col === cell.col && c.row === cell.row) return id;
    }
    return null;
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
      // Right-click on one of your tokens opens Foundry's Token HUD; elsewhere it cancels.
      const hit = view.pick(ev.clientX, ev.clientY);
      if (hit?.type === "token" && o.onTokenContext && o.canControl(hit.id)) {
        o.onTokenContext(hit.id);
        return;
      }
      o.onReleaseAll();
      clearAll();
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
    if (hit.type === "cell") {
      setCursor({ col: hit.col, row: hit.row });
      confirmAt({ col: hit.col, row: hit.row });
    }
  };

  const onMove = (ev) => {
    if (ev.buttons || o.isBusy()) return;
    const cell = view.pickCell(ev.clientX, ev.clientY);
    if (!cell) return;
    if (cursor && cell.col === cursor.col && cell.row === cursor.row) return;
    setCursor(cell);
  };

  const onKey = (ev) => {
    if (!hovering || o.isBusy()) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || document.activeElement?.isContentEditable;
    if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const take = () => {
      ev.preventDefault();
      ev.stopImmediatePropagation(); // keep Foundry from also panning/moving the 2D token
    };
    if (ev.code === "KeyQ" || ev.code === "KeyE") {
      take();
      const step = view.cameraMode === "tactics" ? 90 : 45;
      view.rotateBy(ev.code === "KeyQ" ? -step : step);
      // Keep the cursor's on-screen directions consistent after the turn.
      return;
    }
    const dir = KEYS[ev.code];
    if (dir) {
      take();
      const start = cursor ?? tokenCell(selectedId()) ?? { col: Math.floor(g().cols / 2), row: Math.floor(g().rows / 2) };
      const { dc, dr } = cursorStep(dir, view.cameraYaw());
      const next = { col: Math.min(g().cols - 1, Math.max(0, start.col + dc)), row: Math.min(g().rows - 1, Math.max(0, start.row + dr)) };
      setCursor(next, { follow: true });
      return;
    }
    if (ev.code === "Enter" || ev.code === "Space" || ev.code === "NumpadEnter") {
      if (!cursor) return;
      take();
      const tok = tokenAt(cursor);
      if (tok && tok !== selectedId() && o.canControl(tok)) o.onSelectToken(tok, false);
      else confirmAt(cursor);
      return;
    }
    if (ev.code === "Escape" && selectedId()) {
      take();
      o.onReleaseAll();
      clearAll();
    }
  };

  const onEnter = () => (hovering = true);
  const onLeave = () => {
    hovering = false;
    view.setCursor(null);
    cursor = null;
    view.showPath(null);
    view.showRuler(null);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey, true);

  return {
    /** Selection changed or the selected token moved: recompute the range. */
    refresh: () => refreshRange(),
    clear: clearAll,
    get cursor() {
      return cursor;
    },
    get range() {
      return range;
    },
    /** For tests: act as if the pointer were over the view. */
    setHovering: (on) => (hovering = !!on),
    destroy() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey, true);
      view.clearMoveRange();
      view.setCursor(null);
    },
  };
}
