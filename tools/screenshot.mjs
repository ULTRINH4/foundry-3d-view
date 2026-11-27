// Renders the dev page headless (Edge or Chrome, SwiftShader WebGL) and saves screenshots to
// dev/screenshots/. Usage: npm run screenshot   (set BROWSER=path/to/chrome.exe to override)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./serve.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dev", "screenshots");
mkdirSync(outDir, { recursive: true });

const candidates = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) throw new Error("No Chrome/Edge found; set BROWSER=/path/to/browser");

const port = 8174;
const server = await startServer(port);
const shots = [
  ["dev-page-orbit.png", ""],
  ["dev-page-topdown.png", "?topdown=1"],
  ["dev-page-player.png", "?player=1&az=-70"],
  ["dev-page-paint.png", "?paint=1&az=150"],
  ["dev-page-fog.png", "?player=1&topdown=1"],
  ["dev-page-cutaway.png", "?cutaway=1&az=-20"],
  ["dev-page-ruler.png", "?select=hero&hover=11,5&az=10"],
  ["foundry-mock-gm.png", "foundry-mock.html?open=1"],
  ["foundry-mock-player.png", "foundry-mock.html?open=1&gm=0"],
];
try {
  for (const [name, query] of shots) {
    await promisify(execFile)(browser, [
      "--headless=new",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      "--window-size=1400,850",
      "--virtual-time-budget=6000",
      `--screenshot=${join(outDir, name)}`,
      `http://127.0.0.1:${port}/dev/${query}`,
    ], { timeout: 60000 });
    console.log(`saved dev/screenshots/${name}`);
  }
} finally {
  server.close();
}
