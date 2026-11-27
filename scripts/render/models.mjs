/**
 * Simple 3D props for tiles: built-in low-poly models (trees, rocks, furniture, a car...) and
 * custom glTF/GLB files. A tile with `flags.foundry-3d-view.model` is drawn as this model instead
 * of a flat image, filling the tile's footprint and following its rotation.
 *
 * Every built-in model fits a 1×1 footprint (x and z in [-0.5, 0.5]) with its base at y = 0;
 * heights are in grid squares at that size.
 */
import * as THREE from "../../vendor/three/three.module.js";

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const C = {
  bark: 0x6b4423, leaf: 0x3f8f3a, leafDark: 0x2f6e2c, pine: 0x2d6b45, stone: 0x8b8b88, stoneDark: 0x6f6f6b,
  wood: 0x9c6b3c, woodDark: 0x6e4a28, metal: 0x55595e, red: 0xb33a2e, glass: 0x8fb8d8, tire: 0x222222, lamp: 0xffe9a8,
};

function mesh(geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/** Deterministic pseudo-random deformation so rocks look natural but stable. */
function jitter(geo, amount, seed = 1) {
  const p = geo.attributes.position;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + rnd() * amount), p.getY(i) * (1 + rnd() * amount), p.getZ(i) * (1 + rnd() * amount));
  geo.computeVertexNormals();
  return geo;
}

export const BUILTIN_MODELS = Object.freeze({
  tree() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.7, 7), mat(C.bark), { y: 0.35 }));
    g.add(mesh(new THREE.IcosahedronGeometry(0.42, 0), mat(C.leaf), { y: 0.95 }));
    g.add(mesh(new THREE.IcosahedronGeometry(0.3, 0), mat(C.leafDark), { x: 0.16, y: 1.25, z: -0.08 }));
    g.add(mesh(new THREE.IcosahedronGeometry(0.26, 0), mat(C.leaf), { x: -0.18, y: 1.15, z: 0.12 }));
    return g;
  },
  pine() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.45, 6), mat(C.bark), { y: 0.22 }));
    [[0.45, 0.6, 0.55], [0.36, 0.55, 0.95], [0.25, 0.5, 1.3]].forEach(([r, h, y]) =>
      g.add(mesh(new THREE.ConeGeometry(r, h, 8), mat(C.pine), { y })));
    return g;
  },
  bush() {
    const g = new THREE.Group();
    [[0, 0.22, 0, 0.3], [0.2, 0.18, 0.12, 0.22], [-0.18, 0.17, -0.1, 0.22]].forEach(([x, y, z, r]) =>
      g.add(mesh(new THREE.IcosahedronGeometry(r, 0), mat(C.leaf), { x, y, z })));
    return g;
  },
  rock() {
    const g = new THREE.Group();
    g.add(mesh(jitter(new THREE.DodecahedronGeometry(0.4, 0), 0.35, 7), mat(C.stone), { y: 0.25 }));
    g.add(mesh(jitter(new THREE.DodecahedronGeometry(0.18, 0), 0.4, 3), mat(C.stoneDark), { x: 0.3, y: 0.1, z: 0.22 }));
    return g;
  },
  crate() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.75, 0.75, 0.75), mat(C.wood), { y: 0.375 }));
    for (const y of [0.04, 0.71]) g.add(mesh(new THREE.BoxGeometry(0.78, 0.08, 0.78), mat(C.woodDark), { y }));
    return g;
  },
  barrel() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12), mat(C.wood), { y: 0.4 }));
    for (const y of [0.15, 0.65]) g.add(mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.06, 12), mat(C.metal), { y }));
    return g;
  },
  table() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.95, 0.08, 0.95), mat(C.wood), { y: 0.62 }));
    for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) g.add(mesh(new THREE.BoxGeometry(0.07, 0.6, 0.07), mat(C.woodDark), { x, y: 0.3, z }));
    return g;
  },
  chair() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), mat(C.wood), { y: 0.42 }));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), mat(C.wood), { y: 0.7, z: -0.22 }));
    for (const x of [-0.21, 0.21]) for (const z of [-0.21, 0.21]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), mat(C.woodDark), { x, y: 0.21, z }));
    return g;
  },
  bench() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.98, 0.07, 0.35), mat(C.wood), { y: 0.4 }));
    for (const x of [-0.4, 0.4]) g.add(mesh(new THREE.BoxGeometry(0.07, 0.4, 0.3), mat(C.woodDark), { x, y: 0.2 }));
    return g;
  },
  car() {
    // Long axis along z: give the tile a 1×2 (or 2×4) footprint.
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.28, 0.95), mat(C.red), { y: 0.3 }));
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.24, 0.5), mat(C.glass), { y: 0.56, z: -0.05 }));
    for (const x of [-0.4, 0.4]) for (const z of [-0.3, 0.3]) {
      g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), mat(C.tire), { x, y: 0.13, z, rz: Math.PI / 2 }));
    }
    return g;
  },
  pillar() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.7, 0.12, 0.7), mat(C.stoneDark), { y: 0.06 }));
    g.add(mesh(new THREE.CylinderGeometry(0.24, 0.27, 1.7, 10), mat(C.stone), { y: 0.97 }));
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), mat(C.stoneDark), { y: 1.88 }));
    return g;
  },
  lamppost() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.6, 8), mat(C.metal), { y: 0.8 }));
    g.add(mesh(new THREE.BoxGeometry(0.22, 0.26, 0.22), mat(C.lamp, { emissive: 0x9a7a2a }), { y: 1.72 }));
    return g;
  },
});

export const BUILTIN_MODEL_IDS = Object.freeze(Object.keys(BUILTIN_MODELS));

/** Is the model value a custom glTF/GLB path (rather than a built-in id)? */
export function isCustomModel(value) {
  return typeof value === "string" && /\.(glb|gltf)(\?|$)/i.test(value);
}

/**
 * Scale a loaded model so its footprint fits 1×1 (centred, base at y = 0); the height keeps the
 * model's proportions.
 */
export function normalizeModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const s = 1 / Math.max(size.x, size.z, 1e-6);
  const wrapper = new THREE.Group();
  object.position.set(-(box.min.x + size.x / 2), -box.min.y, -(box.min.z + size.z / 2));
  wrapper.add(object);
  wrapper.scale.setScalar(s);
  const out = new THREE.Group();
  out.add(wrapper);
  return out;
}

let gltfLoader = null;
/** Load a custom .glb/.gltf (cached by the caller). */
export async function loadCustomModel(url) {
  if (!gltfLoader) {
    const { GLTFLoader } = await import("../../vendor/three/GLTFLoader.js");
    gltfLoader = new GLTFLoader();
  }
  const gltf = await gltfLoader.loadAsync(url);
  return normalizeModel(gltf.scene);
}

/** Built-in model by id (a fresh copy), or null. */
export function createBuiltinModel(id) {
  return BUILTIN_MODELS[id] ? BUILTIN_MODELS[id]() : null;
}

/** Export every built-in model as a binary glTF (Uint8Array per id). */
export async function exportBuiltinModels() {
  const { GLTFExporter } = await import("../../vendor/three/GLTFExporter.js");
  const exporter = new GLTFExporter();
  const out = {};
  for (const id of BUILTIN_MODEL_IDS) {
    const obj = createBuiltinModel(id);
    obj.name = id;
    const buf = await exporter.parseAsync(obj, { binary: true });
    out[id] = new Uint8Array(buf);
  }
  return out;
}
