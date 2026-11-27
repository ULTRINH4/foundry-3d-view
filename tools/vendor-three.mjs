// Copies three.js (ES module build) + OrbitControls from node_modules into vendor/three,
// rewriting the bare 'three' import so the files load in Foundry without an import map.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "three");
const out = join(root, "vendor", "three");
mkdirSync(out, { recursive: true });

copyFileSync(join(src, "build", "three.module.js"), join(out, "three.module.js"));
copyFileSync(join(src, "build", "three.core.js"), join(out, "three.core.js"));
copyFileSync(join(src, "LICENSE"), join(out, "LICENSE"));

// Addons used for 3D models: GLTF import/export (+ their helpers), imports rewritten to local files.
const addons = [
  ["loaders/GLTFLoader.js", "GLTFLoader.js"],
  ["exporters/GLTFExporter.js", "GLTFExporter.js"],
  ["utils/BufferGeometryUtils.js", "BufferGeometryUtils.js"],
  ["utils/SkeletonUtils.js", "SkeletonUtils.js"],
];
for (const [from, to] of addons) {
  const code = readFileSync(join(src, "examples", "jsm", from), "utf8")
    .replace(/from 'three';/g, "from './three.module.js';")
    .replace(/from '\.\.\/utils\/(\w+\.js)';/g, "from './$1';");
  writeFileSync(join(out, to), code);
}

const orbit = readFileSync(join(src, "examples", "jsm", "controls", "OrbitControls.js"), "utf8")
  .replace(/from 'three';/g, "from './three.module.js';");
writeFileSync(join(out, "OrbitControls.js"), orbit);

const version = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version;
writeFileSync(join(out, "VERSION"), `three@${version}\n`);
console.log(`Vendored three@${version} into vendor/three`);
