/**
 * Reads Foundry's own rendered lighting and vision so the 3D view matches the 2D canvas exactly:
 * animated and coloured lights, darkness, global light, darkness regions, vision modes and the
 * vision of the selected token.
 *
 *  - illumination: Foundry composites `canvas.effects.illumination` over the scene with MULTIPLY,
 *    so rendering it over white gives the light factor per pixel;
 *  - coloration:   `canvas.effects.coloration` is the coloured light added on top;
 *  - vision:       `canvas.masks.vision.renderTexture` (red channel) is what the user can see.
 *
 * All three are screen-space, so while the 3D view covers the screen the 2D view is framed on the
 * whole scene; each sample downsizes them to a small grid (k samples per square) and reads it back.
 */
export class FoundryLightSampler {
  constructor() {
    this.k = 2;
    this.cols = 0;
    this.rows = 0;
    this._screenRT = null;
    this._colorRT = null;
    this._small = null;
    this._savedView = null;
  }

  /** Is the API we need available on this Foundry version? */
  static supported() {
    return !!(canvas?.app?.renderer?.extract && canvas.effects?.illumination && canvas.masks?.vision?.renderTexture && globalThis.PIXI?.RenderTexture);
  }

  /** Frame the (hidden) 2D view on the whole scene so every square is on screen. */
  frameScene() {
    const d = canvas.dimensions;
    const R = canvas.app.renderer;
    if (!this._savedView) this._savedView = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x };
    const scale = Math.min(R.screen.width / d.sceneWidth, R.screen.height / d.sceneHeight) * 0.98;
    canvas.pan({ x: d.sceneX + d.sceneWidth / 2, y: d.sceneY + d.sceneHeight / 2, scale });
  }

  /** Put the 2D view back where the user had it. */
  restoreView() {
    if (this._savedView) canvas.pan(this._savedView);
    this._savedView = null;
  }

  /** True when the whole scene rectangle is inside the screen (needed for a full sample). */
  sceneOnScreen() {
    const d = canvas.dimensions;
    const R = canvas.app.renderer;
    const wt = canvas.stage.worldTransform;
    const a = wt.apply({ x: d.sceneX, y: d.sceneY });
    const b = wt.apply({ x: d.sceneX + d.sceneWidth, y: d.sceneY + d.sceneHeight });
    return a.x >= -2 && a.y >= -2 && b.x <= R.screen.width + 2 && b.y <= R.screen.height + 2;
  }

  _rt(name, w, h, res) {
    const cur = this[name];
    if (cur && cur.width === w && cur.height === h && cur.resolution === res) return cur;
    cur?.destroy(true);
    this[name] = PIXI.RenderTexture.create({ width: w, height: h, resolution: res });
    return this[name];
  }

  /** Downsize a screen-space texture onto the scene grid and read it back (RGBA bytes). */
  _sampleTexture(tex, w, h) {
    const R = canvas.app.renderer;
    const d = canvas.dimensions;
    const wt = canvas.stage.worldTransform;
    const s0 = wt.apply({ x: d.sceneX, y: d.sceneY });
    const s1 = wt.apply({ x: d.sceneX + d.sceneWidth, y: d.sceneY + d.sceneHeight });
    const small = this._rt("_small", w, h, 1);
    const spr = new PIXI.Sprite(tex);
    const fx = w / (s1.x - s0.x), fy = h / (s1.y - s0.y);
    spr.scale.set(fx, fy);
    spr.position.set(-s0.x * fx, -s0.y * fy);
    R.render(spr, { renderTexture: small, clear: true });
    spr.destroy();
    return R.extract.pixels(small);
  }

  /**
   * Sample everything for a grid of `cols × rows` squares.
   * @returns {{w:number,h:number,k:number,illum:Uint8Array,color:Uint8Array,vision:Uint8Array}|null}
   */
  sample(cols, rows) {
    if (!FoundryLightSampler.supported()) return null;
    const R = canvas.app.renderer;
    // Up to 4 samples per square, at most ~256 samples per side.
    this.k = Math.max(1, Math.min(4, Math.floor(256 / Math.max(cols, rows))));
    const w = cols * this.k, h = rows * this.k;
    const sw = R.screen.width, sh = R.screen.height, res = R.resolution;
    const white = new PIXI.Sprite(PIXI.Texture.WHITE);
    white.width = sw;
    white.height = sh;
    const ill = this._rt("_screenRT", sw, sh, res);
    R.render(white, { renderTexture: ill, clear: true });
    R.render(canvas.effects.illumination, { renderTexture: ill, clear: false, skipUpdateTransform: true });
    white.destroy();
    const col = this._rt("_colorRT", sw, sh, res);
    R.render(canvas.effects.coloration, { renderTexture: col, clear: true, skipUpdateTransform: true });
    const illum = this._sampleTexture(ill, w, h);
    const color = this._sampleTexture(col, w, h);
    const visionPx = this._sampleTexture(canvas.masks.vision.renderTexture, w, h);
    const vision = new Uint8Array(w * h);
    for (let i = 0; i < vision.length; i++) vision[i] = visionPx[i * 4] > 127 ? 1 : 0;
    return { w, h, k: this.k, illum, color, vision };
  }

  /** Squares visible in a sample (a square counts if any of its k×k samples is visible). */
  static visibleCells(s, cols, rows) {
    const out = new Uint8Array(cols * rows);
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (s.vision[y * s.w + x]) out[Math.floor(y / s.k) * cols + Math.floor(x / s.k)] = 1;
      }
    }
    return out;
  }

  destroy() {
    for (const n of ["_screenRT", "_colorRT", "_small"]) this[n]?.destroy(true);
    this._screenRT = this._colorRT = this._small = null;
  }
}
