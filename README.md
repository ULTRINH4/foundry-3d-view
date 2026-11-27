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
| **Wall look** | Pick one in the module settings. **Inherit from the map** is the default: wall tops show the map exactly, and the wall faces take the colours of the wall as drawn on the battlemap. **Wall texture** tiles an image of your choice in world space, so it continues across walls without seams. **Flat** is plain grey. There is an optional **door texture**, and a **texture size** setting (squares per repeat). **Per wall:** the Wall configuration sheet gets a **3D texture** field, with Foundry's file picker, that overrides the setting for that wall or door. Walls that share a look are still drawn as one instanced mesh. |
| Doors | Each door is its own mesh, hinged at the first point of the wall. It swings open or closed with an animation on `updateWall`. To players, a closed secret door looks like a plain wall. |
| **Cutaway walls** | A toggle sinks the walls between the camera and the point it looks at, so you can see into rooms. Walls rise back smoothly when you turn the camera. |
| Tokens | Token art is shown as an upright card that always faces the camera. It sits on a base coloured by disposition. Cards follow Foundry's movement animation (`refreshToken`) and lie flat in top-down view. Selected tokens get a yellow ring. |
| **Interaction in 3D** | **Click** a token you own to select it (Shift adds to the selection). Then **click a square** to move it: for players, walls block the move and a paused game blocks it too. **Hover** to see a **ruler** with the distance and the height difference; it uses `canvas.grid.measurePath`, so the scene's diagonal rule applies. **Click a door** to open or close it; locked doors are refused for players. **Right-click** or **Esc** releases the selection. Dragging still moves the camera. |
| **Fog of war & vision** | For players (when the scene has token vision, and the world setting is on), each square is visible, explored or unseen. Visibility comes from Foundry's own `canvas.visibility.testVisibility`, so lights, darkvision, walls and vision modes all count. Explored squares are shown desaturated and dim. Unseen squares are black, and walls, roofs and upper floors over them are not drawn, so the map layout doesn't leak. The GM sees everything. |
| **Lights & darkness** | The scene darkness level dims the 3D lighting. It follows Foundry's darkness transitions through `lightingRefresh`. Ambient lights and token lights become three.js point lights with their colour and radius; the 8 nearest to the camera's focus are used. |
| **Tiles** | Floor tiles lie on the terrain, with rotation, mirroring, alpha and sort order. Overhead tiles (elevation at or above the scene's foreground elevation) become roofs at wall height. A roof fades out when your token is under it, when cutaway is on, or when the **Roofs** toggle is off. To players, hidden tiles are not shown. |
| **Levels (v14)** | If the scene has native levels, each upper level is a floor plane at its elevation, using the level's image (transparent parts stay see-through). Walls, tokens and tiles are assigned to a level by id or by elevation. A **Visible levels** selector hides the floors above the one you pick. *This follows the v14 data shape as far as known, and has only been checked against a mock (see below).* |
| Camera | Orbit (left-drag), pan (right-drag), zoom (wheel), 45° rotate buttons, recenter, and a top-down toggle. |

Settings: wall height (squares), wall look (inherit from the map / texture / flat), wall texture, door texture, texture size, height paint step (squares), fog of war in 3D (world), and show grid in 3D (per client).
The cutaway, roofs and window toggles are remembered per client.
UI text is in English and pt-BR (`lang/`).

## Installing into Foundry

### From the manifest URL (recommended: Foundry updates it for you)

In Foundry's setup screen, go to **Add-on Modules → Install Module**. Paste this into **Manifest URL** and click **Install**:

```
https://github.com/ULTRINH4/foundry-3d-view/releases/latest/download/module.json
```

That URL always points at the newest release. When a new version comes out, **Update** (or **Update All**) in Foundry's Add-on Modules tab installs it.

### For development (symlink)

To install from source, put this folder in your Foundry data folder under `Data/modules/foundry-3d-view` (the folder name must equal the `id` in `module.json`).

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

## How it was tested

**Real Foundry v13 (build 351): `npm run e2e`, 50 end-to-end checks, all passing.**
The script `tools/foundry-e2e.mjs` drives a real Foundry server through headless Edge (playwright-core), using real mouse and keyboard input. It runs in a throwaway data folder, never in your own worlds. It:
- creates a world;
- enables the module (and the system's required modules);
- builds the sample dungeon as a real scene: walls, doors, actors and tokens, lights, tiles and heights;
- tests the 3D view as the GM;
- tests it again as a player, in a second browser session at the same time.

What it covers:
- **Toolbar and overlay:**
  - the cube button in the v13 scene controls;
  - the overlay placement, with the sidebar and scene controls still clickable;
  - the scene loading into 3D.
- **Live sync from Foundry:**
  - `updateWall` door swings;
  - `updateToken` and the `refreshToken` animation;
  - darkness changes.
- **Real mouse clicks in 3D:**
  - clicking a standee to control the token;
  - clicking a square to move it;
  - the hover ruler (Foundry measurement);
  - right-click to release;
  - clicking a door to open it.
- **GM tools:** height paint saved to the scene flag, plus undo; cutaway, saved as a client setting.
- **Wall look:**
  - walls inherit the map by default;
  - the wall and door texture settings apply live, and textures uploaded to Foundry load;
  - the Wall config sheet shows the **3D texture** field, and saving the sheet stores the flag, which overrides that wall in 3D.
- **As a player:**
  - the Shift+V keybinding;
  - fog of war;
  - Foundry's `isVisible` for enemies and hidden tokens;
  - the secret door shown as a wall;
  - no GM tools;
  - actions refused while the game is paused;
  - moves through walls refused, while free moves work;
  - opening a door, which reveals the next room in the fog;
  - a locked door staying locked;
  - the GM closing a door and the player's 3D door following.
- No console errors from the module.

Running it against real Foundry found bugs that the mock could not:
- **Toggle fired twice.** In v13 the cube button opened and immediately closed the view, because v13 calls both `onChange` and the legacy `onClick`.
- **Toolbar hidden by notifications.** Foundry's notifications (top centre) covered the toolbar, so it moved to the bottom centre.
- **Content visible while loading.** For a player, tokens and the map were visible for a moment while the scene loaded. Players now start fully fogged and hidden until the first visibility update.
- **Light grey sky.** The default scene colour made the 3D sky light grey; it is darkened now.
- It also confirmed real behaviour that the module already handled. Foundry chooses its own padding (`sceneX` was 300, not 200), and the module uses `canvas.dimensions`. In v13, `token.x` changes during the movement animation.

How to run it yourself (Windows, portable Foundry):

```powershell
# a separate data folder: Config/license.json (copy of yours), Config/options.json,
# Data/systems/<system>, Data/modules/foundry-3d-view -> this repo (junction)
node "<Foundry>/App/resources/app/main.mjs" --dataPath="<testdata>" --port=30013 --noupnp --noupdate
$env:FOUNDRY_URL="http://localhost:30013"; $env:FOUNDRY_SYSTEM="ordemparanormal"; npm run e2e
```

Foundry v13 needs Node 20 to 22 (Node 24 is refused). A portable Node 22 works.

Other layers:
1. **Unit tests** (`npm test`, 72, vitest). They cover the pure logic: coordinates, walls and doors, heights, brush and undo, the auto pass, the terrain mesh, line of sight and fog, cutaway, lights, tiles, levels, measurement and the scene model.
2. **Dev page** (`dev/index.html`). The renderer, toolbar and interaction on a generated sample dungeon, with no Foundry needed.
3. **Mock Foundry harness** (`dev/foundry-mock.html`). The real module runs against fake Foundry globals, as GM, as a player, and with v14-style levels.
4. **Headless self-tests** (`npm run selftest`, 140 checks over 5 pages). This includes a performance page: a 120×120 map with 2400 walls and 150 tokens loads in about 0.6 s and renders a frame in about 9 ms on SwiftShader.

### Still unverified
- **Foundry v14.** I have only checked levels against the mock. There is a v14 installer in the owner's Downloads, but it was not installed.
- **Real GPUs and other systems.** All browser runs used SwiftShader, and only the Ordem Paranormal system was tested.
- **Saved fog exploration** from Foundry is not read; explored squares last for the session only.

## Development

```sh
npm install          # three + vitest (dev only)
npm test             # unit tests
npm run selftest     # headless browser checks: dev page, mock Foundry (GM, player, levels), performance
npm run e2e          # end-to-end against a running real Foundry server (see above)
npm run screenshot   # renders dev/screenshots/*.png
npm run dev          # static server → http://localhost:8173/dev/  (and /dev/foundry-mock.html, /dev/perf.html)
npm run vendor       # re-copy three.js from node_modules into vendor/three
npm run build        # dist/foundry-3d-view.zip + dist/module.json for the current version
npm run release -- 0.3.2   # bump version, commit, tag v0.3.2, push, create the GitHub release
node dev/make-sample.mjs   # regenerate dev/sample-scene.json
```

Dev page URL params: `?player=1` (fog and vision on), `?topdown=1`, `?cutaway=1`, `?paint=1`, `?az=<deg>`, `?select=hero&hover=11,5`.
The page's buttons simulate the Foundry hooks: door update, token move, player view, darkness.

Screenshots (`dev/screenshots/`):

| File | What it shows |
|---|---|
| `dev-page-orbit.png` | GM orbit view with the roof, balcony and lights |
| `dev-page-topdown.png` | Top-down view |
| `dev-page-walls-texture.png` | Wall look "texture": bricks on walls, planks on doors |
| `dev-page-walls-map.png` | Wall look "inherit from the map" |
| `dev-page-cutaway.png` | Cutaway walls |
| `dev-page-ruler.png` | Ruler with distance |
| `dev-page-fog.png` | Player fog, top-down |
| `dev-page-player.png` | Player fog, in perspective |
| `dev-page-paint.png` | Height paint mode |
| `foundry-mock-gm.png` | The real module in the mock Foundry, as GM |
| `foundry-mock-player.png` | The real module in the mock Foundry, as a player |
| `foundry-real-gm.png` | **Real Foundry v13**: the GM with the 3D view open |
| `foundry-real-ruler.png` | Real Foundry: a selected token and the hover ruler |
| `foundry-real-cutaway.png` | Real Foundry: cutaway walls |
| `foundry-real-walls-texture.png` | Real Foundry: textured walls |
| `foundry-real-wall-config.png` | Real Foundry: the "3D texture" field in the Wall config sheet |
| `foundry-real-player.png` | Real Foundry: the player view with fog |
| `foundry-real-player-door.png` | Real Foundry: the player after opening the door from 3D |

### Releasing a new version

Run `npm run release -- <version>`. It needs a clean working tree and the `gh` CLI logged in. It:
1. writes `version`, `manifest`, `download`, `url` and `bugs` into `module.json` (and the version into `package.json`), then commits;
2. builds `dist/foundry-3d-view.zip`. The zip holds only the runtime files (`module.json` at its root, plus `scripts/`, `styles/`, `lang/`, `vendor/`, `LICENSE` and `README.md`), and its paths use forward slashes so Linux servers can install it;
3. tags `v<version>`, pushes `main` and the tag, and creates the GitHub release with `module.json` and the zip as assets.

Foundry reads `manifest` (`releases/latest/download/module.json`) to look for updates, and `download` (the zip of that exact version) to install. **The repository must be public** for Foundry to download the files.

The install and update path was tested against a real Foundry v13 server. It installed 0.3.1 from a manifest URL, updated it to 0.3.2, and opened the 3D view from the installed zip.

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
