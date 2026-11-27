/**
 * Token sprites: facing math and directional / animated sprite sheets (Doom-style).
 *
 * Angles use the world's atan2(x, z) convention: 0 = toward +z (down the map / south), increasing
 * toward +x. Foundry token rotation is clockwise on screen with 0 = artwork as drawn, which we read
 * as "facing south"; so a token's facing yaw is -rotation.
 *
 * Sprite sheet layout: rows = view directions, columns = animation frames.
 *   4 directions: front, left, back, right
 *   8 directions: front, front-left, left, back-left, back, back-right, right, front-right
 * "front" is what you see when the token faces the camera; "left" is the token's left side.
 */

export const SPRITE_FACING = Object.freeze({
  CAMERA: "camera", // upright standee turned toward the camera (leans back only when seen from above)
  BILLBOARD: "billboard", // always parallel to the screen, like FFT / Doom sprites
  STANDEE: "standee", // fixed paper standee that follows the token's rotation
});

const TAU = Math.PI * 2;

/** Token facing yaw (radians) from Foundry rotation in degrees. */
export function tokenFacingYaw(rotationDeg) {
  return -((Number(rotationDeg) || 0) * Math.PI) / 180;
}

/** Normalize an angle to [0, 2π). */
export function normAngle(a) {
  return ((a % TAU) + TAU) % TAU;
}

/**
 * Which row of a directional sheet to show.
 * @param {number} directions  1, 4 or 8
 * @param {number} facingYaw   token facing (radians)
 * @param {number} viewYaw     direction from the token toward the camera (radians)
 */
export function directionRow(directions, facingYaw, viewYaw) {
  const d = Math.max(1, Math.floor(directions) || 1);
  if (d === 1) return 0;
  const rel = normAngle(viewYaw - facingYaw);
  return Math.round(rel / (TAU / d)) % d;
}

/** Animation column for a time in seconds. */
export function animationColumn(frames, fps, time) {
  const f = Math.max(1, Math.floor(frames) || 1);
  if (f === 1 || !(fps > 0)) return 0;
  return Math.floor(time * fps) % f;
}

/**
 * Texture repeat/offset for a sheet cell (three.js UVs: v = 0 at the bottom of the image).
 * @returns {{repeat:[number,number], offset:[number,number]}}
 */
export function sheetCellUV(frames, directions, col, row) {
  const f = Math.max(1, frames | 0), d = Math.max(1, directions | 0);
  return { repeat: [1 / f, 1 / d], offset: [col / f, 1 - (row + 1) / d] };
}

/** Normalize the sheet flag stored on a token (null when unused). */
export function sheetData(raw) {
  if (!raw || !raw.src) return null;
  const directions = [1, 4, 8].includes(Number(raw.directions)) ? Number(raw.directions) : 1;
  return {
    src: String(raw.src),
    directions,
    frames: Math.max(1, Math.floor(Number(raw.frames) || 1)),
    fps: Math.max(0, Number(raw.fps) || 0) || 8,
  };
}

/**
 * Tactics camera azimuth: the nearest diagonal (45° + k·90°), like Final Fantasy Tactics.
 * @param {number} yaw  current camera yaw (radians, atan2(x, z) of camera offset)
 */
export function snapTacticsYaw(yaw) {
  const q = Math.PI / 2;
  return Math.round((yaw - Math.PI / 4) / q) * q + Math.PI / 4;
}
