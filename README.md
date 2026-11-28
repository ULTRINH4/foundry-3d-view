# Foundry 3D View

A Foundry VTT module that shows the current scene in 3D, tactics-RPG style. The map becomes terrain
you can raise square by square, walls are extruded, doors open and close live, and tokens stand
on the map as paper standees. Players see the scene through fog of war. You can select and move
tokens and open doors directly in 3D. The 2D scene stays as it is: the 3D view is an overlay you
toggle on and off.

- **Foundry:** v13 and v14, both tested end to end on real servers (v13 build 351, v14 build 371). Square or gridless scenes. Works with any system.
- **No build step:** plain ES modules. three.js r187 is vendored in `vendor/three/` (MIT, see `vendor/three/LICENSE`).
- **Original code:** written from scratch against Foundry's public API and three.js. It is not derived from any other 3D module.

![Orbit view of the sample scene](dev/screenshots/dev-page-orbit.png)

![Tactics movement: reachable squares, attack band and path](dev/screenshots/dev-page-fire-emblem.png)

## Features

| Feature | Notes |
|---|---|
| Toggle the 3D view | **Token controls → cube button**, or the keybinding **Shift+V** (rebindable). There is also an API: `game.modules.get("foundry-3d-view").api.toggle()`. You can switch between full screen and a window (picture-in-picture). |
| Floor | The scene background is a textured ground at the correct scale: grid size, padding and background offset are all applied. |
| Heights per square | Stored in the scene flag `flags.foundry-3d-view.heights` as `{cols, rows, data[]}`, in grid distance units (the same units as token elevation). Tokens stand on `max(terrain under the token, elevation)`. |
| GM height tool | **Paint heights**: left-click raises a square, right-click or Shift+click lowers it. The **Brush** can be 1×1, 3×3 or 5×5. **Undo** (also Ctrl+Z) keeps 50 steps. **Auto: raise outside** / **Auto: raise rooms** make a rough first pass from the walls. **Flatten** resets everything to 0. |
| Walls | Each wall that blocks sight becomes a box. Invisible walls are skipped. Plain walls are drawn as one instanced mesh, so there is one draw call for all of them. If a wall has `wall-height` flags (from the Wall Height module), those set its top and bottom. |
| **Wall look** | Pick one in the module settings. **Inherit from the map** is the default: wall tops show the map exactly, and the wall faces take the colours of the wall as drawn on the battlemap. **Wall texture** tiles an image of your choice in world space, so it continues across walls without seams. **Flat** is plain grey. **Rectangular textures** keep their proportions (a 2:1 image makes tiles twice as wide as tall), and the **texture fit** setting picks **Repeat** (tiles sized by the **texture size** setting, in squares) or **Wall height** (the image spans the wall's height and repeats along it: good for wall strips with a baseboard and moulding). **Per wall:** the Wall configuration sheet gets a **3D texture** field, with Foundry's file picker, plus the fit and size for that wall. Walls that share a look are still drawn as one instanced mesh. |
| **Doors** | Doors are **separate from walls**: they never take the wall look or a wall's texture. Without a door texture they are the module's own **wooden door** (planks, braces and a handle), so they stand out from the wall. The **door texture** setting, or the **3D door texture** field in a door's Wall config sheet, sets an image that is **fitted once on each door leaf** (for pictures of a door), or **repeated like a wall** (door texture mode). Opening a door swings the leaf 90° on its hinge; it **rests flat against the wall end** instead of cutting into it. |
| **Texture library** | **24 textures drawn by the module** (original art, no image files, so the module stays light), each with a **relief map** so torchlight picks out mortar joints and wood grain. **Walls:** stone blocks, dungeon stone, red brick, mossy brick, wooden planks, log cabin, whitewashed plaster, timber frame, cave rock, castle marble, metal panels, hedge. **Doors:** wooden, reinforced, ornate double, **iron gate** (see-through), stone, sci-fi, barn. **Window frames:** wood, stone. **Glass:** clear, frosted, stained. A **Library** button (swatch icon) next to every texture field (module settings, Wall config, bulk tool, Scene config) opens a window of **thumbnails**: click one to use it. Your own image files still work as before. |
| **Ambience themes (per scene)** | The **Scene configuration** gets a **3D view** section with one-click themes: **Dungeon, Tavern, Castle, Cave, Village (timber frame), Mansion, Sci-fi ship**. A theme sets that scene's walls, doors, window frames, glass, **sky colour** and **dust in the air**; each can also be picked on its own there. Scenes without a theme follow the world settings. |
| **Ambience extras** | **Shading at the base of walls** (walls darken near the floor, for depth). **Flickering flames:** lights animated as torches or flames in Foundry flicker in 3D too. **Weather:** the scene's Foundry weather (**rain, storm, snow, blizzard, leaves, fog**) falls as particles in 3D. **Dust** floats in the air in themed scenes (dungeons, caves). Each is a client setting, for slower machines. |
| **Wall kinds** | Walls are drawn by their Foundry type. **Windows** (Foundry's Window tool, sight = proximity) get an **opening with a glass pane**: solid below the sill and above the lintel. This is a setting, and when it is off windows are solid walls. **Invisible walls** (block movement, not sight) become **see-through glass panels**, so they keep their volume; a setting can hide them instead. Ethereal walls are not drawn. **Texture overrides:** separate textures for walls, doors, window frames and **glass**; window frames follow the wall fit. Use a PNG with transparency for frosted or stained glass. Per wall, the Wall config sheet has a 3D texture field. |
| **Wall heights (half walls)** | The Wall config sheet has a **3D height** field, in squares above the ground: 0.5 is a half wall, 0.25 a low wall. Wall Height module flags still win. In **Foundry v14**, walls have no height of their own, because height comes from **scene levels**. The "Walls span their level" setting makes a wall without its own height fill its level's height. |
| **Bulk wall tool** | In the **Walls controls**, select several walls and click the paint-roller button (GM). Apply a **wall texture** (with its fit and size) to the walls, a **door texture** to the doors, and/or a height preset (full, 1.5, half, low, custom, module default) to all of them at once, or remove their 3D textures. Walls never get the door texture and doors never get the wall texture. |
| Doors | Each door is its own mesh, hinged at the first point of the wall. It swings open or closed with an animation on `updateWall`. To players, a closed secret door looks like a plain wall. |
| **Walls: up / cutaway / down (The Sims style)** | The walls button cycles three modes. **Cutaway** (the default) works like The Sims: the module finds the rooms from the walls and sinks the **front walls of each room** (the ones hiding a room from the camera) to a low stub with a light cap, while the **back walls stay up**. It follows the camera: turn it and the walls that end up in front sink, the others rise, animated. Walls standing between the camera and a visible token sink too, so maps without closed rooms (caves, loose walls) work. Doors stay clickable when cut. **Down** lowers every wall, **Up** shows them all. It applies to the viewed level; the fog of war still hides what players haven't seen. |
| Tokens | Token art is shown as a card on a base coloured by disposition. Cards follow Foundry's movement animation (`refreshToken`). Selected tokens get a yellow ring. **Sprite facing** (setting and toolbar): **Standee** turns toward the camera and leans back when seen from above. **Billboard** is always parallel to the screen, like **Final Fantasy Tactics / Doom** sprites. **Fixed** is a paper standee that follows the token's rotation. **Animated tokens:** video (webm) token art plays in 3D. |
| **Directional & animated sprites (Doom-style)** | The Token config sheet (Appearance tab) can take a **sprite sheet**: rows are view directions (1, 4 or 8) and columns are animation frames. With 4 directions the rows are front, left, back, right. With 8 they are front, front-left, left, back-left, back, back-right, right, front-right. The 3D view picks the row from the angle between the token's facing (its rotation, 0 = facing down the map) and the camera. Columns loop at the fps you set. |
| **Tactics-style movement** | Inspired by the tactics RPGs (Fire Emblem, FFT). **Selecting and moving are separate**: a click on your token only selects it. **Move mode** turns on with a **second click on the selected token**, the **M** key, or the toolbar's **Move** button (shoe prints). Then the squares it can reach turn **blue**, with a **red** band around them (attack reach). A **grid cursor** follows the mouse, or the **arrow keys / WASD**: "up" always means "away from the camera", whatever the angle, and the camera follows the cursor. A **yellow arrow** shows the path to the cursor, with the distance and height difference. **Click or Enter** on a blue square and the token **walks there square by square** (Foundry waypoints), hopping up and down ledges; move mode then ends. **Esc**, right-click or **M** leave it. Outside move mode a click on the floor does nothing, so no accidental moves. **In combat**, a player's turn turns move mode on by itself, and the blue shows the **movement left this turn** (it resets on the next turn; squares walked from the 3D view count). Walls, closed doors and enemies block; climbing a ledge higher than the height step costs +1; diagonals follow the scene rule; tokens bigger than one square move from the square under their center. Players stay inside the blue area (and a paused game refuses moves); the GM can move anywhere. Range: **world setting** (default 6 squares, red band 1) or **per token** in the Token config ("3D view" fieldset). **Click a door** to open or close it; locked doors are refused for players. |
| **Fog of war & vision** | The 3D view shows **what the selected token sees**. For players this is always on. For the **GM**, it applies while a token with vision is selected and switches off when it is released, just like the 2D canvas. Tokens the viewer can't see are hidden. Visibility is read from Foundry's own vision mask (or `testVisibility` as a fallback), so walls, lights, darkvision and vision modes all count. Explored squares stay dimmed for the session. Walls, roofs and upper floors over unseen squares are not drawn. |
| **Lights & darkness (Foundry lighting)** | The 3D view uses **Foundry's own rendered lighting**. While the 3D view covers the screen, the 2D canvas behind it is framed on the whole scene. Several times a second, the module reads Foundry's illumination, coloured light and vision layers at up to 4 samples per square and applies them to the 3D terrain, walls, props and tokens. So animated lights, light colours, darkness, global illumination, darkness regions, vision modes and adaptive lights look the same as in 2D. In window mode, or if sampling isn't possible, it falls back to a light map computed from the light sources. World setting. |
| **Tiles** | Floor tiles lie on the terrain, with rotation, mirroring, alpha and sort order. Overhead tiles (elevation at or above the scene's foreground elevation) become roofs at wall height. A roof fades out when your token is under it, when the walls are cut or down, or when the **Roofs** toggle is off. To players, hidden tiles are not shown. |
| **3D models (props)** | In the Tile config sheet, choose a **built-in low-poly model** (tree, pine, bush, rock, crate, barrel, table, chair, bench, car, pillar, lamp post) or a **custom .glb/.gltf** file. The tile is drawn as that model, filling its footprint and following its rotation, with a height multiplier. Models stand on the terrain and respect fog and lighting. **Export:** the cubes button in the Tiles controls, or `game.modules.get("foundry-3d-view").api.exportModels()`, saves the built-in models as **.glb files** to `foundry-3d-view-models/`, ready to use as assets in Foundry or elsewhere. |
| **Levels (v14)** | Native scene levels are supported. Each upper level is a floor plane at its elevation, using the level's image; transparent parts stay see-through. Walls, tiles and lights are placed by their `levels`, tokens by their `level`. A wall with no levels sits on the ground. **The 3D view follows the level you are viewing in Foundry.** When you switch level, the floors above it, and their walls and tokens, are hidden. Roofs use the viewed level's top as their height. The **Visible levels** selector starts at the viewed level and can show all levels. Players never see tokens on other levels (v14 gives them no placeable). Editing a level rebuilds the view. The background and scene colour are read from the levels, so the deprecated v14 `Scene#background` / `backgroundColor` / `foregroundElevation` getters are never touched. |
| Camera | **Free camera:** orbit (left-drag), pan (right-drag), zoom (wheel), animated 45° turns, recenter, and top-down. **Tactics camera (Final Fantasy Tactics style, the default):** an orthographic camera at a fixed 30° elevation on a diagonal, with **animated 90° turns** (toolbar buttons, or **Q/E** with the mouse over the 3D view), wheel zoom, drag to pan (left or middle button) and top-down. Toggle it from the toolbar, or pick the free camera in the settings. Billboard sprites are the default facing. |
| **Combat & HUDs** | During combat the camera **pans to the combatant whose turn it is**, if you can see it, and a **green pulsing ring** marks it (client setting). Foundry's **combat tracker**, the **Carousel Combat Tracker** (combat-tracker-dock), **Token Action HUD** and other UI stay above the 3D view. **Right-click a token** in 3D to open **Foundry's Token HUD over the 3D standee**; it stays glued to the standee while you move the camera. Right-click an empty square to release. The HUD keeps its **normal size** whatever the 2D zoom behind, with room around the standee. The toolbar is compact: big icons, with Foundry tooltips on hover. An optional **portrait** (client setting, off by default) floats over each standee. |
| **Combat animations (Sequencer / Automated Animations)** | Effects played through **Sequencer** are **mirrored in 3D** with the same video the 2D effect plays: position, size, rotation, `stretchTo` lines, opacity and sprite-sheet frames. Sequencer is what Automated Animations and many other modules use. Ended effects are removed. Client setting. |

Settings:
- **World:** wall height, wall look, wall/door/window/glass textures, texture size, wall texture fit, door texture mode, windows with an opening, invisible walls (glass/hidden), walls span their level (v14), height paint step, fog of war in 3D, Foundry lighting in 3D, limit movement to the reachable squares, movement range and attack reach.
- **Per client:** camera (tactics/free), sprite facing, follow combat turns, combat animations in 3D, portraits over tokens, show grid, wall-base shading, flickering flames, weather in 3D and dust in the air.
- **Per scene** (Scene configuration, "3D view"): ambience theme, wall/door/window/glass textures, sky colour, dust.
The walls mode, roofs and window toggles are remembered per client.
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

**Real Foundry: `npm run e2e` passes on both versions. v13 build 351 runs 61 checks (Ordem Paranormal system). v14 build 371 runs 70 checks (CoC7 system), including native levels, wall kinds, half walls, the bulk wall tool and 3D models. `tools/foundry-compat.mjs` adds 11 compatibility checks per version, all passing on v13 and v14.**
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
  - right-click on a standee opens the Token HUD at its normal size;
  - right-click to release;
  - clicking a door to open it.
- **Tactics movement:** selecting only selects; a second click, M or the Move button turns move mode on; blue and red squares, walls limiting the blue area, the keyboard cursor, the path arrow, Enter walking the token along Foundry waypoints and ending move mode, a floor click outside move mode ignored, a far square refused, Esc clearing the range.
- **Combat movement (player):** move mode turns on at the start of the player's turn, the blue shrinks after walking 2 squares, and resets on the next turn.
- **GM tools:** height paint saved to the scene flag, plus undo.
- **Walls modes:** The Sims cutaway by default (front walls cut, back walls up, caps drawn), following the camera when it turns around; walls down and up; the mode saved as a client setting.
- **Wall look:**
  - walls inherit the map by default;
  - the wall and door texture settings apply live, and textures uploaded to Foundry load;
  - the Wall config sheet shows the **3D texture** field, and saving the sheet stores the flag, which overrides that wall in 3D;
  - doors keep their own look (the wooden door, or the door texture) and open flat against the wall end; the bulk tool gives walls the wall texture and doors the door texture.
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
- **v14 levels:**
  - both levels are read;
  - viewing the ground hides the floor above it, with its wall and token;
  - the selector starts at the viewed level;
  - an upper token stands at its level's height;
  - switching the viewed level in Foundry keeps the 3D view open and follows it;
  - the roof height follows the viewed level;
  - editing a level rebuilds the view;
  - a player does not see a token on another level.
- No console errors from the module, and **no deprecation warnings caused by the module**. This check found a v13 one, `TileDocument#overhead`, which is fixed now.

Running it against real Foundry found bugs that the mock could not:
- **Toggle fired twice.** In v13 the cube button opened and immediately closed the view, because v13 calls both `onChange` and the legacy `onClick`.
- **Toolbar hidden by notifications.** Foundry's notifications (top centre) covered the toolbar, so it moved to the bottom centre.
- **Content visible while loading.** For a player, tokens and the map were visible for a moment while the scene loaded. Players now start fully fogged and hidden until the first visibility update.
- **Light grey sky.** The default scene colour made the 3D sky light grey; it is darkened now.
- **v14-specific findings:**
  - Scene colour, background and roof height moved into levels.
  - Tokens on other levels have no placeable, so falling back to "not hidden" would have leaked them to players.
  - The Wall config body is now a scrollable `.standard-form`, so the 3D texture field goes inside it.
  - The test harness itself had to change: v14 creates worlds through `/create`, and the join form field is `userId`.
- It also confirmed real behaviour that the module already handled. Foundry chooses its own padding (`sceneX` was 300, not 200), and the module uses `canvas.dimensions`. In v13, `token.x` changes during the movement animation.

How to run it yourself (Windows, portable Foundry):

```powershell
# a separate data folder: Config/license.json (copy of yours), Config/options.json,
# Data/systems/<system>, Data/modules/foundry-3d-view -> this repo (junction)
node "<Foundry>/App/resources/app/main.mjs" --dataPath="<testdata>" --port=30013 --noupnp --noupdate
$env:FOUNDRY_URL="http://localhost:30013"; $env:FOUNDRY_SYSTEM="ordemparanormal"; npm run e2e
```

Foundry v13 needs Node 20 to 22 (Node 24 is refused), and a portable Node 22 works. Foundry v14 needs Node 24. For v14, run the installed app's `resources/app/main.mjs` the same way, with `FOUNDRY_SYSTEM=CoC7` or any v14 system.

Other layers:
1. **Unit tests** (`npm test`, 139, vitest). They cover the pure logic: coordinates, walls and doors, heights, brush and undo, the auto pass, the terrain mesh, line of sight and fog, the cutaway (rooms, front/back walls, walls hiding tokens), lights, tiles, levels, measurement and the scene model.
2. **Dev page** (`dev/index.html`). The renderer, toolbar and interaction on a generated sample dungeon, with no Foundry needed.
3. **Mock Foundry harness** (`dev/foundry-mock.html`). The real module runs against fake Foundry globals, as GM, as a player, and with v14-style levels.
4. **Headless self-tests** (`npm run selftest`, 164 checks over 5 pages). This includes a performance page: a 120×120 map with 2400 walls and 150 tokens loads in about 0.6 s and renders a frame in about 9 ms on SwiftShader.

### Compatibility test (real Foundry + other modules)

`node tools/foundry-compat.mjs` (with `FOUNDRY_URL`) runs against a real server with Sequencer, Carousel Combat Tracker (combat-tracker-dock), Token Action HUD core, socketlib and lib-wrapper enabled. It checks:
- a real Sequencer `stretchTo` effect is mirrored in 3D between the two tokens, and removed when it ends;
- starting combat and taking the next turn mark the active combatant and pan the camera to it;
- the combat tracker and the combat dock stay visible above the 3D view;
- right-clicking a standee opens Foundry's Token HUD over it;
- the module logs no errors.

All 11 checks pass on v13 and on v14.

### Still unverified
- **Real GPUs and other systems.** All browser runs used SwiftShader. Only Ordem Paranormal (v13) and CoC7 (v14) were tested.
- **v14 levels:** level `visibility.levels` (seeing other levels through a level) and the level `fit`/`scale`/`rotation` texture options are not used. Each level's image is drawn over the whole scene rectangle, offset by `textures.offsetX/Y`.
- **Saved fog exploration** from Foundry is not read; explored squares last for the session only.

## Development

```sh
npm install          # three + vitest (dev only)
npm test             # unit tests
npm run selftest     # headless browser checks: dev page, mock Foundry (GM, player, levels), performance
npm run e2e          # end-to-end against a running real Foundry server (see above)
node tools/foundry-compat.mjs   # compatibility with Sequencer / combat dock / Token HUD (real server)
npm run screenshot   # renders dev/screenshots/*.png
npm run dev          # static server → http://localhost:8173/dev/  (and /dev/foundry-mock.html, /dev/perf.html)
npm run vendor       # re-copy three.js from node_modules into vendor/three
npm run build        # dist/foundry-3d-view.zip + dist/module.json for the current version
npm run release -- 0.3.2   # bump version, commit, tag v0.3.2, push, create the GitHub release
node dev/make-sample.mjs   # regenerate dev/sample-scene.json
```

Dev page URL params: `?player=1` (fog and vision on), `?topdown=1`, `?cutaway=1` (The Sims cutaway), `?cut=up|cutaway|down`, `?paint=1`, `?az=<deg>`, `?select=hero&hover=11,5`.
The page's buttons simulate the Foundry hooks: door update, token move, player view, darkness.

Screenshots (`dev/screenshots/`):

| File | What it shows |
|---|---|
| `dev-page-orbit.png` | GM orbit view with the roof, balcony and lights |
| `dev-page-topdown.png` | Top-down view |
| `dev-page-theme-dungeon.png`, `dev-page-theme-village.png`, `dev-page-theme-scifi.png` | Ambience themes (the scifi one with rain) |
| `dev-page-library.png` | The built-in texture library (colour and relief maps) |
| `dev-page-walls-texture.png` | Wall look "texture": bricks on walls, a planks image fitted on the doors |
| `dev-page-walls-map.png` | Wall look "inherit from the map" |
| `dev-page-cutaway.png` | The Sims cutaway: front walls of each room cut, back walls up |
| `dev-page-ruler.png` | Ruler with distance |
| `dev-page-fog.png` | Player fog, top-down |
| `dev-page-player.png` | Player fog, in perspective |
| `dev-page-paint.png` | Height paint mode |
| `foundry-mock-gm.png` | The real module in the mock Foundry, as GM |
| `foundry-mock-player.png` | The real module in the mock Foundry, as a player |
| `foundry-real-v13-gm.png` | **Real Foundry v13**: the GM with the 3D view open |
| `foundry-real-v13-ruler.png` | Real Foundry: a selected token and the hover ruler |
| `foundry-real-v13-cutaway.png` | Real Foundry: The Sims cutaway |
| `foundry-real-v13-walls-texture.png` | Real Foundry: textured walls |
| `foundry-real-v13-wall-config.png` | Real Foundry: the "3D texture" field in the Wall config sheet |
| `foundry-real-v13-player.png` | Real Foundry: the player view with fog |
| `foundry-real-v13-player-door.png` | Real Foundry: the player after opening the door from 3D |
| `foundry-real-v14-*.png` | The same views on **Foundry v14** |
| `foundry-real-v14-levels-ground.png` | v14: viewing the ground level, with the balcony hidden |
| `foundry-real-v14-levels-upper.png` | v14: after switching to the balcony level in Foundry |
| `foundry-real-v14-levels-player.png` | v14: the player on the ground, with the archer upstairs hidden |
| `foundry-real-v14-sequencer.png` | v14: a Sequencer fire effect (stretchTo) mirrored in 3D |
| `foundry-real-v14-combat.png` | v14: combat, with the active combatant ringed, the tracker and the combat dock on top |
| `foundry-real-v14-token-hud.png` | v14: Foundry's Token HUD over the 3D standee |
| `dev-page-fire-emblem.png` | Tactics movement: blue reachable squares, red attack band, yellow path arrow and the grid cursor |
| `dev-page-tactics.png` | Tactics (FFT-style) camera with billboard sprites, window glass, a half wall and 3D props |

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
- **Cutaway rooms come from the walls.** A block of solid rock fully enclosed by walls (common on dungeon maps) also counts as a "room", so the walls in front of it sink too.
- **Doors and tokens** are separate meshes. That is fine for normal scenes; a map with hundreds of doors adds draw calls.
- **Not done yet:**
  - token rings / dynamic ring art;
  - a sloped stair or ramp tool;
  - a drag ruler;
  - automatically showing the level a token is on (v14);
  - door sounds.

## License

MIT for this module's code (see `LICENSE`). three.js is MIT, © three.js authors (`vendor/three/LICENSE`).
