// 极简静态服务：包目录原样吐出；/dist/ 可指向一份冻结的 dist 快照，避免别处重新构建时影响基准。
// 用法：node serve.mjs [端口，默认 5192] [dist 快照目录，可选]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, "dist");
const MIME = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const p = u.startsWith("/dist/") ? path.join(DIST, u.slice(6)) : path.join(ROOT, u);
  const okRoot = u.startsWith("/dist/") ? DIST : ROOT;
  if (!p.startsWith(okRoot) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(p).pipe(res);
}).listen(+(process.argv[2] || 5192), () => console.log("static on", process.argv[2] || 5192, ROOT, "dist=", DIST));
