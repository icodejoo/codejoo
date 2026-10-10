// 极简静态服务，根为 skeletonizer 包目录；加 CORS 与 no-store。用法：node serve.mjs [端口，默认 5190]
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const ROOT = path.resolve("E:/workspaces/codejoo/apps/skeletonizer");
const MIME = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" };
http.createServer(async (req, res) => {
  let pn = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (pn.startsWith("/slow/")) { pn = pn.slice(5); await new Promise((r) => setTimeout(r, 1500)); } // /slow/<路径>：延迟 1.5s 再吐文件，用来模拟字体慢加载
  const p = path.join(ROOT, pn);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store", "access-control-allow-origin": "*" });
  fs.createReadStream(p).pipe(res);
}).listen(+(process.argv[2] || 5190), () => console.log("static on", process.argv[2] || 5190));
