/**
 * three.js renderer for a scene model (see core/scene-model.mjs). Knows nothing about Foundry:
 * the Foundry adapter and the dev page both drive it through this API.
 */
import * as THREE from "../../vendor/three/three.module.js";
import { OrbitControls } from "../../vendor/three/OrbitControls.js";
import { makeGrid, canvasToWorld, unitsToWorldY, worldToCell, tokenCenter, cellRect } from "../core/coords.mjs";
import { maxHeightUnderRect, wallBaseHeight, heightMapsEqual, normalizeHeightMap } from "../core/heights.mjs";
import { wallBox, doorPose, isRenderableWall, isDoor, showAsDoor } from "../core/walls.mjs";
import { buildTerrainArrays, buildGridLines } from "../core/terrain.mjs";

const DEFAULTS = {
  wallHeight: 1.5, // world units (squares)
  wallThickness: 0.12,
  showGrid: true,
  isGM: false,
  pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 2),
};

const DISPOSITION_COLORS = { "-2": 0x8e44ad, "-1": 0xc0392b, 0: 0xd4ac0d, 1: 0x2e86c1 };

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
    this.walls = new Map(); // id -> { data, object, door?: {pivot, target} }
    this.tokens = new Map(); // id -> { data, group, yaw, pivot, card, base, target:{x,y,z}, visible }
    this.textureCache = new Map();
    this.topDown = false;
    this._saved = null;
    this._disposed = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: !!options.preserveDrawingBuffer });
    this.renderer.setPixelRatio(this.options.pixelRatio);
    this.renderer.domElement.classList.add("f3d-canvas");
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false; // pan across the ground plane
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
    this.controls.minDistance = 2;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, 1, 0.35);
    this.scene.add(sun);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.wallGroup = new THREE.Group();
    this.tokenGroup = new THREE.Group();
    this.world.add(this.wallGroup, this.tokenGroup);

    this.materials = {
      wall: new THREE.MeshLambertMaterial({ color: 0x8a8580 }),
      wallTop: new THREE.MeshLambertMaterial({ color: 0x55504c }),
      door: new THREE.MeshLambertMaterial({ color: 0x8b5a2b }),
      secretDoor: new THREE.MeshLambertMaterial({ color: 0x7d6a8c }),
      gridLine: new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
      hover: new THREE.LineBasicMaterial({ color: 0xffe066 }),
    };
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.boxGeometry.translate(0, 0.5, 0); // origin at the bottom face

    this.raycaster = new THREE.Raycaster();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(container);
    this.resize();

    this._last = performance.now();
    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
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
    this.scene.background = new THREE.Color(model.backgroundColor ?? "#1b1b1f");

    // Padding ground (outside the scene rect), slightly below 0 to avoid z-fighting.
    const g = this.grid;
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(g.width / g.size, g.height / g.size),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(model.backgroundColor ?? "#1b1b1f").multiplyScalar(0.8) }),
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
    this.terrainMaterials = [
      new THREE.MeshLambertMaterial({ map: this.bgTexture, color: this.bgTexture ? 0xffffff : 0x556b2f }),
      new THREE.MeshLambertMaterial({ map: this.bgTexture, color: this.bgTexture ? 0x9a9a9a : 0x3b4a20 }),
    ];
    this._buildTerrain();

    for (const w of model.walls ?? []) this.upsertWall(w);
    await Promise.all((model.tokens ?? []).map((t) => this.upsertToken(t, { snap: true })));
    this.resetCamera();
  }

  clear() {
    for (const id of [...this.walls.keys()]) this.removeWall(id);
    for (const id of [...this.tokens.keys()]) this.removeToken(id);
    for (const obj of [this.terrainMesh, this.gridLines, this.padMesh, this.hoverLine]) {
      if (!obj) continue;
      obj.removeFromParent();
      obj.geometry?.dispose();
    }
    this.terrainMesh = this.gridLines = this.padMesh = this.hoverLine = null;
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

  /** Replace terrain heights; walls and tokens are re-seated. */
  setHeights(heights) {
    if (!this.grid) return;
    const next = normalizeHeightMap(heights, this.grid.cols, this.grid.rows);
    if (heightMapsEqual(next, this.heights)) return;
    this.heights = next;
    this._buildTerrain();
    // Snapshot first: upsertWall re-inserts keys, which a live Map iterator would visit forever.
    for (const w of [...this.walls.values()].map((e) => e.data)) this.upsertWall(w);
    for (const [, t] of this.tokens) this._placeToken(t, false);
  }

  getHeights() {
    return this.heights;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Walls & doors                                                                            */
  /* ---------------------------------------------------------------------------------------- */

  upsertWall(w) {
    const existing = this.walls.get(w.id);
    if (!isRenderableWall(w)) {
      if (existing) this.removeWall(w.id);
      return;
    }
    const base = unitsToWorldY(this.grid, wallBaseHeight(this.heights, this.grid, w.c));
    const opts = { height: this.options.wallHeight, base };
    const asDoor = isDoor(w) && showAsDoor(w, this.options.isGM);

    // Doors keep their object so the swing can animate; anything else is rebuilt (cheap).
    if (existing && existing.door && asDoor) {
      existing.data = w;
      const pose = doorPose(w, this.grid, opts);
      existing.door.pivot.position.set(pose.hx, pose.bottom, pose.hz);
      existing.door.mesh.scale.set(pose.length, pose.top - pose.bottom, this.options.wallThickness * 0.7);
      existing.door.mesh.position.x = pose.length / 2;
      existing.door.mesh.material = w.door === 2 ? this.materials.secretDoor : this.materials.door;
      existing.door.target = pose.angle;
      return;
    }
    if (existing) this.removeWall(w.id);

    if (asDoor) {
      const pose = doorPose(w, this.grid, opts);
      const pivot = new THREE.Group();
      pivot.position.set(pose.hx, pose.bottom, pose.hz);
      pivot.rotation.y = pose.angle;
      const mesh = new THREE.Mesh(this.boxGeometry, w.door === 2 ? this.materials.secretDoor : this.materials.door);
      mesh.scale.set(pose.length, pose.top - pose.bottom, this.options.wallThickness * 0.7);
      mesh.position.x = pose.length / 2;
      mesh.userData.wallId = w.id;
      pivot.add(mesh);
      this.wallGroup.add(pivot);
      this.walls.set(w.id, { data: w, object: pivot, door: { pivot, mesh, target: pose.angle } });
      return;
    }
    const box = wallBox(w, this.grid, { ...opts, thickness: this.options.wallThickness });
    const mesh = new THREE.Mesh(this.boxGeometry, [
      this.materials.wall, this.materials.wall, this.materials.wallTop,
      this.materials.wall, this.materials.wall, this.materials.wall,
    ]);
    mesh.position.set(box.cx, box.bottom, box.cz);
    mesh.rotation.y = box.angle;
    // Slight overlap at the ends hides cracks at corners.
    mesh.scale.set(box.length + box.thickness, box.top - box.bottom, box.thickness);
    mesh.userData.wallId = w.id;
    this.wallGroup.add(mesh);
    this.walls.set(w.id, { data: w, object: mesh });
  }

  removeWall(id) {
    const w = this.walls.get(id);
    if (!w) return;
    w.object.removeFromParent();
    this.walls.delete(id);
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
    const srcChanged = entry.data?.src !== t.src || !entry.textureApplied;
    entry.data = t;
    this._placeToken(entry, snap);
    if (srcChanged) await this._applyTokenTexture(entry);
  }

  _createStandee(t) {
    const group = new THREE.Group(); // at the token's foot position
    const yaw = new THREE.Group(); // rotates to face the camera (cylindrical billboard)
    const pivot = new THREE.Group(); // tilts the card back when looking from above
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, color: 0xffffff }),
    );
    card.geometry.translate(0, 0.5, 0); // pivot at the bottom edge
    card.userData.tokenId = t.id;
    pivot.add(card);
    yaw.add(pivot);
    const color = DISPOSITION_COLORS[String(t.disposition ?? 0)] ?? 0xd4ac0d;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.45, 0.06, 32),
      new THREE.MeshLambertMaterial({ color, transparent: true }),
    );
    base.position.y = 0.03;
    group.add(base, yaw);
    this.tokenGroup.add(group);
    return { data: t, group, yaw, pivot, card, base, target: new THREE.Vector3(), visible: true, textureApplied: false };
  }

  async _applyTokenTexture(entry) {
    const src = entry.data.src;
    let tex = null;
    if (src) {
      try {
        tex = await this.loadTexture(src);
      } catch (e) {
        console.warn("foundry-3d-view | token texture failed", src, e);
      }
    }
    if (this._disposed || entry.data.src !== src) return;
    entry.card.material.map = tex;
    entry.card.material.color.set(tex ? 0xffffff : 0x999999);
    entry.card.material.needsUpdate = true;
    entry.textureApplied = true;
    this._sizeCard(entry);
  }

  _sizeCard(entry) {
    const t = entry.data;
    const img = entry.card.material.map?.image;
    const aspect = img && img.width ? (img.videoHeight || img.height) / (img.videoWidth || img.width) : 1;
    const w = t.width * t.scaleX;
    entry.card.scale.set(w * (t.mirrorX ? -1 : 1), w * aspect * (t.scaleY / t.scaleX), 1);
    entry.card.position.y = 0.06;
    const r = Math.max(t.width, t.height) * 0.45;
    entry.base.scale.set(r / 0.45, 1, r / 0.45);
  }

  /** Compute the world target position of a token from its data and the terrain. */
  _placeToken(entry, snap) {
    const t = entry.data;
    const g = this.grid;
    const c = tokenCenter(g, t);
    const terrain = maxHeightUnderRect(this.heights, g, t.x, t.y, t.width * g.size, t.height * g.size);
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
    entry.group.visible = !!visible;
    const opacity = ghost ? 0.45 : 1;
    entry.card.material.opacity = opacity;
    entry.base.material.opacity = opacity;
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
  /* Textures                                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  /** @param {string|HTMLCanvasElement|HTMLImageElement} src */
  loadTexture(src) {
    if (typeof src !== "string") {
      const tex = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.needsUpdate = true;
      return Promise.resolve(tex);
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

  /** Look at the scene (or a canvas point) from a classic tactics angle. */
  resetCamera(focus = null) {
    const g = this.grid;
    if (!g) return;
    const target = focus ? canvasToWorld(g, focus.x, focus.y) : { x: 0, z: 0 };
    const span = focus ? 10 : Math.max(g.cols, g.rows);
    const dist = Math.max(6, span * 0.95);
    const polar = THREE.MathUtils.degToRad(55);
    const azimuth = THREE.MathUtils.degToRad(35);
    this.controls.target.set(target.x, 0, target.z);
    this.camera.position.set(
      target.x + dist * Math.sin(polar) * Math.sin(azimuth),
      dist * Math.cos(polar),
      target.z + dist * Math.sin(polar) * Math.cos(azimuth),
    );
    this.controls.maxDistance = Math.max(g.cols, g.rows) * 3;
    if (this.topDown) this._applyTopDown();
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

  /** Rotate the camera around the target by `deg` degrees (tactics-style quarter turns). */
  rotateBy(deg) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Picking                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  /** Grid cell under a client (screen) point, or null. */
  pickCell(clientX, clientY) {
    if (!this.terrainMesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    if (!hit) return null;
    // Nudge against the face normal so clicks on a side face pick the raised cell.
    const p = hit.point.clone();
    if (hit.face) p.addScaledVector(hit.face.normal, -0.01);
    return worldToCell(this.grid, p.x, p.z);
  }

  /** Outline a cell (paint mode hover); pass null to hide. */
  highlightCell(cell) {
    if (!cell) {
      if (this.hoverLine) this.hoverLine.visible = false;
      return;
    }
    const g = this.grid;
    const r = cellRect(g, cell.col, cell.row);
    const a = canvasToWorld(g, r.x, r.y);
    const b = canvasToWorld(g, r.x + r.width, r.y + r.height);
    const h = unitsToWorldY(g, this.heights.data[cell.row * g.cols + cell.col] || 0) + 0.02;
    const pts = [a.x, h, a.z, b.x, h, a.z, b.x, h, b.z, a.x, h, b.z];
    if (!this.hoverLine) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
      this.hoverLine = new THREE.LineLoop(geo, this.materials.hover);
      this.world.add(this.hoverLine);
    }
    this.hoverLine.geometry.attributes.position.array.set(pts);
    this.hoverLine.geometry.attributes.position.needsUpdate = true;
    this.hoverLine.geometry.computeBoundingSphere();
    this.hoverLine.visible = true;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Loop                                                                                     */
  /* ---------------------------------------------------------------------------------------- */

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop(now) {
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this.controls.update();
    const k = 1 - Math.exp(-dt * 14);

    // Camera polar angle drives how far standees lean back (flat when seen from straight above).
    const offset = this.camera.position.clone().sub(this.controls.target);
    const polar = Math.acos(THREE.MathUtils.clamp(offset.y / (offset.length() || 1), -1, 1));
    const lean = THREE.MathUtils.clamp((0.75 - polar) / 0.5, 0, 1) * (Math.PI / 2);

    // All standees share the camera's yaw (screen-aligned, like sprites in tactics games), so in
    // top-down view they all lie flat with their top toward the top of the screen.
    const yaw = Math.atan2(offset.x, offset.z);
    for (const [, t] of this.tokens) {
      t.group.position.lerp(t.target, k);
      t.yaw.rotation.y = yaw;
      t.pivot.rotation.x = -lean;
      // When lying down, slide the card so its centre (not its foot) sits on the token.
      const f = lean / (Math.PI / 2);
      t.pivot.position.set(0, f * 0.08, f * Math.abs(t.card.scale.y) / 2);
    }
    for (const [, w] of this.walls) {
      if (!w.door) continue;
      const p = w.door.pivot;
      p.rotation.y += (w.door.target - p.rotation.y) * k;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    this.renderer.setAnimationLoop(null);
    this._resizeObserver.disconnect();
    this.clear();
    this.controls.dispose();
    this.boxGeometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
    for (const p of this.textureCache.values()) p.then((t) => t.dispose()).catch(() => {});
    this.textureCache.clear();
    this.bgTexture?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
