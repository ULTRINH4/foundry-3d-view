// Tiny static file server for the dev page (ES modules need http://, not file://).
// Usage: node tools/serve.mjs [port]   then open http://localhost:8173/dev/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = {
  ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
};

export function startServer(port = 8173) {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = resolve(root, "." + urlPath);
    if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
    if (urlPath.endsWith("/")) file = join(file, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 8173;
  await startServer(port);
  console.log(`dev page: http://localhost:${port}/dev/`);
}
