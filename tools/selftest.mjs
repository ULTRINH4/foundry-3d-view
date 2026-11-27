// Browser smoke tests (headless Edge/Chrome, real WebGL via SwiftShader):
//  - dev/?selftest=1                    renderer + toolbar + pointer interaction on the sample scene
//  - dev/foundry-mock.html?selftest=1   the real module (main.mjs + controller) against fake Foundry
//                                       globals, as GM, as a player, and with v14-like levels
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

const pages = process.argv.slice(2).length ? process.argv.slice(2) : [
  "dev/?selftest=1",
  "dev/foundry-mock.html?selftest=1",
  "dev/foundry-mock.html?selftest=1&gm=0",
  "dev/foundry-mock.html?selftest=1&levels=1",
  "dev/perf.html",
];

const port = 8176;
const server = await startServer(port);
let allOk = true;
try {
  for (const page of pages) {
    console.log(`\n== ${page}`);
    const { stdout, stderr } = await promisify(execFile)(browser, [
      "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-logging=stderr",
      "--window-size=1400,850", "--virtual-time-budget=30000", "--dump-dom",
      `http://127.0.0.1:${port}/${page}`,
    ], { timeout: 120000, maxBuffer: 1e8 });
    const lines = stderr.split(/\r?\n/).filter((l) => l.includes("CONSOLE") && l.includes("127.0.0.1") && !l.includes("GPU stall"));
    for (const l of lines) console.log("page:", l.replace(/^.*?CONSOLE[^\]]*\] /, ""));
    const m = stdout.match(/data-selftest="([^"]*)"/);
    if (!m) {
      console.log("FAIL  page did not report (load error?)");
      allOk = false;
      continue;
    }
    const results = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    for (const [k, v] of Object.entries(results)) {
      if (typeof v !== "boolean") {
        console.log(`info  ${k}: ${v}`);
        if (k === "error") allOk = false;
        continue;
      }
      console.log(`${v ? "PASS" : "FAIL"}  ${k}`);
      allOk &&= v;
    }
  }
  process.exitCode = allOk ? 0 : 1;
} finally {
  server.close();
}
