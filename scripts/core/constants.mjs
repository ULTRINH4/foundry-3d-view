/** Module id. Keep in sync with module.json. */
export const MODULE_ID = "foundry-3d-view";

/** Mirrors of Foundry's CONST values we rely on, so pure code does not need the `CONST` global. */
export const WALL_SENSE = Object.freeze({ NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 });
export const WALL_DOOR = Object.freeze({ NONE: 0, DOOR: 1, SECRET: 2 });
export const DOOR_STATE = Object.freeze({ CLOSED: 0, OPEN: 1, LOCKED: 2 });
export const GRID_TYPE = Object.freeze({ GRIDLESS: 0, SQUARE: 1 });
