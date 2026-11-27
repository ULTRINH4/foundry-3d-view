/**
 * Scene (Foundry canvas pixels) <-> world (three.js) coordinate conversion.
 *
 * Conventions
 *  - Foundry canvas: x to the right, y downward, in pixels. Includes scene padding.
 *  - World: 1 unit = 1 grid square. x to the right, z "downward" on the map (toward the viewer
 *    in the default camera), y is up. The world origin is the centre of the scene rectangle
 *    (the area without padding), so the camera orbits around the map's middle by default.
 *  - Vertical values coming from Foundry (token elevation, painted heights) are expressed in the
 *    scene's grid distance units (e.g. feet). One `grid.distance` == one world unit vertically,
 *    so a 5 ft step on a 5 ft grid is a perfect cube.
 */

/**
 * Build a normalized grid description from Foundry canvas dimensions.
 * @param {object} d
 * @param {number} d.size          grid size in pixels
 * @param {number} d.sceneX        left of the scene rect (after padding) in canvas px
 * @param {number} d.sceneY        top of the scene rect in canvas px
 * @param {number} d.sceneWidth
 * @param {number} d.sceneHeight
 * @param {number} [d.width]       full canvas width incl. padding
 * @param {number} [d.height]      full canvas height incl. padding
 * @param {number} [d.distance=5]  grid distance (units per square)
 */
export function makeGrid(d) {
  const size = Number(d.size);
  if (!(size > 0)) throw new Error("grid size must be > 0");
  const sceneX = Number(d.sceneX ?? 0);
  const sceneY = Number(d.sceneY ?? 0);
  const sceneWidth = Number(d.sceneWidth);
  const sceneHeight = Number(d.sceneHeight);
  return Object.freeze({
    size,
    sceneX,
    sceneY,
    sceneWidth,
    sceneHeight,
    width: Number(d.width ?? sceneWidth + 2 * sceneX),
    height: Number(d.height ?? sceneHeight + 2 * sceneY),
    distance: Number(d.distance) > 0 ? Number(d.distance) : 5,
    cols: Math.ceil(sceneWidth / size),
    rows: Math.ceil(sceneHeight / size),
    centerX: sceneX + sceneWidth / 2,
    centerY: sceneY + sceneHeight / 2,
  });
}

/** Canvas pixel -> world {x, z}. */
export function canvasToWorld(grid, px, py) {
  return { x: (px - grid.centerX) / grid.size, z: (py - grid.centerY) / grid.size };
}

/** World {x, z} -> canvas pixel {x, y}. */
export function worldToCanvas(grid, wx, wz) {
  return { x: wx * grid.size + grid.centerX, y: wz * grid.size + grid.centerY };
}

/** Grid distance units (elevation, heights) -> world Y. */
export function unitsToWorldY(grid, units) {
  return (Number(units) || 0) / grid.distance;
}

/** World Y -> grid distance units. */
export function worldYToUnits(grid, y) {
  return y * grid.distance;
}

/**
 * Cell under a canvas point, relative to the scene rect (col 0,row 0 = top-left square of the
 * map image). Returns null outside the scene rect.
 */
export function canvasToCell(grid, px, py) {
  const col = Math.floor((px - grid.sceneX) / grid.size);
  const row = Math.floor((py - grid.sceneY) / grid.size);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  return { col, row };
}

/** World point -> cell (or null). */
export function worldToCell(grid, wx, wz) {
  const p = worldToCanvas(grid, wx, wz);
  return canvasToCell(grid, p.x, p.y);
}

/** Canvas-pixel rectangle covered by a cell. */
export function cellRect(grid, col, row) {
  return {
    x: grid.sceneX + col * grid.size,
    y: grid.sceneY + row * grid.size,
    width: grid.size,
    height: grid.size,
  };
}

/** Canvas-pixel centre of a cell. */
export function cellCenter(grid, col, row) {
  return {
    x: grid.sceneX + (col + 0.5) * grid.size,
    y: grid.sceneY + (row + 0.5) * grid.size,
  };
}

/**
 * Centre of a token in canvas px. Foundry stores token x/y as the top-left corner in px and
 * width/height in grid squares.
 */
export function tokenCenter(grid, token) {
  const w = Number(token.width ?? 1) * grid.size;
  const h = Number(token.height ?? 1) * grid.size;
  return { x: Number(token.x) + w / 2, y: Number(token.y) + h / 2 };
}
