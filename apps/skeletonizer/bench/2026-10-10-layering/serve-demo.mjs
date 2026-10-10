// demo 静态站（DEMO_BASE=/ 构建的 demo-dist 快照）+ /d/before|after/ 两份冻结 dist（用来在 demo 页里把分片样式换成改前的 all.css 对照）
// 用法：node serve-demo.mjs <端口> <demo 目录> <改前 dist> <改后 dist>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const [PORT, DEMO, BEFORE, AFTER] = [+process.argv[2], ...process.argv.slice(3, 6).map((p) => path.resolve(p))];
const MIME = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const m = u.match(/^\/d\/(before|after)\/(.+)$/);
  const base = m ? (m[1] === "before" ? BEFORE : AFTER) : DEMO;
  const p = path.join(base, m ? m[2] : u === "/" ? "index.html" : u);
  if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`demo on ${PORT}`));
