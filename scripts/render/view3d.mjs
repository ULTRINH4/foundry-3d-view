/**
 * three.js renderer for a scene model (see core/scene-model.mjs). Knows nothing about Foundry:
 * the Foundry adapter and the dev page both drive it through this API.
 *
 * Features: terrain with per-square heights, walls and animated doors, tokens as paper standees,
 * per-square fog of war, lights + darkness, wall cutaway toward the camera, tiles (floor + roofs),
 * stacked levels, picking (tokens/doors/cells), selection rings and a ruler.
 */
import * as THREE from "../../vendor/three/three.module.js";
import { OrbitControls } from "../../vendor/three/OrbitControls.js";
import { makeGrid, canvasToWorld, unitsToWorldY, worldToCell, tokenCenter, cellRect, cellCenter, worldToCanvas } from "../core/coords.mjs";
import { maxHeightUnderRect, wallBaseHeight, heightMapsEqual, normalizeHeightMap, getHeight } from "../core/heights.mjs";
import {
  wallBox, doorPose, isRenderableWall, isDoor, showAsDoor, wallMaterialKey, glassMaterialKey, windowSections, WALL_KIND,
} from "../core/walls.mjs";
import { buildTerrainArrays, buildGridLines } from "../core/terrain.mjs";
import { unlitBrightness } from "../core/lighting.mjs";
import { createBuiltinModel, isCustomModel, loadCustomModel } from "./models.mjs";
import { FOG } from "../core/vision.mjs";
import {
  SPRITE_FACING, tokenFacingYaw, directionRow, animationColumn, sheetCellUV, snapTacticsYaw,
} from "../core/sprites.mjs";
import {
  isWallTowardCamera, selectLights, ambientForDarkness, isOverheadTile, tilePlacement, tileContainsPoint, levelFloorY,
} from "../core/scene-extras.mjs";

const DEFAULTS = {
  wallHeight: 1.5, // world units (squares)
  wallThickness: 0.12,
  showGrid: true,
  isGM: false,
  cutaway: false,
  showRoofs: true,
  cutawayHeight: 0.22, // world units walls are lowered to
  maxLights: 8,
  // Wall look: "map" (inherit the scene image), "texture" (tiled wallTexture) or "flat".
  wallMode: "map",
  windowTexture: "",
  glassTexture: "",
  invisibleWalls: "glass", // "glass" (see-through panel with volume) or "hide"
  windowOpenings: true, // window walls get an opening with a glass pane
  useLevelHeight: false, // v14: walls span their level's height
  cameraMode: "free", // "free" (perspective orbit) or "tactics" (orthographic, fixed angle, 90° turns)
  spriteFacing: "camera", // see SPRITE_FACING
  tacticsElevation: 30, // degrees above the ground for the tactics camera
  wallTexture: "",
  doorTexture: "",
  wallTextureScale: 1, // squares covered by one repeat of a wall texture
  resolveSrc: (src) => src, // maps stored paths (e.g. Foundry data paths) to loadable URLs
  // Players: start with everything fogged and tokens hidden until the first visibility update,
  // so nothing leaks while the scene loads.
  startHidden: false,
  pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 2),
};

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const DISPOSITION_COLORS = { "-2": 0x8e44ad, "-1": 0xc0392b, 0: 0xd4ac0d, 1: 0x2e86c1 };
const FOG_VALUE = { [FOG.UNSEEN]: 0, [FOG.EXPLORED]: 110, [FOG.VISIBLE]: 255 };

const FOG_VERTEX_PARS = "varying vec3 vF3dWorld;\nvarying vec3 vF3dNormal;\n";
const FOG_FRAGMENT_PARS = `
uniform sampler2D f3dLightMap;
uniform sampler2D f3dColorMap;
uniform float f3dLightOn;
uniform float f3dUnlit;
uniform sampler2D f3dFogMap;
uniform float f3dFogOn;
uniform vec2 f3dFogMin;
uniform vec2 f3dFogSize;
varying vec3 vF3dWorld;
varying vec3 vF3dNormal;
vec2 f3dFogUV() {
  // Sample slightly in front of the surface so a wall face takes the fog of the room it faces.
  vec2 p = vF3dWorld.xz + vF3dNormal.xz * 0.35;
  return (p - f3dFogMin) / f3dFogSize;
}
float f3dFogValue() {
  vec2 uv = f3dFogUV();
  return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture2D(f3dFogMap, uv).r;
}
// Fog state of one square (no filtering): crisp test for hiding unseen geometry.
float f3dFogAt(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= f3dFogSize.x || cell.y >= f3dFogSize.y) return 0.0;
  return texture2D(f3dFogMap, (cell + 0.5) / f3dFogSize).r;
}
float f3dFogCell() {
  return f3dFogAt(floor(f3dFogUV() * f3dFogSize));
}
// Same, but a square next to a seen square counts as seen: walls bounding what you can see stay whole.
float f3dFogCellDilated() {
  vec2 c = floor(f3dFogUV() * f3dFogSize);
  return max(f3dFogAt(c), max(max(f3dFogAt(c + vec2(1.0, 0.0)), f3dFogAt(c - vec2(1.0, 0.0))),
                              max(f3dFogAt(c + vec2(0.0, 1.0)), f3dFogAt(c - vec2(0.0, 1.0)))));
}
// Foundry lighting. Light map: rgb = light factor (multiplied, like Foundry's illumination layer),
// a = seen only by vision (darkvision greys). Colour map: coloured light added with a screen blend.
vec3 f3dApplyLight(vec3 c) {
  if (f3dLightOn < 0.5) return c;
  vec2 uv = f3dFogUV();
  bool outside = uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0;
  vec4 lv = outside ? vec4(vec3(f3dUnlit), 0.0) : texture2D(f3dLightMap, uv);
  vec3 colr = outside ? vec3(0.0) : texture2D(f3dColorMap, uv).rgb;
  vec3 lit = c * lv.rgb;
  if (lv.a > 0.5) {
    // Darkvision: visible without light shows in greys, like Foundry's vision modes.
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    lit = mix(vec3(lum) * 0.62, lit, smoothstep(0.15, 0.6, dot(lv.rgb, vec3(0.3333))));
  }
  return 1.0 - (1.0 - lit) * (1.0 - colr);
}
vec3 f3dApplyFog(vec3 c) {
  if (f3dFogOn < 0.5) return c;
  float v = f3dFogValue();
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 explored = vec3(lum) * 0.5;
  vec3 col = mix(explored, c, smoothstep(0.6, 0.95, v));
  return col * smoothstep(0.0, 0.35, v);
}
`;

/* Wall UVs are computed from world position so textures tile seamlessly and "map" walls can
 * sample the scene image. f3dM is the wall's model(+instance) matrix: its X axis runs along the wall. */
const WALL_UV_PARS = "uniform vec2 f3dMapMin;\nuniform vec2 f3dMapSize;\nuniform float f3dTile;\n";
const WALL_UV_COMMON = `
    #ifdef USE_INSTANCING
      mat4 f3dM = modelMatrix * instanceMatrix;
    #else
      mat4 f3dM = modelMatrix;
    #endif
    vec3 f3dO = f3dM[3].xyz;
    vec2 f3dDir = normalize(f3dM[0].xz);
    vec2 f3dSideN = vec2(-f3dDir.y, f3dDir.x);
    vec2 f3dRel = vF3dWorld.xz - f3dO.xz;
    float f3dAlong = dot(f3dRel, f3dDir);`;
// "map": the top shows the map exactly; the faces take the map along the wall's line (the wall
// as drawn on the battlemap), so walls match the art they were traced from.
const WALL_MAP_VERTEX = `
  #ifdef USE_MAP
  {${WALL_UV_COMMON}
    vec2 f3dP = vF3dWorld.xz;
    if (vF3dNormal.y < 0.5) {
      float f3dSide = clamp(dot(f3dRel, f3dSideN), -0.05, 0.05);
      f3dP = f3dO.xz + f3dDir * f3dAlong + f3dSideN * f3dSide;
    }
    vMapUv = vec2((f3dP.x - f3dMapMin.x) / f3dMapSize.x, 1.0 - (f3dP.y - f3dMapMin.y) / f3dMapSize.y);
  }
  #endif`;
// "texture": world-space tiling (faces: along the wall x height; top: x/z).
const WALL_TEX_VERTEX = `
  #ifdef USE_MAP
  {${WALL_UV_COMMON}
    if (vF3dNormal.y > 0.5) vMapUv = vF3dWorld.xz * f3dTile;
    else vMapUv = vec2(dot(vF3dWorld.xz, f3dDir), vF3dWorld.y) * f3dTile;
  }
  #endif`;

export class View3D {
  /**
   * @param {HTMLElement} container  element the canvas is appended to (sized by CSS)
   * @param {object} options         see DEFAULTS
   */
  constructor(container, options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.container = container;
    this.model = null;
    this.grid = null;
    this.heights = null;
    this.walls = new Map(); // id -> { data, object, mesh, center, height, cut, door? } (drawn walls)
    this.allWalls = new Map(); // id -> wallData for every wall, drawn or not
    this.tokens = new Map(); // id -> standee entry
    this.tiles = new Map(); // id -> { data, group, mesh, overhead, opacity }
    this.levelFloors = []; // [{ index, mesh }]
    this.levelCutoff = Infinity;
    this.lights = [];
    this.darkness = 0;
    this.roofFocus = []; // canvas points; roofs above them fade out
    this.textureCache = new Map();
    this.effects = new Map(); // id -> { mesh, texture } (mirrored canvas animations, e.g. Sequencer)
    this.activeTokenId = null; // combatant whose turn it is
    this.onFrame = null; // callback(dt) before each render (the adapter syncs effects here)
    this._pan = null;
    this.topDown = false;
    this._saved = null;
    this._disposed = false;
    this._lightTimer = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: !!options.preserveDrawingBuffer });
    this.renderer.setPixelRatio(this.options.pixelRatio);
    this.renderer.domElement.classList.add("f3d-canvas");
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.perspCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
    // Tactics camera: parallel projection, so the map keeps its proportions like a classic SRPG.
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 4000);
    this.orthoHeight = 14; // squares visible vertically at zoom 1
    this.camera = this.perspCamera;
    this.cameraMode = "free";
    this._rotAnim = null;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false; // pan across the ground plane
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
    this.controls.minDistance = 2;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404050, 1.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-0.6, 1, 0.35);
    this.scene.add(this.hemi, this.sun);
    // Fixed pool so the shader light count never changes (no recompiles while lights move).
    this.lightPool = [];
    for (let i = 0; i < this.options.maxLights; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 1, 1);
      this.scene.add(pl);
      this.lightPool.push(pl);
    }

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.wallGroup = new THREE.Group();
    this.tokenGroup = new THREE.Group();
    this.tileGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();
    this.world.add(this.wallGroup, this.tileGroup, this.tokenGroup, this.overlayGroup);

    // Fog of war: one texel per grid square, shared by every fog-aware material.
    this.fogUniforms = {
      f3dLightMap: { value: null },
      f3dColorMap: { value: null },
      f3dLightOn: { value: 0 },
      f3dUnlit: { value: 1 },
      f3dFogMap: { value: null },
      f3dFogOn: { value: 0 },
      f3dFogMin: { value: new THREE.Vector2() },
      f3dFogSize: { value: new THREE.Vector2(1, 1) },
    };

    this.materials = {
      wall: this._fogged(new THREE.MeshLambertMaterial({ color: 0x8a8580, vertexColors: true }), "dilate"),
      door: this._fogged(new THREE.MeshLambertMaterial({ color: 0x8b5a2b }), "dilate"),
      secretDoor: this._fogged(new THREE.MeshLambertMaterial({ color: 0x7d6a8c }), "dilate"),
      gridLine: this._fogged(new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 })),
      hover: new THREE.LineBasicMaterial({ color: 0xffe066 }),
      ruler: new THREE.LineBasicMaterial({ color: 0xffe066, depthTest: false, transparent: true }),
      ring: new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }),
    };
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.boxGeometry.translate(0, 0.5, 0); // origin at the bottom face
    // Plain walls share one InstancedMesh (a single draw call); the top face is darker through
    // vertex colours so no second material is needed.
    this.wallGeometry = this.boxGeometry.clone();
    const nrm = this.wallGeometry.attributes.normal;
    const vc = new Float32Array(nrm.count * 3);
    for (let i = 0; i < nrm.count; i++) vc.fill(nrm.getY(i) > 0.5 ? 0.62 : 1, i * 3, i * 3 + 3);
    this.wallGeometry.setAttribute("color", new THREE.BufferAttribute(vc, 3));
    this.wallBatches = new Map(); // material key -> { mesh, capacity, ids, key }
    this.wallMaterials = new Map(); // material key -> material ("map", "tex:<src>")
    this.wallUniforms = {
      f3dMapMin: { value: new THREE.Vector2() },
      f3dMapSize: { value: new THREE.Vector2(1, 1) },
      f3dTile: { value: 1 / (this.options.wallTextureScale || 1) },
    };
    this.planeGeometry = new THREE.PlaneGeometry(1, 1);
    this.planeGeometry.rotateX(-Math.PI / 2); // lying flat, facing up
    this.ringGeometry = new THREE.RingGeometry(0.47, 0.56, 40);
    this.ringGeometry.rotateX(-Math.PI / 2);

    this.rulerLabel = document.createElement("div");
    this.rulerLabel.className = "f3d-ruler-label";
    this.rulerLabel.style.display = "none";
    container.appendChild(this.rulerLabel);

    this.raycaster = new THREE.Raycaster();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();

    this._last = performance.now();
    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  /**
   * Inject the fog-of-war lookup into a built-in material's shaders.
   * @param {false|"strict"|"dilate"} [hideUnseen]  discard (instead of blacken) where never seen, so
   *   unexplored geometry neither leaks layout nor blocks the view. "dilate" (walls) keeps geometry
   *   next to seen squares; "strict" (roofs, upper floors) only over seen squares.
   */
  _fogged(material, hideUnseen = false, extra = null) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.fogUniforms, extra?.uniforms ?? {});
      // Basic/line materials only declare objectNormal under some defines; Lambert always does.
      const hasNormal = !!material.isMeshLambertMaterial;
      shader.vertexShader = FOG_VERTEX_PARS + shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vF3dWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vF3dNormal = ${hasNormal ? "normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal)" : "vec3(0.0, 1.0, 0.0)"};
        #else
          vF3dWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vF3dNormal = ${hasNormal ? "normalize(mat3(modelMatrix) * objectNormal)" : "vec3(0.0, 1.0, 0.0)"};
        #endif
        ${extra?.vertex ?? ""}`,
      );
      if (extra?.pars) shader.vertexShader = extra.pars + shader.vertexShader;
      shader.fragmentShader = FOG_FRAGMENT_PARS + shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\n" +
          (hideUnseen ? `  if (f3dFogOn > 0.5 && ${hideUnseen === "dilate" ? "f3dFogCellDilated" : "f3dFogCell"}() < 0.04) discard;\n` : "") +
          "  gl_FragColor.rgb = f3dApplyFog(f3dApplyLight(gl_FragColor.rgb));",
      );
    };
    material.customProgramCacheKey = () => `f3d-fog-${hideUnseen || "show"}-${extra?.key ?? ""}`;
    return material;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Scene building                                                                           */
  /* ---------------------------------------------------------------------------------------- */

  /** Full (re)build from a model. */
  async load(model) {
    this.clear();
    this.model = model;
    this.grid = model.grid.cols !== undefined ? model.grid : makeGrid(model.grid);
    this.heights = normalizeHeightMap(model.heights, this.grid.cols, this.grid.rows);
    // Foundry's default scene colour is a light grey: darken it so the 3D "sky" stays unobtrusive.
    this.scene.background = new THREE.Color(model.backgroundColor ?? "#1b1b1f").multiplyScalar(0.08);
    const g = this.grid;

    // Fog texture sized to the grid.
    const fogData = new Uint8Array(g.cols * g.rows).fill(this.options.startHidden ? 0 : 255);
    const fogTex = new THREE.DataTexture(fogData, g.cols, g.rows, THREE.RedFormat, THREE.UnsignedByteType);
    fogTex.magFilter = THREE.LinearFilter;
    fogTex.minFilter = THREE.LinearFilter;
    fogTex.needsUpdate = true;
    this.fogUniforms.f3dFogMap.value?.dispose();
    this.fogUniforms.f3dFogMap.value = fogTex;
    this._ensureLightTextures(g.cols, g.rows);
    this.fogUniforms.f3dLightOn.value = 0;
    this.lightMapOn = false;
    const min = canvasToWorld(g, g.sceneX, g.sceneY);
    this.fogUniforms.f3dFogMin.value.set(min.x, min.z);
    this.fogUniforms.f3dFogSize.value.set(g.cols, g.rows);
    this.fogUniforms.f3dFogOn.value = this.options.startHidden ? 1 : 0;

    // Padding ground (outside the scene rect), slightly below 0 to avoid z-fighting.
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(g.width / g.size, g.height / g.size),
      this._fogged(new THREE.MeshLambertMaterial({ color: new THREE.Color(model.backgroundColor ?? "#1b1b1f").multiplyScalar(0.8) })),
    );
    pad.rotation.x = -Math.PI / 2;
    const padCenter = canvasToWorld(g, g.width / 2, g.height / 2);
    pad.position.set(padCenter.x, -0.02, padCenter.z);
    this.padMesh = pad;
    this.world.add(pad);

    this.bgTexture = model.background?.src ? await this.loadTexture(model.background.src).catch((e) => {
      console.warn("foundry-3d-view | background failed to load", e);
      return null;
    }) : null;
    if (this._disposed) return;
    const bgr = model.background ?? { x: g.sceneX, y: g.sceneY, width: g.sceneWidth, height: g.sceneHeight };
    const bgMin = canvasToWorld(g, bgr.x, bgr.y);
    this.wallUniforms.f3dMapMin.value.set(bgMin.x, bgMin.z);
    this.wallUniforms.f3dMapSize.value.set(bgr.width / g.size, bgr.height / g.size);
    this.terrainMaterials = [
      this._fogged(new THREE.MeshLambertMaterial({ map: this.bgTexture, color: this.bgTexture ? 0xffffff : 0x556b2f })),
      this._fogged(new THREE.MeshLambertMaterial({ map: this.bgTexture, color: this.bgTexture ? 0x9a9a9a : 0x3b4a20 })),
    ];
    this._buildTerrain();
    await this._buildLevelFloors(model.levels ?? []);

    for (const w of model.walls ?? []) this.upsertWall(w);
    await Promise.all([
      ...(model.tokens ?? []).map((t) => this.upsertToken(t, { snap: true })),
      ...(model.tiles ?? []).map((t) => this.upsertTile(t)),
    ]);
    this.setLights(model.lights ?? [], model.darkness ?? 0);
    // v14: show the viewed level and the ones below it (Foundry redraws on level change).
    this.setLevelCutoff(Number.isInteger(model.viewedLevelIndex) ? model.viewedLevelIndex : Infinity);
    if (this.options.cameraMode === "tactics") this.setCameraMode("tactics");
    this.resetCamera();
  }

  clear() {
    for (const id of [...this.walls.keys()]) this.removeWall(id);
    this.allWalls.clear();
    for (const b of this.wallBatches.values()) {
      b.mesh.removeFromParent();
      b.mesh.dispose();
    }
    this.wallBatches.clear();
    for (const [key, m] of this.wallMaterials) {
      if (key.startsWith("tex:")) m.map?.dispose?.(); // "map" shares the background texture
      m.dispose();
    }
    this.wallMaterials.clear();
    for (const id of [...this.tokens.keys()]) this.removeToken(id);
    for (const id of [...this.tiles.keys()]) this.removeTile(id);
    for (const f of this.levelFloors) {
      f.mesh.removeFromParent();
      f.mesh.material.dispose();
    }
    this.levelFloors = [];
    for (const obj of [this.terrainMesh, this.gridLines, this.padMesh, this.hoverLine, this.rulerLine]) {
      if (!obj) continue;
      obj.removeFromParent();
      obj.geometry?.dispose();
    }
    this.padMesh?.material?.dispose();
    this.terrainMesh = this.gridLines = this.padMesh = this.hoverLine = this.rulerLine = null;
    this.terrainMaterials?.forEach((m) => m.dispose());
  }

  _buildTerrain() {
    if (this.terrainMesh) {
      this.terrainMesh.removeFromParent();
      this.terrainMesh.geometry.dispose();
    }
    if (this.gridLines) {
      this.gridLines.removeFromParent();
      this.gridLines.geometry.dispose();
      this.gridLines = null;
    }
    const arr = buildTerrainArrays(this.heights, this.grid, this.model.background ?? {
      x: this.grid.sceneX, y: this.grid.sceneY, width: this.grid.sceneWidth, height: this.grid.sceneHeight,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr.positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(arr.normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(arr.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(arr.indices, 1));
    for (const gr of arr.groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
    geo.computeBoundingSphere();
    this.terrainMesh = new THREE.Mesh(geo, this.terrainMaterials);
    this.terrainMesh.name = "terrain";
    this.world.add(this.terrainMesh);

    if (this.options.showGrid) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.BufferAttribute(buildGridLines(this.heights, this.grid), 3));
      this.gridLines = new THREE.LineSegments(lg, this.materials.gridLine);
      this.world.add(this.gridLines);
    }
  }

  /** Upper levels (index >= 1) are flat floors textured with the level's background. */
  async _buildLevelFloors(levels) {
    const g = this.grid;
    for (let i = 1; i < levels.length; i++) {
      const lv = levels[i];
      const src = lv.background?.src;
      const tex = src ? await this.loadTexture(src).catch(() => null) : null;
      if (!tex) continue;
      const mat = this._fogged(new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5 }), "strict");
      const mesh = new THREE.Mesh(this.planeGeometry, mat);
      const bg = lv.background;
      const c = canvasToWorld(g, (bg.x ?? g.sceneX) + (bg.width ?? g.sceneWidth) / 2, (bg.y ?? g.sceneY) + (bg.height ?? g.sceneHeight) / 2);
      mesh.position.set(c.x, levelFloorY(lv, g), c.z);
      mesh.scale.set((bg.width ?? g.sceneWidth) / g.size, 1, (bg.height ?? g.sceneHeight) / g.size);
      mesh.userData.levelIndex = i;
      mesh.name = "levelFloor";
      this.world.add(mesh);
      this.levelFloors.push({ index: i, mesh });
    }
    this._applyLevelCutoff();
  }

  /** Replace terrain heights; walls, tokens and tiles are re-seated. */
  setHeights(heights) {
    if (!this.grid) return;
    const next = normalizeHeightMap(heights, this.grid.cols, this.grid.rows);
    if (heightMapsEqual(next, this.heights)) return;
    this.heights = next;
    this._buildTerrain();
    // Snapshot first: upsertWall re-inserts keys, which a live Map iterator would visit forever.
    for (const w of [...this.allWalls.values()]) this.upsertWall(w);
    for (const [, t] of this.tokens) this._placeToken(t, false);
    for (const t of [...this.tiles.values()].map((e) => e.data)) this.upsertTile(t);
  }

  getHeights() {
    return this.heights;
  }

  /** Terrain height (world Y) of a canvas point on the base level. */
  terrainYAt(px, py) {
    const g = this.grid;
    const col = Math.floor((px - g.sceneX) / g.size);
    const row = Math.floor((py - g.sceneY) / g.size);
    return unitsToWorldY(g, getHeight(this.heights, col, row));
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Levels                                                                                   */
  /* ---------------------------------------------------------------------------------------- */

  /** Show only levels with index <= `index` (Infinity = all). */
  setLevelCutoff(index) {
    this.levelCutoff = index ?? Infinity;
    this._applyLevelCutoff();
  }

  _levelVisible(i) {
    return (i ?? 0) <= this.levelCutoff;
  }

  _applyLevelCutoff() {
    for (const f of this.levelFloors) f.mesh.visible = this._levelVisible(f.index);
    for (const [, w] of this.walls) {
      if (w.instanced) this._writeWallMatrix(w);
      else w.object.visible = this._levelVisible(w.data.levelIndex);
    }
    for (const [, t] of this.tiles) t.levelHidden = !this._levelVisible(t.data.levelIndex);
    for (const [, t] of this.tokens) t.levelHidden = !this._levelVisible(t.data.levelIndex);
    for (const [, t] of this.tokens) this._applyTokenVisible(t);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Walls & doors                                                                            */
  /* ---------------------------------------------------------------------------------------- */

  _wallBase(w) {
    const li = w.levelIndex ?? 0;
    if (li > 0 && this.model?.levels?.[li]) return levelFloorY(this.model.levels[li], this.grid);
    return unitsToWorldY(this.grid, wallBaseHeight(this.heights, this.grid, w.c));
  }

  upsertWall(w) {
    this.allWalls.set(w.id, w); // every wall, drawn or not, so style changes can bring them back
    const existing = this.walls.get(w.id);
    if (!isRenderableWall(w, { invisible: this.options.invisibleWalls })) {
      if (existing) this._dropWall(w.id);
      return;
    }
    const lv = this.options.useLevelHeight ? this.model?.levels?.[w.levelIndex ?? 0] : null;
    const opts = { height: this.options.wallHeight, base: this._wallBase(w), level: lv ? { bottom: lv.bottom, top: lv.top } : null };
    const asDoor = isDoor(w) && showAsDoor(w, this.options.isGM);
    const key = wallMaterialKey(w, {
      mode: this.options.wallMode,
      wallTexture: this.options.wallTexture,
      doorTexture: this.options.doorTexture,
      windowTexture: this.options.windowTexture,
      asDoor,
      hasMap: !!this.bgTexture,
    });
    const doorMat = this._wallMaterial(key);
    const isGlass = w.kind === WALL_KIND.INVISIBLE;
    const isWindow = w.kind === WALL_KIND.WINDOW && this.options.windowOpenings;

    // Doors keep their object so the swing can animate; anything else is rebuilt (cheap).
    if (existing && existing.door && asDoor) {
      existing.data = w;
      const pose = doorPose(w, this.grid, opts);
      existing.door.pivot.position.set(pose.hx, pose.bottom, pose.hz);
      existing.height = pose.top - pose.bottom;
      existing.mesh.scale.set(pose.length, existing.height * existing.cut, this.options.wallThickness * 0.7);
      existing.mesh.position.x = pose.length / 2;
      existing.mesh.material = doorMat;
      existing.materialKey = key;
      existing.door.target = pose.angle;
      existing.object.visible = this._levelVisible(w.levelIndex);
      return;
    }
    const cut = existing?.cut ?? 1;
    if (!asDoor && !isGlass && !isWindow && existing?.instanced && existing.batchKey === key) {
      // Reuse the instance slot.
      const box = wallBox(w, this.grid, { ...opts, thickness: this.options.wallThickness });
      Object.assign(existing, { data: w, box, height: box.top - box.bottom, center: { x: box.cx, z: box.cz } });
      this._writeWallMatrix(existing);
      return;
    }
    if (existing) this._dropWall(w.id);

    let entry;
    if (asDoor) {
      const pose = doorPose(w, this.grid, opts);
      const pivot = new THREE.Group();
      pivot.position.set(pose.hx, pose.bottom, pose.hz);
      pivot.rotation.y = pose.angle;
      const mesh = new THREE.Mesh(this.boxGeometry, doorMat);
      const height = pose.top - pose.bottom;
      mesh.scale.set(pose.length, height * cut, this.options.wallThickness * 0.7);
      mesh.position.x = pose.length / 2;
      mesh.userData.wallId = w.id;
      mesh.userData.isDoor = true;
      pivot.add(mesh);
      this.wallGroup.add(pivot);
      const box = wallBox(w, this.grid, opts);
      entry = { data: w, object: pivot, mesh, height, cut, materialKey: key, center: { x: box.cx, z: box.cz }, door: { pivot, target: pose.angle } };
    } else if (isGlass) {
      // Invisible wall: a see-through panel so it still has volume in 3D.
      const box = wallBox(w, this.grid, { ...opts, thickness: this.options.wallThickness * 0.5 });
      const gkey = glassMaterialKey(w, { glassTexture: this.options.glassTexture });
      const mesh = new THREE.Mesh(this.boxGeometry, this._wallMaterial(gkey));
      const height = box.top - box.bottom;
      mesh.position.set(box.cx, box.bottom, box.cz);
      mesh.rotation.y = box.angle;
      mesh.scale.set(box.length, height * cut, box.thickness);
      mesh.renderOrder = 3;
      mesh.userData.wallId = w.id;
      this.wallGroup.add(mesh);
      entry = { data: w, object: mesh, mesh, height, cut, materialKey: gkey, center: { x: box.cx, z: box.cz } };
    } else if (isWindow) {
      // Window: solid below the sill and above the lintel, a glass pane in the opening.
      const box = wallBox(w, this.grid, { ...opts, thickness: this.options.wallThickness });
      const height = box.top - box.bottom;
      const sec = windowSections(0, height);
      const group = new THREE.Group();
      group.position.set(box.cx, box.bottom, box.cz);
      group.rotation.y = box.angle;
      const part = (s, mat, thick) => {
        const m = new THREE.Mesh(this.boxGeometry, mat);
        m.position.y = s.bottom;
        m.scale.set(box.length + (thick === box.thickness ? box.thickness : 0), s.top - s.bottom, thick);
        m.userData.wallId = w.id;
        group.add(m);
        return m;
      };
      const solid = this._wallMaterial(key);
      const gkey = glassMaterialKey(w, { glassTexture: this.options.glassTexture });
      part(sec.lower, solid, box.thickness);
      part(sec.upper, solid, box.thickness);
      const pane = part(sec.glass, this._wallMaterial(gkey), box.thickness * 0.3);
      pane.renderOrder = 3;
      group.scale.y = cut;
      this.wallGroup.add(group);
      entry = {
        data: w, object: group, mesh: group, height, cut, materialKey: key, isWindow: true,
        center: { x: box.cx, z: box.cz }, applyCut: (c) => (group.scale.y = c),
      };
    } else {
      const box = wallBox(w, this.grid, { ...opts, thickness: this.options.wallThickness });
      const batch = this._ensureWallBatch(key, this._wallCount(key) + 1);
      const slot = batch.mesh.count++;
      batch.ids[slot] = w.id;
      entry = { data: w, instanced: true, batchKey: key, slot, box, height: box.top - box.bottom, cut, center: { x: box.cx, z: box.cz } };
      this.walls.set(w.id, entry);
      this._writeWallMatrix(entry);
      return;
    }
    entry.object.visible = this._levelVisible(w.levelIndex);
    this.walls.set(w.id, entry);
  }

  /** The wall was deleted from the scene. */
  removeWall(id) {
    this.allWalls.delete(id);
    this._dropWall(id);
  }

  /** Remove a wall's 3D object (it may come back on the next upsert). */
  _dropWall(id) {
    const w = this.walls.get(id);
    if (!w) return;
    this.walls.delete(id);
    if (!w.instanced) {
      w.object.removeFromParent();
      return;
    }
    // Swap-remove: move the last instance into the freed slot.
    const batch = this.wallBatches.get(w.batchKey);
    if (!batch) return;
    const mesh = batch.mesh;
    const last = mesh.count - 1;
    if (w.slot !== last) {
      mesh.getMatrixAt(last, _m);
      mesh.setMatrixAt(w.slot, _m);
      const movedId = batch.ids[last];
      batch.ids[w.slot] = movedId;
      const moved = this.walls.get(movedId);
      if (moved) moved.slot = w.slot;
    }
    batch.ids.length = last;
    mesh.count = last;
    mesh.instanceMatrix.needsUpdate = true;
  }

  _wallCount(key) {
    return this.wallBatches.get(key)?.mesh.count ?? 0;
  }

  /**
   * Material for a wall/door material key (see wallMaterialKey). "map" and "tex:" materials are
   * created on demand and shared by every wall using them.
   */
  _wallMaterial(key) {
    if (key === "flat") return this.materials.wall;
    if (key === "door") return this.materials.door;
    if (key === "secretDoor") return this.materials.secretDoor;
    let mat = this.wallMaterials.get(key);
    if (mat) return mat;
    if (key === "map") {
      mat = this._fogged(new THREE.MeshLambertMaterial({ map: this.bgTexture, color: 0xd8d8d8 }), "dilate",
        { key: "map", pars: WALL_UV_PARS, uniforms: this.wallUniforms, vertex: WALL_MAP_VERTEX });
    } else if (key === "glass" || key.startsWith("glass:")) {
      // See-through panels (invisible walls, window panes). A texture keeps its own alpha.
      const src = key.startsWith("glass:") ? key.slice(6) : null;
      mat = this._fogged(new THREE.MeshLambertMaterial({
        color: src ? 0xffffff : 0xbfe3ff, transparent: true, opacity: src ? 0.9 : 0.28,
        depthWrite: false, side: THREE.DoubleSide,
      }), "dilate", src ? { key: "tex", pars: WALL_UV_PARS, uniforms: this.wallUniforms, vertex: WALL_TEX_VERTEX } : null);
      if (src) this._loadWallTexture(key, mat, src);
    } else {
      const src = key.slice(4);
      mat = this._fogged(new THREE.MeshLambertMaterial({ color: 0xffffff }), "dilate",
        { key: "tex", pars: WALL_UV_PARS, uniforms: this.wallUniforms, vertex: WALL_TEX_VERTEX });
      this._loadWallTexture(key, mat, src);
    }
    this.wallMaterials.set(key, mat);
    return mat;
  }

  /** Load a tiling texture into a cached wall material. */
  _loadWallTexture(key, mat, src) {
    let resolved = src;
    try {
      resolved = this.options.resolveSrc(src) ?? src;
    } catch {
      /* keep the raw path */
    }
    this.loadTexture(resolved).then((tex) => {
      if (this.wallMaterials.get(key) !== mat) return;
      // Tiling needs repeat wrapping; clone so a texture shared with tokens/tiles keeps clamping.
      const t = tex.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      mat.map = t;
      mat.needsUpdate = true;
    }).catch((e) => console.warn("foundry-3d-view | wall texture failed", src, e));
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Combat & HUD helpers                                                                     */
  /* ---------------------------------------------------------------------------------------- */

  /** Smoothly move the camera so it looks at a canvas point (keeps angle and zoom). */
  panToCanvasPoint(px, py) {
    if (!this.grid) return;
    const w = canvasToWorld(this.grid, px, py);
    this._pan = new THREE.Vector3(w.x, this.controls.target.y, w.z);
  }

  /** Green pulsing ring under the token whose turn it is (null clears it). */
  setActiveToken(id) {
    this.activeTokenId = id ?? null;
    if (!this.activeRing) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
      this.activeRing = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.7, 48).rotateX(-Math.PI / 2), mat);
      this.activeRing.renderOrder = 4;
      this.activeRing.userData.r = 1;
    }
    const entry = id ? this.tokens.get(id) : null;
    this.activeRing.removeFromParent();
    this.activeRing.visible = !!entry;
    if (entry) {
      const t = entry.data;
      this.activeRing.userData.r = Math.max(t.width, t.height);
      this.activeRing.position.set(0, 0.08, 0);
      entry.group.add(this.activeRing);
    }
  }

  /** Screen rectangle (client px) around a token's standee, or null when not shown. */
  tokenScreenRect(id) {
    const entry = this.tokens.get(id);
    if (!entry || !entry.group.visible) return null;
    this.camera.updateMatrixWorld();
    entry.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(entry.group);
    const r = this.renderer.domElement.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(this.camera);
      const sx = r.left + ((p.x + 1) / 2) * r.width, sy = r.top + ((1 - p.y) / 2) * r.height;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Mirrored canvas effects (combat animations)                                              */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * Show an effect in 3D. `source` is the element the 2D effect plays (video, image or canvas),
   * so the 3D copy stays in sync with it.
   */
  addEffect(id, source) {
    this.removeEffect(id);
    let texture;
    if (source instanceof HTMLVideoElement) texture = new THREE.VideoTexture(source);
    else if (source instanceof HTMLCanvasElement) texture = new THREE.CanvasTexture(source);
    else texture = new THREE.Texture(source);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.planeGeometry, mat);
    mesh.renderOrder = 6;
    mesh.visible = false;
    this.overlayGroup.add(mesh);
    this.effects.set(id, { mesh, texture, source });
    return true;
  }

  /**
   * Place an effect: canvas centre, size (px), rotation (radians, clockwise on screen), opacity,
   * optional texture frame (for sprite sheets) and elevation (units).
   */
  updateEffect(id, { x, y, width, height, rotation = 0, alpha = 1, visible = true, frame = null, elevation = 0 }) {
    const fx = this.effects.get(id);
    if (!fx || !this.grid) return;
    const g = this.grid;
    const w = canvasToWorld(g, x, y);
    const ground = Math.max(this.terrainYAt(x, y), unitsToWorldY(g, elevation));
    fx.mesh.position.set(w.x, ground + 0.35, w.z);
    fx.mesh.rotation.set(0, -rotation, 0);
    fx.mesh.scale.set(Math.max(0.01, width / g.size), 1, Math.max(0.01, height / g.size));
    fx.mesh.material.opacity = alpha;
    fx.mesh.visible = visible && alpha > 0.01;
    if (frame) {
      fx.texture.repeat.set(frame.w, frame.h);
      fx.texture.offset.set(frame.x, 1 - frame.y - frame.h);
    }
    if (!(fx.source instanceof HTMLVideoElement)) fx.texture.needsUpdate = fx.source instanceof HTMLCanvasElement;
  }

  removeEffect(id) {
    const fx = this.effects.get(id);
    if (!fx) return;
    fx.mesh.removeFromParent();
    fx.mesh.material.dispose();
    fx.texture.dispose();
    this.effects.delete(id);
  }

  /** Sprite facing mode (see SPRITE_FACING). */
  setSpriteFacing(mode) {
    this.options.spriteFacing = Object.values(SPRITE_FACING).includes(mode) ? mode : SPRITE_FACING.CAMERA;
  }

  /** Change how walls look and rebuild them. */
  setWallStyle({ wallMode, wallTexture, doorTexture, wallTextureScale, windowTexture, glassTexture, invisibleWalls, windowOpenings, useLevelHeight } = {}) {
    if (windowTexture !== undefined) this.options.windowTexture = windowTexture || "";
    if (glassTexture !== undefined) this.options.glassTexture = glassTexture || "";
    if (invisibleWalls !== undefined) this.options.invisibleWalls = invisibleWalls;
    if (windowOpenings !== undefined) this.options.windowOpenings = !!windowOpenings;
    if (useLevelHeight !== undefined) this.options.useLevelHeight = !!useLevelHeight;
    if (wallMode !== undefined) this.options.wallMode = wallMode;
    if (wallTexture !== undefined) this.options.wallTexture = wallTexture || "";
    if (doorTexture !== undefined) this.options.doorTexture = doorTexture || "";
    if (wallTextureScale !== undefined) this.options.wallTextureScale = Number(wallTextureScale) || 1;
    this.wallUniforms.f3dTile.value = 1 / (this.options.wallTextureScale || 1);
    const all = [...this.allWalls.values()];
    for (const w of all) this._dropWall(w.id);
    for (const w of all) this.upsertWall(w);
  }

  /** Material key a wall is drawn with (for tests/debugging). */
  wallMaterialKeyOf(id) {
    const w = this.walls.get(id);
    return w ? (w.instanced ? w.batchKey : w.materialKey) : null;
  }

  /** Make sure the InstancedMesh for a material key can hold `min` walls (grows by doubling). */
  _ensureWallBatch(key, min) {
    const cur = this.wallBatches.get(key);
    if (cur && cur.capacity >= min) return cur;
    const capacity = Math.max(64, min, (cur?.capacity ?? 0) * 2);
    const mesh = new THREE.InstancedMesh(this.wallGeometry, this._wallMaterial(key), capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = "walls";
    mesh.userData.isWallBatch = true;
    mesh.count = 0;
    const batch = { mesh, capacity, ids: [], key };
    if (cur) {
      for (let i = 0; i < cur.mesh.count; i++) {
        cur.mesh.getMatrixAt(i, _m);
        mesh.setMatrixAt(i, _m);
      }
      mesh.count = cur.mesh.count;
      batch.ids = cur.ids;
      cur.mesh.removeFromParent();
      cur.mesh.dispose();
    }
    this.wallGroup.add(mesh);
    this.wallBatches.set(key, batch);
    return batch;
  }

  /** Write one wall's instance matrix (level visibility and cutaway included). */
  _writeWallMatrix(entry) {
    const b = entry.box;
    const show = this._levelVisible(entry.data.levelIndex);
    _p.set(b.cx, b.bottom, b.cz);
    _q.setFromAxisAngle(_up, b.angle);
    // Slight overlap at the ends hides cracks at corners.
    if (show) _s.set(b.length + b.thickness, entry.height * entry.cut, b.thickness);
    else _s.set(0, 0, 0);
    _m.compose(_p, _q, _s);
    const batch = this.wallBatches.get(entry.batchKey);
    batch.mesh.setMatrixAt(entry.slot, _m);
    batch.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Is a wall currently drawn (level filter)? */
  isWallShown(id) {
    const w = this.walls.get(id);
    if (!w) return false;
    return w.instanced ? this._levelVisible(w.data.levelIndex) : w.object.visible;
  }

  /** Lower walls between the camera and its target (tactics cutaway). */
  setCutaway(on) {
    this.options.cutaway = !!on;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Tokens (paper standees)                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  async upsertToken(t, { snap = false } = {}) {
    let entry = this.tokens.get(t.id);
    if (!entry) {
      entry = this._createStandee(t);
      this.tokens.set(t.id, entry);
      snap = true;
    }
    const artKey = (d) => `${d?.src}|${d?.sheet ? JSON.stringify(d.sheet) : ""}`;
    const srcChanged = artKey(entry.data) !== artKey(t) || !entry.textureApplied;
    entry.data = t;
    entry.levelHidden = !this._levelVisible(t.levelIndex);
    this._applyTokenVisible(entry);
    this._placeToken(entry, snap);
    if (srcChanged) await this._applyTokenTexture(entry);
  }

  _createStandee(t) {
    const group = new THREE.Group(); // at the token's foot position
    const yaw = new THREE.Group(); // rotates with the camera (screen-aligned billboard)
    const pivot = new THREE.Group(); // tilts the card back when looking from above
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this._fogged(new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, color: 0xffffff })),
    );
    card.geometry.translate(0, 0.5, 0); // pivot at the bottom edge
    card.userData.tokenId = t.id;
    pivot.add(card);
    yaw.add(pivot);
    const color = DISPOSITION_COLORS[String(t.disposition ?? 0)] ?? 0xd4ac0d;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.45, 0.06, 32),
      this._fogged(new THREE.MeshLambertMaterial({ color, transparent: true })),
    );
    base.position.y = 0.03;
    base.userData.tokenId = t.id;
    const ring = new THREE.Mesh(this.ringGeometry, this.materials.ring);
    ring.position.y = 0.075;
    ring.visible = false;
    group.add(base, ring, yaw);
    this.tokenGroup.add(group);
    return {
      data: t, group, yaw, pivot, card, base, ring, target: new THREE.Vector3(),
      allowed: !this.options.startHidden, levelHidden: false, textureApplied: false,
    };
  }

  async _applyTokenTexture(entry) {
    const sheet = entry.data.sheet;
    const src = sheet?.src || entry.data.src;
    let tex = null;
    if (src) {
      try {
        tex = await this.loadTexture(src);
      } catch (e) {
        console.warn("foundry-3d-view | token texture failed", src, e);
      }
    }
    if (this._disposed || (entry.data.sheet?.src || entry.data.src) !== src) return;
    entry.sheetTex?.dispose();
    entry.sheetTex = null;
    if (tex && sheet && (sheet.directions > 1 || sheet.frames > 1)) {
      // Own copy so this token can show its own cell of the sheet.
      tex = tex.clone();
      tex.needsUpdate = true;
      entry.sheetTex = tex;
      entry.sheetRow = entry.sheetCol = -1;
      entry.phase = Math.random() * 10; // tokens don't animate in lockstep
    }
    entry.card.material.map = tex;
    entry.card.material.color.set(tex ? 0xffffff : 0x999999);
    entry.card.material.needsUpdate = true;
    entry.textureApplied = true;
    this._sizeCard(entry);
  }

  _sizeCard(entry) {
    const t = entry.data;
    const img = entry.card.material.map?.image;
    let aspect = img && img.width ? (img.videoHeight || img.height) / (img.videoWidth || img.width) : 1;
    // A sheet cell is (height / directions) by (width / frames).
    if (entry.sheetTex && t.sheet) aspect *= t.sheet.frames / t.sheet.directions;
    const w = t.width * t.scaleX;
    entry.card.scale.set(w * (t.mirrorX ? -1 : 1), w * aspect * (t.scaleY / t.scaleX), 1);
    entry.card.position.y = 0.06;
    const r = Math.max(t.width, t.height) * 0.45;
    entry.base.scale.set(r / 0.45, 1, r / 0.45);
    entry.ring.scale.set(r / 0.45, 1, r / 0.45);
  }

  /** Compute the world target position of a token from its data and the terrain. */
  _placeToken(entry, snap) {
    const t = entry.data;
    const g = this.grid;
    const c = tokenCenter(g, t);
    const li = t.levelIndex ?? 0;
    const terrain = li > 0 ? 0 : maxHeightUnderRect(this.heights, g, t.x, t.y, t.width * g.size, t.height * g.size);
    const footUnits = Math.max(terrain, t.elevation ?? 0);
    const w = canvasToWorld(g, c.x, c.y);
    entry.target.set(w.x, unitsToWorldY(g, footUnits), w.z);
    if (snap) entry.group.position.copy(entry.target);
    this._sizeCard(entry);
  }

  /** Live position update (canvas px top-left, like Foundry token x/y). */
  moveToken(id, { x, y, elevation } = {}, { snap = false } = {}) {
    const entry = this.tokens.get(id);
    if (!entry) return;
    entry.data = { ...entry.data, ...(x !== undefined && { x }), ...(y !== undefined && { y }), ...(elevation !== undefined && { elevation }) };
    this._placeToken(entry, snap);
  }

  /**
   * @param {string} id
   * @param {boolean} visible  false hides the standee entirely
   * @param {boolean} [ghost]  true renders it semi-transparent (GM view of hidden tokens)
   */
  setTokenVisibility(id, visible, ghost = false) {
    const entry = this.tokens.get(id);
    if (!entry) return;
    entry.allowed = !!visible;
    const opacity = ghost ? 0.45 : 1;
    entry.card.material.opacity = opacity;
    entry.base.material.opacity = opacity;
    this._applyTokenVisible(entry);
  }

  _applyTokenVisible(entry) {
    entry.group.visible = entry.allowed && !entry.levelHidden;
  }

  /** Yellow selection ring under a token. */
  setTokenSelected(id, selected) {
    const entry = this.tokens.get(id);
    if (entry) entry.ring.visible = !!selected;
  }

  removeToken(id) {
    const entry = this.tokens.get(id);
    if (!entry) return;
    entry.group.removeFromParent();
    entry.card.geometry.dispose();
    entry.card.material.dispose();
    entry.base.geometry.dispose();
    entry.base.material.dispose();
    this.tokens.delete(id);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Tiles                                                                                    */
  /* ---------------------------------------------------------------------------------------- */

  async upsertTile(t) {
    const existing = this.tiles.get(t.id);
    if (existing) this.removeTile(t.id);
    if (t.model && !(t.hidden && !this.options.isGM) && t.width > 0 && t.height > 0) return this._upsertModelTile(t);
    if (!t.src || (t.hidden && !this.options.isGM) || t.width <= 0 || t.height <= 0) return;
    const g = this.grid;
    const overhead = isOverheadTile(t, this.model?.foregroundElevation);
    const li = t.levelIndex ?? 0;
    const levelY = li > 0 && this.model?.levels?.[li] ? levelFloorY(this.model.levels[li], g) : null;
    const ground = levelY ?? unitsToWorldY(g, maxHeightUnderRect(this.heights, g, t.x, t.y, t.width, t.height));
    const p = tilePlacement(t, g, { floorY: ground, roofY: ground + this.options.wallHeight, overhead });
    const mat = this._fogged(new THREE.MeshLambertMaterial({
      transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: !overhead,
      opacity: t.alpha * (t.hidden ? 0.5 : 1),
    }), overhead ? "strict" : false);
    const mesh = new THREE.Mesh(this.planeGeometry, mat);
    mesh.scale.set(p.width * (p.mirrorX ? -1 : 1), 1, p.depth * (p.mirrorY ? -1 : 1));
    const group = new THREE.Group();
    group.position.set(p.cx, p.y, p.cz);
    group.rotation.y = p.angle;
    group.add(mesh);
    mesh.renderOrder = overhead ? 2 : 1;
    this.tileGroup.add(group);
    const entry = { data: t, group, mesh, overhead, baseOpacity: mat.opacity, levelHidden: !this._levelVisible(li) };
    this.tiles.set(t.id, entry);
    try {
      const tex = await this.loadTexture(t.src);
      if (this.tiles.get(t.id) !== entry) return;
      mat.map = tex;
      mat.needsUpdate = true;
    } catch (e) {
      console.warn("foundry-3d-view | tile texture failed", t.src, e);
    }
  }

  /** A tile drawn as a 3D model filling its footprint (rotation and mirroring follow the tile). */
  async _upsertModelTile(t) {
    const g = this.grid;
    const li = t.levelIndex ?? 0;
    const levelY = li > 0 && this.model?.levels?.[li] ? levelFloorY(this.model.levels[li], g) : null;
    const ground = levelY ?? unitsToWorldY(g, maxHeightUnderRect(this.heights, g, t.x, t.y, t.width, t.height));
    const p = tilePlacement(t, g, { floorY: ground, overhead: false });
    const group = new THREE.Group();
    group.position.set(p.cx, ground, p.cz);
    group.rotation.y = p.angle;
    group.scale.set(p.width * (p.mirrorX ? -1 : 1), ((p.width + p.depth) / 2) * (t.modelHeight || 1), p.depth * (p.mirrorY ? -1 : 1));
    this.tileGroup.add(group);
    const entry = { data: t, group, mesh: null, isModel: true, overhead: false, baseOpacity: 1, levelHidden: !this._levelVisible(li) };
    this.tiles.set(t.id, entry);
    let model = null;
    try {
      if (isCustomModel(t.model)) {
        let url = t.model;
        try {
          url = this.options.resolveSrc(t.model) ?? t.model;
        } catch {
          /* raw path */
        }
        this._modelCache ??= new Map();
        if (!this._modelCache.has(url)) this._modelCache.set(url, loadCustomModel(url));
        model = (await this._modelCache.get(url)).clone(true);
      } else {
        model = createBuiltinModel(t.model);
      }
    } catch (e) {
      console.warn("foundry-3d-view | 3D model failed", t.model, e);
    }
    if (this.tiles.get(t.id) !== entry || !model) return;
    // Fog/light-aware copies of the model's materials; picking ignores props.
    model.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const fogged = mats.map((m) => this._fogged(m.clone(), "dilate"));
      o.material = Array.isArray(o.material) ? fogged : fogged[0];
    });
    group.add(model);
    entry.mesh = model;
  }

  removeTile(id) {
    const e = this.tiles.get(id);
    if (!e) return;
    e.group.removeFromParent();
    if (e.isModel) {
      // Materials are per-tile copies; geometry of custom models is shared with the cache.
      e.mesh?.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => m.dispose()));
      this.tiles.delete(id);
      return;
    }
    e.mesh.material.dispose();
    this.tiles.delete(id);
  }

  setShowRoofs(on) {
    this.options.showRoofs = !!on;
  }

  /** Canvas points (e.g. the user's tokens); roofs covering any of them fade out. */
  setRoofFocus(points) {
    this.roofFocus = points ?? [];
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Lights & darkness                                                                        */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * @param {object[]} lights  lightData()/tokenLightData() entries (canvas px, radii in units)
   * @param {number} darkness  scene darkness level 0..1
   */
  setLights(lights, darkness = this.darkness) {
    this.lights = lights ?? [];
    this.darkness = Math.min(1, Math.max(0, Number(darkness) || 0));
    this._applyAmbient();
    this._updateLights();
  }

  _applyAmbient() {
    // With a light map, darkness is applied per square (lit squares stay bright).
    const a = this.lightMapOn ? 1 : ambientForDarkness(this.darkness);
    this.hemi.intensity = 1.6 * a;
    this.sun.intensity = 1.6 * a;
    this.fogUniforms.f3dUnlit.value = unlitBrightness(this.darkness);
  }

  /** (Re)create the RGBA light and colour textures at w × h samples over the scene. */
  _ensureLightTextures(w, h) {
    const cur = this.fogUniforms.f3dLightMap.value;
    if (cur && cur.image.width === w && cur.image.height === h) return;
    const make = () => {
      const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    this.fogUniforms.f3dLightMap.value?.dispose();
    this.fogUniforms.f3dColorMap.value?.dispose();
    this.fogUniforms.f3dLightMap.value = make();
    this.fogUniforms.f3dColorMap.value = make();
  }

  _lightOff() {
    this.lightMapOn = false;
    this.lightSource = null;
    this.fogUniforms.f3dLightOn.value = 0;
    this._applyAmbient();
  }

  /**
   * Per-square lighting computed from light sources (fallback when Foundry's rendered lighting
   * can't be sampled).
   * @param {Uint8Array|null} levels  lightLevels() result (cols*rows), or null to turn it off
   * @param {{vision?:Uint8Array|null}} [o]  squares seen without light (darkvision): 1 = yes
   */
  setLightMap(levels, { vision = null } = {}) {
    if (!levels || !this.grid) return this._lightOff();
    const g = this.grid;
    this._ensureLightTextures(g.cols, g.rows);
    const unlit = unlitBrightness(this.darkness);
    const L = this.fogUniforms.f3dLightMap.value.image.data;
    const C = this.fogUniforms.f3dColorMap.value.image.data;
    const n = Math.min(levels.length, g.cols * g.rows);
    for (let i = 0; i < n; i++) {
      const f = Math.round((unlit + (1 - unlit) * Math.min(1, (levels[i] / 255) * 1.15)) * 255);
      L[i * 4] = L[i * 4 + 1] = L[i * 4 + 2] = f;
      L[i * 4 + 3] = vision && vision[i] && levels[i] < 64 ? 255 : 0;
      C[i * 4] = C[i * 4 + 1] = C[i * 4 + 2] = C[i * 4 + 3] = 0;
    }
    this.fogUniforms.f3dLightMap.value.needsUpdate = true;
    this.fogUniforms.f3dColorMap.value.needsUpdate = true;
    this.lightLevels = levels;
    this.lightMapOn = true;
    this.lightSource = "computed";
    this.fogUniforms.f3dLightOn.value = 1;
    this._applyAmbient();
  }

  /**
   * Lighting sampled from Foundry's own rendering (exactly what the 2D canvas shows).
   * @param {{w:number,h:number,illum:Uint8Array,color:Uint8Array}|null} s  RGBA samples over the scene
   */
  setSampledLighting(s) {
    if (!s || !this.grid) return this._lightOff();
    this._ensureLightTextures(s.w, s.h);
    const L = this.fogUniforms.f3dLightMap.value.image.data;
    const C = this.fogUniforms.f3dColorMap.value.image.data;
    const n = s.w * s.h;
    for (let i = 0; i < n; i++) {
      L[i * 4] = s.illum[i * 4];
      L[i * 4 + 1] = s.illum[i * 4 + 1];
      L[i * 4 + 2] = s.illum[i * 4 + 2];
      // Seen through vision but barely lit (darkvision): greys.
      const lum = (s.illum[i * 4] + s.illum[i * 4 + 1] + s.illum[i * 4 + 2]) / 3;
      L[i * 4 + 3] = s.vision?.[i] && lum < 90 ? 255 : 0;
      C[i * 4] = s.color[i * 4];
      C[i * 4 + 1] = s.color[i * 4 + 1];
      C[i * 4 + 2] = s.color[i * 4 + 2];
      C[i * 4 + 3] = 255;
    }
    this.fogUniforms.f3dLightMap.value.needsUpdate = true;
    this.fogUniforms.f3dColorMap.value.needsUpdate = true;
    this.lightSample = s;
    this.lightMapOn = true;
    this.lightSource = "foundry";
    this.fogUniforms.f3dLightOn.value = 1;
    this._applyAmbient();
  }

  _updateLights() {
    if (!this.grid) return;
    const g = this.grid;
    const focus = worldToCanvas(g, this.controls.target.x, this.controls.target.z);
    const resolved = this.lights.map((l) => {
      if (!l.tokenId) return l;
      const tok = this.tokens.get(l.tokenId);
      if (!tok || !tok.group.visible) return { ...l, hidden: true };
      const p = worldToCanvas(g, tok.group.position.x, tok.group.position.z);
      return { ...l, x: p.x, y: p.y, _y: tok.group.position.y };
    });
    const chosen = selectLights(resolved, focus, this.lightPool.length);
    // Lights matter most in the dark; in daylight they only add a gentle tint.
    // With Foundry's light map the squares are already lit; point lights only add their colour.
    const strength = (0.6 + 2.4 * this.darkness) * (this.lightMapOn ? 0.35 : 1);
    this.lightPool.forEach((pl, i) => {
      const l = chosen[i];
      if (!l) {
        pl.intensity = 0;
        return;
      }
      const w = canvasToWorld(g, l.x, l.y);
      const y = l._y ?? Math.max(this.terrainYAt(l.x, l.y), unitsToWorldY(g, l.elevation));
      pl.position.set(w.x, y + 1.1, w.z);
      pl.color.setHex(l.color);
      pl.distance = Math.max(l.dim, l.bright) / g.distance + 0.5;
      pl.decay = 1;
      pl.intensity = strength * (0.6 + Math.min(1, l.alpha ?? 0.5));
    });
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Fog of war                                                                               */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * @param {Uint8Array|null} states  per-cell FOG states (cols*rows), or null to disable fog
   */
  setFog(states) {
    const tex = this.fogUniforms.f3dFogMap.value;
    if (!states || !tex) {
      this.fogUniforms.f3dFogOn.value = 0;
      return;
    }
    const data = tex.image.data;
    const n = Math.min(states.length, data.length);
    for (let i = 0; i < n; i++) data[i] = FOG_VALUE[states[i]] ?? 0;
    tex.needsUpdate = true;
    this.fogUniforms.f3dFogOn.value = 1;
    this.fogStates = states;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Textures                                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  /** @param {string|HTMLCanvasElement|HTMLImageElement} src */
  loadTexture(src) {
    if (typeof src !== "string") {
      if (this.textureCache.has(src)) return this.textureCache.get(src);
      const tex = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.needsUpdate = true;
      const p = Promise.resolve(tex);
      this.textureCache.set(src, p);
      return p;
    }
    if (this.textureCache.has(src)) return this.textureCache.get(src);
    const p = /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(src) ? this._loadVideoTexture(src) : new THREE.TextureLoader().loadAsync(src);
    const done = p.then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      return tex;
    });
    this.textureCache.set(src, done);
    done.catch(() => this.textureCache.delete(src));
    return done;
  }

  _loadVideoTexture(src) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.src = src;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = "anonymous";
      video.addEventListener("loadeddata", () => {
        video.play().catch(() => {});
        resolve(new THREE.VideoTexture(video));
      }, { once: true });
      video.addEventListener("error", () => reject(new Error(`video failed: ${src}`)), { once: true });
    });
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Camera                                                                                   */
  /* ---------------------------------------------------------------------------------------- */

  /** Current camera yaw (atan2(x, z) of the camera offset from the target). */
  cameraYaw() {
    const o = this.camera.position.clone().sub(this.controls.target);
    return Math.atan2(o.x, o.z);
  }

  /** Polar angle used by the tactics camera (from straight up). */
  _tacticsPolar() {
    return this.topDown ? 0 : THREE.MathUtils.degToRad(90 - (this.options.tacticsElevation || 30));
  }

  /** Put the active camera at `dist` from the target with the given polar/azimuth. */
  _placeCamera(polar, azimuth, dist) {
    const t = this.controls.target;
    this.camera.position.set(
      t.x + dist * Math.sin(polar) * Math.sin(azimuth),
      t.y + dist * Math.cos(polar) + (polar === 0 ? 0 : 0),
      t.z + dist * Math.sin(polar) * Math.cos(azimuth) + (polar === 0 ? 1e-3 : 0),
    );
  }

  /**
   * "free": perspective orbit camera. "tactics": orthographic camera at a fixed elevation on a
   * diagonal, rotated in 90° steps (Final Fantasy Tactics style). Zoom and pan work in both.
   */
  setCameraMode(mode) {
    mode = mode === "tactics" ? "tactics" : "free";
    if (mode === this.cameraMode && this.camera === (mode === "tactics" ? this.orthoCamera : this.perspCamera)) return;
    const yaw = this.cameraYaw();
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.cameraMode = mode;
    this.options.cameraMode = mode;
    this._rotAnim = null;
    if (mode === "tactics") {
      this.camera = this.orthoCamera;
      this.controls.object = this.orthoCamera;
      // Keep roughly the same framing: visible height ≈ what the perspective camera showed.
      this.orthoCamera.zoom = THREE.MathUtils.clamp(this.orthoHeight / Math.max(4, dist * 0.7), 0.15, 6);
      this.orthoCamera.updateProjectionMatrix();
      const polar = this._tacticsPolar();
      this._placeCamera(polar, snapTacticsYaw(yaw), 200);
      this.controls.minPolarAngle = this.controls.maxPolarAngle = polar;
      this.controls.enableRotate = false;
      this.controls.minZoom = 0.1;
      this.controls.maxZoom = 8;
    } else {
      this.camera = this.perspCamera;
      this.controls.object = this.perspCamera;
      const d = Math.max(6, this.orthoHeight / Math.max(0.1, this.orthoCamera.zoom) / 0.7);
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
      this.controls.enableRotate = !this.topDown;
      this._placeCamera(this.topDown ? 0 : THREE.MathUtils.degToRad(55), yaw, d);
      if (this.topDown) this._applyTopDown();
    }
    this.controls.update();
  }

  /** Look at the scene (or a canvas point) from a classic tactics angle. */
  resetCamera(focus = null) {
    const g = this.grid;
    if (!g) return;
    const target = focus ? canvasToWorld(g, focus.x, focus.y) : { x: 0, z: 0 };
    const span = focus ? 10 : Math.max(g.cols, g.rows);
    const dist = Math.max(6, span * 0.95);
    this.controls.target.set(target.x, 0, target.z);
    this.controls.maxDistance = Math.max(g.cols, g.rows) * 3;
    if (this.cameraMode === "tactics") {
      this.orthoCamera.zoom = THREE.MathUtils.clamp(this.orthoHeight / Math.max(4, span * 0.75), 0.1, 8);
      this.orthoCamera.updateProjectionMatrix();
      this._placeCamera(this._tacticsPolar(), snapTacticsYaw(this.cameraYaw()), 200);
    } else {
      this._placeCamera(THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(35), dist);
      if (this.topDown) this._applyTopDown();
    }
    this.controls.update();
  }

  /** Move the orbit target to a canvas point, keeping the current angle. */
  focusCanvasPoint(px, py) {
    const w = canvasToWorld(this.grid, px, py);
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(w.x, this.controls.target.y, w.z);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  setTopDown(on) {
    on = !!on;
    if (on === this.topDown) return;
    this.topDown = on;
    if (this.cameraMode === "tactics") {
      const polar = this._tacticsPolar();
      this._placeCamera(polar, on ? 0 : snapTacticsYaw(this._savedTacticsYaw ?? Math.PI / 4), 200);
      if (on) this._savedTacticsYaw = this.cameraYaw();
      this.controls.minPolarAngle = this.controls.maxPolarAngle = polar;
      this.controls.update();
      return;
    }
    if (on) {
      this._saved = { offset: this.camera.position.clone().sub(this.controls.target) };
      this._applyTopDown();
    } else {
      this.controls.minPolarAngle = 0;
      this.controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
      this.controls.enableRotate = true;
      const offset = this._saved?.offset ?? new THREE.Vector3(5, 7, 5);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.controls.update();
  }

  _applyTopDown() {
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.set(this.controls.target.x, this.controls.target.y + dist, this.controls.target.z + 1e-3);
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = 0;
    this.controls.enableRotate = false;
  }

  /**
   * Rotate the camera around the target by `deg` degrees. Animated by default; in tactics mode the
   * end angle snaps to a diagonal.
   */
  rotateBy(deg, { animate = true } = {}) {
    const rad = THREE.MathUtils.degToRad(deg);
    if (!animate) {
      this._rotateCamera(rad);
      if (this.cameraMode === "tactics" && !this.topDown) this._snapTactics();
      this.controls.update();
      return;
    }
    const pending = this._rotAnim?.left ?? 0;
    this._rotAnim = { left: pending + rad };
  }

  _rotateCamera(rad) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(_up, rad);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  _snapTactics() {
    const dist = this.camera.position.distanceTo(this.controls.target);
    this._placeCamera(this._tacticsPolar(), snapTacticsYaw(this.cameraYaw()), dist);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Picking                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  _ray(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.world.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  _cellFromHit(hit) {
    // Nudge against the face normal so clicks on a side face pick the raised cell.
    const p = hit.point.clone();
    if (hit.face) p.addScaledVector(hit.face.normal, -0.01);
    return worldToCell(this.grid, p.x, p.z);
  }

  /** Grid cell under a client (screen) point, or null. */
  pickCell(clientX, clientY) {
    if (!this.terrainMesh) return null;
    this._ray(clientX, clientY);
    const targets = [this.terrainMesh, ...this.levelFloors.filter((f) => f.mesh.visible).map((f) => f.mesh)];
    // Upper floors are mostly transparent images: only their opaque parts catch the pointer.
    const hit = this.raycaster.intersectObjects(targets, false).find((h) => h.object.name !== "levelFloor" || this._opaqueAt(h));
    return hit ? this._cellFromHit(hit) : null;
  }

  /**
   * What is under the pointer: a visible token, a door, or a terrain cell (in that priority for
   * the nearest hit). Plain walls block picking of what is behind them.
   * @returns {{type:"token",id:string}|{type:"door",id:string}|{type:"cell",col:number,row:number}|null}
   */
  pick(clientX, clientY) {
    if (!this.terrainMesh) return null;
    this._ray(clientX, clientY);
    const targets = [this.terrainMesh, ...this.levelFloors.filter((f) => f.mesh.visible).map((f) => f.mesh)];
    for (const [, t] of this.tokens) if (t.group.visible) targets.push(t.card, t.base);
    for (const b of this.wallBatches.values()) if (b.mesh.count) targets.push(b.mesh);
    for (const [, w] of this.walls) {
      if (w.instanced || !w.object.visible) continue;
      if (w.door) targets.push(w.mesh);
      else w.object.traverse((o) => o.isMesh && targets.push(o));
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      const ud = hit.object.userData;
      if (ud.tokenId) {
        // Ignore clicks on transparent parts of the card.
        if (hit.object === this.tokens.get(ud.tokenId)?.card && !this._opaqueAt(hit)) continue;
        return { type: "token", id: ud.tokenId };
      }
      if (ud.wallId) return ud.isDoor ? { type: "door", id: ud.wallId } : null;
      if (ud.isWallBatch) return null; // a plain wall blocks the click
      if (hit.object.name === "levelFloor" && !this._opaqueAt(hit)) continue;
      const cell = this._cellFromHit(hit);
      return cell ? { type: "cell", ...cell } : null;
    }
    return null;
  }

  /** Alpha test for a hit on a textured plane (falls back to "opaque" if the image is unreadable). */
  _opaqueAt(hit) {
    const img = hit.object.material.map?.image;
    if (!img || !hit.uv) return true;
    try {
      this._alphaCache ??= new WeakMap();
      let ctx = this._alphaCache.get(img);
      const w = img.videoWidth || img.width, h = img.videoHeight || img.height;
      if (!ctx) {
        // Downscale big images: alpha picking does not need full resolution.
        const k = Math.min(1, 512 / Math.max(w, h));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        this._alphaCache.set(img, ctx);
      }
      const cw = ctx.canvas.width, ch = ctx.canvas.height;
      const x = Math.min(cw - 1, Math.max(0, Math.floor(hit.uv.x * cw)));
      const y = Math.min(ch - 1, Math.max(0, Math.floor((1 - hit.uv.y) * ch)));
      return ctx.getImageData(x, y, 1, 1).data[3] > 20;
    } catch {
      return true; // tainted canvas (cross-origin image): accept the hit
    }
  }

  /** Outline a cell (hover); pass null to hide. */
  highlightCell(cell) {
    if (!cell) {
      if (this.hoverLine) this.hoverLine.visible = false;
      return;
    }
    const g = this.grid;
    const r = cellRect(g, cell.col, cell.row);
    const a = canvasToWorld(g, r.x, r.y);
    const b = canvasToWorld(g, r.x + r.width, r.y + r.height);
    const h = unitsToWorldY(g, getHeight(this.heights, cell.col, cell.row)) + 0.02;
    const pts = [a.x, h, a.z, b.x, h, a.z, b.x, h, b.z, a.x, h, b.z];
    if (!this.hoverLine) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
      this.hoverLine = new THREE.LineLoop(geo, this.materials.hover);
      this.overlayGroup.add(this.hoverLine);
    }
    this.hoverLine.geometry.attributes.position.array.set(pts);
    this.hoverLine.geometry.attributes.position.needsUpdate = true;
    this.hoverLine.geometry.computeBoundingSphere();
    this.hoverLine.visible = true;
  }

  /**
   * Draw a ruler through cell centres (on top of the terrain) with a label at the end.
   * @param {{col:number,row:number}[]|null} cells  null hides it
   * @param {string} [label]
   */
  showRuler(cells, label = "") {
    if (!cells || cells.length < 2) {
      if (this.rulerLine) this.rulerLine.visible = false;
      this.rulerLabel.style.display = "none";
      this._rulerEnd = null;
      return;
    }
    const g = this.grid;
    const pts = [];
    for (const c of cells) {
      const p = cellCenter(g, c.col, c.row);
      const w = canvasToWorld(g, p.x, p.y);
      pts.push(new THREE.Vector3(w.x, unitsToWorldY(g, getHeight(this.heights, c.col, c.row)) + 0.12, w.z));
    }
    if (this.rulerLine) {
      this.rulerLine.geometry.dispose();
      this.rulerLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    } else {
      this.rulerLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.materials.ruler);
      this.rulerLine.renderOrder = 10;
      this.overlayGroup.add(this.rulerLine);
    }
    this.rulerLine.visible = true;
    this._rulerEnd = pts[pts.length - 1].clone().add(new THREE.Vector3(0, 0.35, 0));
    this.rulerLabel.textContent = label;
    this.rulerLabel.style.display = label ? "block" : "none";
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Loop                                                                                     */
  /* ---------------------------------------------------------------------------------------- */

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.perspCamera.aspect = w / h;
    this.perspCamera.updateProjectionMatrix();
    const oh = this.orthoHeight / 2;
    Object.assign(this.orthoCamera, { left: -oh * (w / h), right: oh * (w / h), top: oh, bottom: -oh });
    this.orthoCamera.updateProjectionMatrix();
  }

  _loop(now) {
    const rawDt = Math.max(0, (now - this._last) / 1000);
    const dt = Math.min(0.1, rawDt);
    this._last = now;
    if (this._rotAnim) {
      const step = Math.sign(this._rotAnim.left) * Math.min(Math.abs(this._rotAnim.left), dt * Math.PI * 1.6);
      this._rotateCamera(step);
      this._rotAnim.left -= step;
      if (Math.abs(this._rotAnim.left) < 1e-4) {
        this._rotAnim = null;
        if (this.cameraMode === "tactics" && !this.topDown) this._snapTactics();
      }
    }
    if (this._pan) {
      // Smooth camera pan (combat turns): move target and camera together.
      // Time-based (not frame-based) so it arrives on time even at low frame rates.
      const step = 1 - Math.exp(-Math.min(rawDt, 1) * 6);
      const d = this._pan.clone().sub(this.controls.target).multiplyScalar(step);
      this.controls.target.add(d);
      this.camera.position.add(d);
      if (this._pan.distanceTo(this.controls.target) < 0.02) {
        this.controls.target.copy(this._pan);
        this._pan = null;
      }
    }
    this.controls.update();
    const k = 1 - Math.exp(-dt * 14);
    const target = this.controls.target;
    const cam = this.camera.position;
    this._time = (this._time ?? 0) + dt;
    try {
      this.onFrame?.(dt);
    } catch (e) {
      console.warn("foundry-3d-view | frame callback failed", e);
    }
    if (this.activeRing?.visible) {
      const s = 1 + 0.08 * Math.sin(this._time * 5);
      this.activeRing.scale.set(this.activeRing.userData.r * s, 1, this.activeRing.userData.r * s);
    }

    // Camera polar angle drives how far standees lean back (flat when seen from straight above).
    const offset = cam.clone().sub(target);
    const polar = Math.acos(THREE.MathUtils.clamp(offset.y / (offset.length() || 1), -1, 1));
    const lean = THREE.MathUtils.clamp((0.75 - polar) / 0.5, 0, 1) * (Math.PI / 2);
    const f = lean / (Math.PI / 2);

    // All standees share the camera's yaw (screen-aligned, like sprites in tactics games), so in
    // top-down view they all lie flat with their top toward the top of the screen.
    const yaw = Math.atan2(offset.x, offset.z);
    const facing = this.options.spriteFacing;
    // Billboard: parallel to the screen (tilted back by the camera's elevation), like FFT/Doom.
    const billboardLean = Math.PI / 2 - polar;
    for (const [, t] of this.tokens) {
      t.group.position.lerp(t.target, k);
      const faceYaw = tokenFacingYaw(t.data.rotation);
      let l = lean, ff = f;
      if (facing === SPRITE_FACING.BILLBOARD) {
        l = billboardLean;
        ff = THREE.MathUtils.clamp((0.75 - polar) / 0.5, 0, 1);
        t.yaw.rotation.y = yaw;
      } else if (facing === SPRITE_FACING.STANDEE) {
        t.yaw.rotation.y = faceYaw;
      } else {
        t.yaw.rotation.y = yaw;
      }
      t.pivot.rotation.x = -l;
      // When lying down, slide the card so its centre (not its foot) sits on the token.
      t.pivot.position.set(0, ff * 0.08, (ff * Math.abs(t.card.scale.y)) / 2);
      // Directional / animated sprite sheet: pick the cell for this view angle and time.
      if (t.sheetTex) {
        const sh = t.data.sheet;
        const viewYaw = this.cameraMode === "tactics"
          ? yaw
          : Math.atan2(cam.x - t.group.position.x, cam.z - t.group.position.z);
        const row = directionRow(sh.directions, faceYaw, viewYaw);
        const col = animationColumn(sh.frames, sh.fps, this._time + t.phase);
        if (row !== t.sheetRow || col !== t.sheetCol) {
          const uv = sheetCellUV(sh.frames, sh.directions, col, row);
          t.sheetTex.repeat.set(uv.repeat[0], uv.repeat[1]);
          t.sheetTex.offset.set(uv.offset[0], uv.offset[1]);
          t.sheetRow = row;
          t.sheetCol = col;
        }
      }
    }

    // Doors swing; walls toward the camera sink when cutaway is on.
    const cutaway = this.options.cutaway && !this.topDown;
    for (const [, w] of this.walls) {
      if (w.door) w.door.pivot.rotation.y += (w.door.target - w.door.pivot.rotation.y) * k;
      const low = Math.min(1, this.options.cutawayHeight / (w.height || 1));
      const goal = cutaway && isWallTowardCamera(w.center.x, w.center.z, target, cam) ? low : 1;
      if (Math.abs(goal - w.cut) > 1e-3) {
        w.cut += (goal - w.cut) * k;
        if (w.instanced) this._writeWallMatrix(w);
        else if (w.applyCut) w.applyCut(w.cut);
        else w.mesh.scale.y = w.height * w.cut;
      }
    }

    // Roofs fade out when disabled, in cutaway, or when one of the focus tokens is under them.
    for (const [, t] of this.tiles) {
      if (t.isModel) {
        t.group.visible = !t.levelHidden;
        continue;
      }
      let goal = t.baseOpacity;
      if (t.levelHidden) goal = 0;
      else if (t.overhead) {
        const under = this.roofFocus.some((p) => tileContainsPoint(t.data, p.x, p.y));
        if (!this.options.showRoofs || cutaway || under) goal = 0;
      }
      const m = t.mesh.material;
      m.opacity += (goal - m.opacity) * k;
      t.group.visible = m.opacity > 0.02;
    }

    this._lightTimer += dt;
    if (this._lightTimer > 0.25) {
      this._lightTimer = 0;
      this._updateLights();
    }

    if (this._rulerEnd && this.rulerLabel.style.display !== "none") {
      const p = this._rulerEnd.clone().project(this.camera);
      const w = this.container.clientWidth, h = this.container.clientHeight;
      this.rulerLabel.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    for (const id of [...this.effects.keys()]) this.removeEffect(id);
    this.onFrame = null;
    this.renderer.setAnimationLoop(null);
    this._resizeObserver.disconnect();
    this.clear();
    this.controls.dispose();
    this.boxGeometry.dispose();
    this.wallGeometry.dispose();
    for (const b of this.wallBatches.values()) b.mesh.dispose();
    this.planeGeometry.dispose();
    this.ringGeometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
    for (const p of this.textureCache.values()) p.then((t) => t.dispose()).catch(() => {});
    this.textureCache.clear();
    this.bgTexture?.dispose();
    this.fogUniforms.f3dFogMap.value?.dispose();
    this.fogUniforms.f3dLightMap.value?.dispose();
    this.fogUniforms.f3dColorMap.value?.dispose();
    this.rulerLabel.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
