/**
 * Per-square light levels from light sources, for shading the 3D view like Foundry's lighting.
 * Pure: the Foundry adapter passes its real light sources (with their wall-clipped polygons as a
 * `contains` test); the dev page passes sources clipped with our own line of sight.
 *
 * Levels: 255 = bright light, 128 = dim light, 0 = unlit.
 */
import { cellCenter } from "./coords.mjs";

export const LIGHT = Object.freeze({ DARK: 0, DIM: 128, BRIGHT: 255 });

/**
 * @param {object} grid
 * @param {{x:number,y:number,bright:number,dim:number,contains?:(x:number,y:number)=>boolean}[]} sources
 *        positions and radii in canvas px
 * @param {{global?:boolean}} [o]  global illumination lights every square
 * @returns {Uint8Array} cols*rows levels
 */
export function lightLevels(grid, sources, { global = false } = {}) {
  const n = grid.cols * grid.rows;
  const out = new Uint8Array(n);
  if (global) return out.fill(LIGHT.BRIGHT);
  for (const s of sources) {
    const R = Math.max(s.bright || 0, s.dim || 0);
    if (!(R > 0)) continue;
    // Only the squares inside the light's bounding box.
    const c0 = Math.max(0, Math.floor((s.x - R - grid.sceneX) / grid.size));
    const c1 = Math.min(grid.cols - 1, Math.floor((s.x + R - grid.sceneX) / grid.size));
    const r0 = Math.max(0, Math.floor((s.y - R - grid.sceneY) / grid.size));
    const r1 = Math.min(grid.rows - 1, Math.floor((s.y + R - grid.sceneY) / grid.size));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * grid.cols + c;
        if (out[i] === LIGHT.BRIGHT) continue;
        const p = cellCenter(grid, c, r);
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        const level = s.bright > 0 && d <= s.bright ? LIGHT.BRIGHT : d <= R ? LIGHT.DIM : LIGHT.DARK;
        if (level <= out[i]) continue;
        if (s.contains && !s.contains(p.x, p.y)) continue;
        out[i] = level;
      }
    }
  }
  return out;
}

/** Unlit brightness for a darkness level (0 = day ... 1 = pitch black). */
export function unlitBrightness(darkness) {
  const d = Math.min(1, Math.max(0, Number(darkness) || 0));
  return 1 - 0.88 * d;
}
