// 静态服务（core 实测用）：包目录原样吐出；/d/ 指向冻结的 dist 快照（避免别处重新构建影响结果），不走 5188 的 vite 开发服务。
// 用法：node serve.mjs <端口> <dist 快照目录>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [PORT, SNAP] = [+(process.argv[2] || 5211), path.resolve(process.argv[3] || "dist")];
const MIME = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const m = u.match(/^\/d\/(.+)$/);
  const base = m ? SNAP : ROOT;
  const p = path.join(base, m ? m[1] : u);
  if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`static on ${PORT} snapshot=${SNAP}`));
