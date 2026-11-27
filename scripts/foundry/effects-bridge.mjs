/**
 * Mirrors canvas animations into the 3D view. Sequencer (used by Automated Animations and many
 * other modules) fires createSequencerEffect / endedSequencerEffect with its PIXI effect object;
 * every frame we read where that effect is drawn on the 2D canvas (position, size, rotation,
 * opacity, sprite-sheet frame) and show the same video/image as a plane above the 3D terrain.
 * The 2D effect keeps playing under the overlay, so timing and sound stay Foundry's/Sequencer's.
 */

const MAX_DEPTH = 8;

/**
 * Deepest descendant with a drawable texture source (video, image or canvas). The deepest one is
 * what actually renders: Sequencer wraps its TilingSpriteMesh in a manager whose scale only
 * forwards to the child, so the wrapper's own transform lacks the size.
 */
export function findTexturedChild(obj, depth = 0) {
  if (!obj || depth > MAX_DEPTH) return null;
  for (const c of obj.children ?? []) {
    const hit = findTexturedChild(c, depth + 1);
    if (hit) return hit;
  }
  const src = obj.texture?.baseTexture?.resource?.source;
  if (src && (src.tagName || src instanceof HTMLCanvasElement) && obj.texture.valid !== false) return obj;
  return null;
}

/**
 * Canvas-space placement of a sprite-like display object.
 * @returns {{x:number,y:number,width:number,height:number,rotation:number}}
 */
export function spritePlacement(obj, stageWorldTransform) {
  const inv = stageWorldTransform.clone().invert();
  const wt = obj.worldTransform;
  const tex = obj.texture;
  const fw = tex.orig?.width ?? tex.width ?? 1;
  const fh = tex.orig?.height ?? tex.height ?? 1;
  const ax = obj.anchor?.x ?? 0, ay = obj.anchor?.y ?? 0;
  const P = globalThis.PIXI?.Point ?? class { constructor(x, y) { this.x = x; this.y = y; } };
  const loc = (lx, ly) => inv.apply(wt.apply(new P(lx, ly)));
  const c = loc((0.5 - ax) * fw, (0.5 - ay) * fh);
  const r = loc((1 - ax) * fw, (0.5 - ay) * fh);
  const b = loc((0.5 - ax) * fw, (1 - ay) * fh);
  return {
    x: c.x,
    y: c.y,
    width: 2 * Math.hypot(r.x - c.x, r.y - c.y),
    height: 2 * Math.hypot(b.x - c.x, b.y - c.y),
    rotation: Math.atan2(r.y - c.y, r.x - c.x),
  };
}

export class EffectsBridge {
  constructor() {
    this.view = null;
    this.tracked = new Map(); // id -> { effect, shown }
    this._hooks = [];
  }

  start(view) {
    this.stop();
    this.view = view;
    const on = (name, fn) => this._hooks.push([name, Hooks.on(name, fn)]);
    on("createSequencerEffect", (effect) => this.track(effect));
    on("endedSequencerEffect", (effect) => this.untrack(effect));
    // Effects already running (persistent effects) when the view opens.
    try {
      for (const effect of globalThis.Sequencer?.EffectManager?.effects ?? []) this.track(effect);
    } catch {
      /* Sequencer API differences: ignore */
    }
    view.onFrame = () => this.sync();
  }

  stop() {
    for (const [name, id] of this._hooks) Hooks.off(name, id);
    this._hooks = [];
    for (const id of this.tracked.keys()) this.view?.removeEffect(id);
    this.tracked.clear();
    if (this.view) this.view.onFrame = null;
    this.view = null;
  }

  _id(effect) {
    return String(effect?.id ?? effect?.data?.id ?? (effect.__f3dId ??= foundry.utils.randomID()));
  }

  track(effect) {
    if (!effect || !this.view) return;
    this.tracked.set(this._id(effect), { effect, shown: false, source: null });
  }

  untrack(effect) {
    const id = this._id(effect);
    this.tracked.delete(id);
    this.view?.removeEffect(id);
  }

  sync() {
    if (!this.view || !canvas?.stage) return;
    for (const [id, t] of this.tracked) {
      const effect = t.effect;
      if (effect.destroyed || effect._destroyed) {
        this.untrack(effect);
        continue;
      }
      const obj = findTexturedChild(effect);
      if (!obj) continue;
      const source = obj.texture.baseTexture.resource.source;
      if (!t.shown || t.source !== source) {
        this.view.addEffect(id, source);
        t.shown = true;
        t.source = source;
      }
      const place = spritePlacement(obj, canvas.stage.worldTransform);
      const bt = obj.texture.baseTexture;
      const fr = obj.texture.frame;
      const full = !fr || (fr.x === 0 && fr.y === 0 && fr.width >= bt.width - 0.5 && fr.height >= bt.height - 0.5);
      this.view.updateEffect(id, {
        ...place,
        alpha: obj.worldAlpha ?? 1,
        visible: obj.worldVisible !== false && effect.visible !== false,
        frame: full ? null : { x: fr.x / bt.width, y: fr.y / bt.height, w: fr.width / bt.width, h: fr.height / bt.height },
        elevation: Number(effect.elevation ?? effect.data?.elevation?.elevation ?? 0) || 0,
      });
    }
  }
}
