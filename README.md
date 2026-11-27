# Foundry 3D View

A Foundry VTT module that shows the current scene in 3D, tactics-RPG style. The map becomes terrain
you can raise square by square, walls are extruded, doors open and close live, and tokens stand
on the map as paper standees. Players see the scene through fog of war. You can select and move
tokens and open doors directly in 3D. The 2D scene stays as it is: the 3D view is an overlay you
toggle on and off.

- **Foundry:** v13 (primary), v14 (best effort, see below). Square or gridless scenes. Works with any system.
- **No build step:** plain ES modules. three.js r187 is vendored in `vendor/three/` (MIT, see `vendor/three/LICENSE`).
- **Original code:** written from scratch against Foundry's public API and three.js. It is not derived from any other 3D module.

![Orbit view of the sample scene](dev/screenshots/dev-page-orbit.png)

## Features

| Feature | Notes |
|---|---|
| Toggle the 3D view | **Token controls → cube button**, or the keybinding **Shift+V** (rebindable). There is also an API: `game.modules.get("foundry-3d-view").api.toggle()`. You can switch between full screen and a window (picture-in-picture). |
| Floor | The scene background is a textured ground at the correct scale: grid size, padding and background offset are all applied. |
| Heights per square | Stored in the scene flag `flags.foundry-3d-view.heights` as `{cols, rows, data[]}`, in grid distance units (the same units as token elevation). Tokens stand on `max(terrain under the token, elevation)`. |
| GM height tool | **Paint heights**: left-click raises a square, right-click or Shift+click lowers it. The **Brush** can be 1×1, 3×3 or 5×5. **Undo** (also Ctrl+Z) keeps 50 steps. **Auto: raise outside** / **Auto: raise rooms** make a rough first pass from the walls. **Flatten** resets everything to 0. |
| Walls | Each wall that blocks sight becomes a box. Invisible walls are skipped. Plain walls are drawn as one instanced mesh, so there is one draw call for all of them. If a wall has `wall-height` flags (from the Wall Height module), those set its top and bottom. |
| Doors | Each door is its own mesh, hinged at the first point of the wall. It swings open or closed with an animation on `updateWall`. To players, a closed secret door looks like a plain wall. |
| **Cutaway walls** | A toggle sinks the walls between the camera and the point it looks at, so you can see into rooms. Walls rise back smoothly when you turn the camera. |
| Tokens | Token art is shown as an upright card that always faces the camera. It sits on a base coloured by disposition. Cards follow Foundry's movement animation (`refreshToken`) and lie flat in top-down view. Selected tokens get a yellow ring. |
| **Interaction in 3D** | **Click** a token you own to select it (Shift adds to the selection). Then **click a square** to move it: for players, walls block the move and a paused game blocks it too. **Hover** to see a **ruler** with the distance and the height difference; it uses `canvas.grid.measurePath`, so the scene's diagonal rule applies. **Click a door** to open or close it; locked doors are refused for players. **Right-click** or **Esc** releases the selection. Dragging still moves the camera. |
| **Fog of war & vision** | For players (when the scene has token vision, and the world setting is on), each square is visible, explored or unseen. Visibility comes from Foundry's own `canvas.visibility.testVisibility`, so lights, darkvision, walls and vision modes all count. Explored squares are shown desaturated and dim. Unseen squares are black, and walls, roofs and upper floors over them are not drawn, so the map layout doesn't leak. The GM sees everything. |
| **Lights & darkness** | The scene darkness level dims the 3D lighting. It follows Foundry's darkness transitions through `lightingRefresh`. Ambient lights and token lights become three.js point lights with their colour and radius; the 8 nearest to the camera's focus are used. |
| **Tiles** | Floor tiles lie on the terrain, with rotation, mirroring, alpha and sort order. Overhead tiles (elevation at or above the scene's foreground elevation) become roofs at wall height. A roof fades out when your token is under it, when cutaway is on, or when the **Roofs** toggle is off. To players, hidden tiles are not shown. |
| **Levels (v14)** | If the scene has native levels, each upper level is a floor plane at its elevation, using the level's image (transparent parts stay see-through). Walls, tokens and tiles are assigned to a level by id or by elevation. A **Visible levels** selector hides the floors above the one you pick. *This follows the v14 data shape as far as known, and has only been checked against a mock (see below).* |
| Camera | Orbit (left-drag), pan (right-drag), zoom (wheel), 45° rotate buttons, recenter, and a top-down toggle. |

Settings: wall height (squares), height paint step (squares), fog of war in 3D (world), and show grid in 3D (per client).
The cutaway, roofs and window toggles are remembered per client.
UI text is in English and pt-BR (`lang/`).

## Installing into Foundry

To install, put this folder in your Foundry data folder under `Data/modules/foundry-3d-view` (the folder name must equal the `id` in `module.json`).

Windows, with a symlink so edits show up right away (run in an admin PowerShell, or with Developer Mode on):

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\foundry-3d-view" `
  -Target "C:\path\to\this\repo"
```

Linux/macOS:

```sh
ln -s /path/to/this/repo ~/.local/share/FoundryVTT/Data/modules/foundry-3d-view      # Linux
ln -s /path/to/this/repo ~/Library/Application\ Support/FoundryVTT/Data/modules/foundry-3d-view  # macOS
```

You can also copy the folder there instead. Only `module.json`, `scripts/`, `styles/`, `lang/` and `vendor/` are needed at runtime.
Then restart Foundry, enable **Foundry 3D View** in *Manage Modules*, open a scene, and click the cube button in the Token controls.

## How it was tested (no real Foundry yet)

Foundry is not installed on the development machine, so the module has **not been run inside a real Foundry yet**. Instead there are four layers of checks:

1. **Unit tests** (`npm test`, 67 tests, vitest). They cover the pure logic:
   - coordinates, walls and doors;
   - heights, the auto pass, brush and undo;
   - terrain mesh winding and UVs;
   - line of sight and fog states;
   - cutaway, lights, tiles, levels and measurement;
   - the scene model.
2. **Dev page** (`dev/index.html`). The same renderer, toolbar and interaction code, running on a generated sample dungeon. That dungeon has an open door, a closed door, a secret door, a dais with a stair, a pillar, a balcony on a second level, a rug tile, a roof, three lights, darkness and six tokens. The page itself plays the Foundry side.
3. **Mock Foundry harness** (`dev/foundry-mock.html`). The real `scripts/main.mjs` and controller run against fake `Hooks`, `game`, `canvas`, `ui` and documents that fire hooks on update. It runs as GM, as a player (`?gm=0`), and with v14-style levels (`?levels=1`). It checks:
   - scene control registration (both the v13 object and the older array shapes) and the keybinding;
   - opening and closing the view, and unhooking on close;
   - document updates for walls, tokens, tiles, lights and darkness;
   - height flags round-trip;
   - selecting and moving tokens from 3D, with wall blocking for players;
   - doors, including locked doors;
   - fog and token visibility for players;
   - reloading on `canvasReady`, including closing in the middle of a reload.
4. **Headless browser self-tests** (`npm run selftest`, 119 checks over 5 pages). The pages above run in headless Edge or Chrome with real WebGL (SwiftShader), and every interaction is a synthetic pointer click on the rendered 3D view. The last page is a performance check on a 120×120 map with 2400 walls and 150 tokens: it loads in about 0.6 s, renders a frame in about 9 ms even on the CPU rasterizer, updates fog in about 50 ms, and edits heights in about 30 ms.

The self-tests found and fixed several real bugs:
- an infinite loop when heights changed;
- picking blocked by transparent upper floors;
- a shader compile error;
- a crash when the view was closed during a scene reload.

### First things to check in a real Foundry

These were all written against the v13 public API and checked only against the mock:

- The overlay is inserted right after `#board`, so Foundry's UI stays on top. Check that the sidebar and scene controls are still clickable while the view is open.
- The cube button under Token controls: `getSceneControlButtons` uses the v13 object API, with an array fallback.
- Token positions during movement: `refreshToken` reads the placeable's `x/y`.
- `canvas.visibility.testVisibility` for fog, and `canvas.environment.darknessLevel` for darkness.
- `Token#checkCollision(dest, {type: "move", mode: "any"})` for wall blocking. If it throws, the move is allowed and a warning is logged.
- Moves use `TokenDocument#update({x, y})`. If you want v13's movement API (`move`) and its waypoints instead, that's a small change.
- **v14:** the background lookup, and the level fields `scene.levels`, `level.elevation.bottom`, `level.background`, `doc.level` / `doc.levels`.

## Development

```sh
npm install          # three + vitest (dev only)
npm test             # unit tests
npm run selftest     # headless browser checks: dev page, mock Foundry (GM, player, levels), performance
npm run screenshot   # renders dev/screenshots/*.png
npm run dev          # static server → http://localhost:8173/dev/  (and /dev/foundry-mock.html, /dev/perf.html)
npm run vendor       # re-copy three.js from node_modules into vendor/three
node dev/make-sample.mjs   # regenerate dev/sample-scene.json
```

Dev page URL params: `?player=1` (fog and vision on), `?topdown=1`, `?cutaway=1`, `?paint=1`, `?az=<deg>`, `?select=hero&hover=11,5`.
The page's buttons simulate the Foundry hooks: door update, token move, player view, darkness.

Screenshots (`dev/screenshots/`):

| File | What it shows |
|---|---|
| `dev-page-orbit.png` | GM orbit view with the roof, balcony and lights |
| `dev-page-topdown.png` | Top-down view |
| `dev-page-cutaway.png` | Cutaway walls |
| `dev-page-ruler.png` | Ruler with distance |
| `dev-page-fog.png` | Player fog, top-down |
| `dev-page-player.png` | Player fog, in perspective |
| `dev-page-paint.png` | Height paint mode |
| `foundry-mock-gm.png` | The real module in the mock Foundry, as GM |
| `foundry-mock-player.png` | The real module in the mock Foundry, as a player |

### Layout

```
module.json
scripts/main.mjs               settings, keybinding, scene control, API
scripts/foundry/controller.mjs overlay, hooks, fog/visibility, 3D actions (Foundry-only code lives here)
scripts/render/view3d.mjs      three.js renderer (knows nothing about Foundry)
scripts/ui/hud.mjs             toolbar + GM height painter (plain DOM)
scripts/ui/interact.mjs        click to select / move / open doors, hover ruler
scripts/core/*.mjs             pure logic, unit-tested: coords, heights, walls, terrain, vision, scene-extras, scene-model
vendor/three/                  three.module.js, three.core.js, OrbitControls.js (import rewritten), LICENSE
dev/                           dev page, mock Foundry harness, perf page, sample scene, art, screenshots
tests/                         vitest
```

Coordinates: one world unit is one grid square. World x = canvas x, world z = canvas y, and y is up.
The origin is the centre of the scene rect. Vertical values are in grid distance units divided by `grid.distance`.

## Known limits and next ideas

- **Fog is per square.** Edges are softened by filtering, but it is not the exact vision polygon.
- **Fog memory lasts only for the session.** Explored squares are kept while the page is open; Foundry's saved fog exploration is not read yet.
- **Lights** are three.js point lights, so they don't cast shadows through walls in 3D. Line of sight and fog are still exact per square.
- **Doors and tokens** are separate meshes. That is fine for normal scenes; a map with hundreds of doors adds draw calls.
- **Not done yet:**
  - token rings / dynamic ring art;
  - a sloped stair or ramp tool;
  - waypoint movement in 3D (Foundry v13 `move` API) and a drag ruler;
  - automatically showing the level a token is on (v14);
  - door sounds.

## License

MIT for this module's code (see `LICENSE`). three.js is MIT, © three.js authors (`vendor/three/LICENSE`).
