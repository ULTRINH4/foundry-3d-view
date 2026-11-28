/**
 * Pointer + keyboard interaction in the 3D view (when not painting heights).
 *
 * Selecting and moving are separate:
 *  - click a token you can control: select it (nothing else happens)
 *  - **move mode**: click the selected token again, press M, or use the toolbar's Move button.
 *    The reachable squares turn blue and the ones it can attack red; a grid cursor follows the
 *    mouse, or the arrow keys / WASD (relative to the camera, which follows it); a yellow arrow
 *    shows the path. Click or Enter on a blue square: the token walks there and move mode ends.
 *    Esc, right-click or M leave move mode.
 *  - outside move mode a click on the floor does nothing (no accidental moves)
 *  - click a door: open/close it; Q/E: rotate the camera
 *  - right-click on one of your tokens: Foundry's Token HUD; right-click elsewhere: release
 * Dragging still moves the camera. The adapter (Foundry or the dev page) decides what each action
 * really does.
 */
import { pathTo, cursorStep, tokenAnchorCell } from "../core/movement.mjs";

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
 * @param {(id:string, cell:{col:number,row:number}, path:object[]|null, cost:number)=>void} o.onMoveToken
 * @param {(wallId:string)=>void} o.onToggleDoor
 * @param {(from:object, to:object, tokenId:string)=>string} o.measure   distance label
 * @param {(id:string)=>({reach:Map, attack:Set}|null)} [o.computeRange]  movement range of a token
 * @param {(id:string)=>boolean} [o.canMoveAnywhere]    GM: may move outside the blue squares
 * @param {()=>void} [o.onBlocked]                      a move outside the range was refused
 * @param {(id:string)=>void} [o.onTokenContext]        right-click on a token
 * @param {(on:boolean)=>void} [o.onMoveModeChange]     move mode turned on/off (toolbar button)
 */
export function createInteraction(view, o) {
  const canvas = view.renderer.domElement;
  let down = null;
  let hovering = false;
  let range = null; // { id, reach, attack }
  let cursor = null;
  let moveMode = null; // id of the token in move mode

  const g = () => view.grid;
  const tokenCell = (id) => {
    const t = view.tokens.get(id)?.data;
    if (!t || !g()) return null;
    return tokenAnchorCell(g(), t);
  };
  const selectedId = () => o.getControlled()[0] ?? null;
  const moving = () => (moveMode && moveMode === selectedId() ? moveMode : null);

  const hideCursor = () => {
    cursor = null;
    view.setCursor(null);
    view.showPath(null);
    view.showRuler(null);
  };

  /** Recompute the blue/red squares (only in move mode). */
  const refreshRange = () => {
    if (moveMode && moveMode !== selectedId()) setMoveMode(null, { silent: false });
    const id = moving();
    const r = id && o.computeRange ? o.computeRange(id) : null;
    if (!r) {
      range = null;
      view.clearMoveRange();
      if (id) updatePath();
      return;
    }
    range = { id, ...r };
    view.showMoveRange(r.reach.keys(), r.attack);
    updatePath();
  };

  function setMoveMode(id, { silent = false } = {}) {
    const next = id && o.canControl(id) ? id : null;
    const changed = next !== moveMode;
    moveMode = next;
    if (!moveMode) {
      range = null;
      view.clearMoveRange();
      hideCursor();
    } else {
      const c = tokenCell(moveMode);
      if (c) setCursor(c);
    }
    if (changed && !silent) o.onMoveModeChange?.(!!moveMode);
    if (moveMode) refreshRange();
  }

  /** Arrow + distance label from the token in move mode to the cursor. */
  const updatePath = () => {
    const id = moving();
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

  function setCursor(cell, { follow = false } = {}) {
    if (!cell) return;
    cursor = cell;
    view.setCursor(cell);
    if (follow) {
      const gg = g();
      view.panToCanvasPoint(gg.sceneX + (cell.col + 0.5) * gg.size, gg.sceneY + (cell.row + 0.5) * gg.size);
    }
    updatePath();
  }

  const clearAll = () => {
    view.showRuler(null);
    view.showPath(null);
    view.highlightCell(null);
  };

  /** Confirm on a square: move the token there along the arrow, then leave move mode. */
  const confirmAt = (cell) => {
    const id = moving();
    if (!id) return false;
    const from = tokenCell(id);
    if (from && from.col === cell.col && from.row === cell.row) return false;
    const path = range?.id === id ? pathTo(g(), range.reach, cell) : null;
    const cost = path ? range.reach.get(cell.row * g().cols + cell.col)?.cost ?? 0 : 0;
    if (path && path.length > 1) {
      o.onMoveToken(id, cell, path, cost);
    } else if (!path && (o.canMoveAnywhere?.(id) || !o.computeRange || !range)) {
      o.onMoveToken(id, cell, null, 0);
    } else if (!path) {
      o.onBlocked?.();
      return false;
    }
    setMoveMode(null);
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
      // In move mode right-click just leaves it. Otherwise: Token HUD on your token, else release.
      if (moving()) return setMoveMode(null);
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
      if (!o.canControl(hit.id)) {
        // An enemy standing on a square in reach: treat it as a click on that square.
        if (moving()) {
          const c = tokenCell(hit.id);
          if (c) confirmAt(c);
        }
        return;
      }
      if (!ev.shiftKey && hit.id === selectedId()) {
        // Second click on the selected token toggles move mode.
        setMoveMode(moving() ? null : hit.id);
        return;
      }
      setMoveMode(null);
      o.onSelectToken(hit.id, ev.shiftKey);
      return;
    }
    if (hit.type === "door") {
      o.onToggleDoor(hit.id);
      return;
    }
    if (hit.type === "cell" && moving()) {
      setCursor({ col: hit.col, row: hit.row });
      confirmAt({ col: hit.col, row: hit.row });
    }
  };

  const onMove = (ev) => {
    if (ev.buttons || o.isBusy() || !moving()) return;
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
      return;
    }
    if (ev.code === "KeyM") {
      const id = selectedId();
      if (!id) return;
      take();
      setMoveMode(moving() ? null : id);
      return;
    }
    if (!moving()) return; // arrows, Enter and Esc outside move mode stay Foundry's
    const dir = KEYS[ev.code];
    if (dir) {
      take();
      const start = cursor ?? tokenCell(moveMode) ?? { col: Math.floor(g().cols / 2), row: Math.floor(g().rows / 2) };
      const { dc, dr } = cursorStep(dir, view.cameraYaw());
      const next = { col: Math.min(g().cols - 1, Math.max(0, start.col + dc)), row: Math.min(g().rows - 1, Math.max(0, start.row + dr)) };
      setCursor(next, { follow: true });
      return;
    }
    if (ev.code === "Enter" || ev.code === "Space" || ev.code === "NumpadEnter") {
      if (!cursor) return;
      take();
      confirmAt(cursor);
      return;
    }
    if (ev.code === "Escape") {
      take();
      setMoveMode(null);
    }
  };

  const onEnter = () => (hovering = true);
  const onLeave = () => {
    hovering = false;
    if (!moving()) hideCursor();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey, true);

  return {
    /** Selection changed or the token moved: recompute the range (leaves move mode if the selection changed). */
    refresh: () => refreshRange(),
    clear: clearAll,
    /** Turn move mode on for a token (or off with null). */
    setMoveMode: (id) => setMoveMode(id),
    /** Toolbar button: toggle move mode for the selected token. */
    toggleMoveMode: () => setMoveMode(moving() ? null : selectedId()),
    get moveMode() {
      return moving();
    },
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
