// Builds and (optionally) publishes a Foundry release.
//
//   node tools/release.mjs                 build dist/ for the current module.json version
//   node tools/release.mjs 0.3.1           build for 0.3.1 (does not touch the repo)
//   node tools/release.mjs 0.3.1 --publish bump module.json/package.json, commit, tag v0.3.1,
//                                          push main + tag, create the GitHub release (gh CLI)
//
// dist/module.json   manifest whose "download" points at this version's zip
// dist/foundry-3d-view.zip  runtime files only (module.json at the zip root)
//
// Foundry checks `manifest` (= releases/latest/download/module.json) for updates, so every
// published release is picked up by "Check for Updates" automatically.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "ULTRINH4/foundry-3d-view";
const ID = "foundry-3d-view";
const RUNTIME = ["module.json", "LICENSE", "README.md", "scripts", "styles", "lang", "vendor"];

const args = process.argv.slice(2);
const publish = args.includes("--publish");
const manifestPath = join(root, "module.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a)) ?? manifest.version;
const tag = `v${version}`;

export function releaseManifest(base, v) {
  return {
    ...base,
    version: v,
    url: `https://github.com/${REPO}`,
    manifest: `https://github.com/${REPO}/releases/latest/download/module.json`,
    download: `https://github.com/${REPO}/releases/download/v${v}/${ID}.zip`,
    bugs: `https://github.com/${REPO}/issues`,
    readme: `https://github.com/${REPO}#readme`,
    license: base.license ?? "LICENSE",
  };
}

/* --- minimal zip writer (deflate, forward slashes) ------------------------------------------- */
function listFiles(p) {
  const abs = join(root, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [p];
  return readdirSync(abs).flatMap((n) => listFiles(join(p, n)));
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = (() => {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  })();
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name.split(sep).join("/"), "utf8");
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime.time, 10);
    local.writeUInt16LE(dosTime.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime.time, 12);
    central.writeUInt16LE(dosTime.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/* --- build ----------------------------------------------------------------------------------- */
function build() {
  const out = join(root, "dist");
  mkdirSync(out, { recursive: true });
  const rel = releaseManifest(manifest, version);
  const relJson = JSON.stringify(rel, null, 2) + "\n";
  const files = RUNTIME.flatMap(listFiles).filter((f) => f !== "module.json").sort();
  const entries = [{ name: "module.json", data: Buffer.from(relJson) }, ...files.map((f) => ({ name: f, data: readFileSync(join(root, f)) }))];
  const z = zip(entries);
  writeFileSync(join(out, `${ID}.zip`), z);
  writeFileSync(join(out, "module.json"), relJson);
  console.log(`built dist/${ID}.zip (${entries.length} files, ${(z.length / 1024 / 1024).toFixed(2)} MB) and dist/module.json for ${tag}`);
  return rel;
}

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();

if (!publish) {
  build();
} else {
  if (sh("git", ["status", "--porcelain"])) throw new Error("working tree not clean: commit first");
  if (sh("git", ["tag", "--list", tag])) throw new Error(`tag ${tag} already exists`);
  // Keep the repo's module.json in sync with what is released.
  const rel = releaseManifest(manifest, version);
  writeFileSync(manifestPath, JSON.stringify(rel, null, 2) + "\n");
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  build();
  if (sh("git", ["status", "--porcelain", "module.json", "package.json"])) {
    sh("git", ["add", "module.json", "package.json"]);
    sh("git", ["commit", "-m", `Release ${tag}`]);
  }
  sh("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
  sh("git", ["push", "origin", "HEAD:main"]);
  sh("git", ["push", "origin", tag]);
  const notes = args.includes("--notes") ? args[args.indexOf("--notes") + 1] : `Foundry 3D View ${tag}.\n\nInstall in Foundry with the manifest URL:\n${rel.manifest}`;
  sh("gh", ["release", "create", tag, join("dist", "module.json"), join("dist", `${ID}.zip`), "--repo", REPO, "--title", tag, "--notes", notes, "--latest"]);
  console.log(`published ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
}
