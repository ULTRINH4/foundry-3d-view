// Browser smoke test: loads dev/?selftest=1 headless (real WebGL via SwiftShader) and checks the
// live-update paths (door swing, token move, picking, height painting, player visibility).
// Usage: npm run selftest   (set BROWSER=path/to/chrome.exe to override)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { startServer } from "./serve.mjs";

const browser = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean).find((p) => existsSync(p));
if (!browser) throw new Error("No Chrome/Edge found; set BROWSER=/path/to/browser");

const port = 8176;
const server = await startServer(port);
try {
  const { stdout } = await promisify(execFile)(browser, [
    "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--window-size=1400,850", "--virtual-time-budget=8000", "--dump-dom",
    `http://127.0.0.1:${port}/dev/?selftest=1`,
  ], { timeout: 60000, maxBuffer: 1e8 });
  const m = stdout.match(/data-selftest="([^"]*)"/);
  if (!m) throw new Error("self-test did not report (page error?)");
  const results = JSON.parse(m[1].replace(/&quot;/g, '"'));
  let ok = true;
  for (const [k, v] of Object.entries(results)) {
    console.log(`${v ? "PASS" : "FAIL"}  ${k}`);
    ok &&= v;
  }
  process.exitCode = ok ? 0 : 1;
} finally {
  server.close();
}
