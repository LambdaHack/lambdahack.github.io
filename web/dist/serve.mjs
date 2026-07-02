// src/serve.ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

// src/serve-core.ts
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};
function contentType(path) {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const ext = dot > slash ? path.slice(dot).toLowerCase() : "";
  return TYPES[ext] ?? "application/octet-stream";
}

// src/serve.ts
var root = process.argv[2] ?? ".";
var port = Number(process.argv[3] ?? "8080");
var server = createServer((req, res) => {
  const rawPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const safe = normalize(rawPath).replace(/^(\.\.([/\\]|$))+/, "");
  const rel = safe === "/" || safe === "" ? "/index.html" : safe;
  const file = join(root, rel);
  readFile(file).then((body) => {
    res.writeHead(200, { "content-type": contentType(file) });
    res.end(body);
  }).catch(() => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404 not found");
  });
});
server.listen(port, () => {
  console.log(`serving ${root} at http://localhost:${port}`);
});
