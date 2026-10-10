// 静态服务（本批验证 / 基准用）：包目录原样吐出；/d/before/、/d/after/ 分别指向两份冻结的 dist 快照（改前 / 改后），
// 避免别处重新构建影响结果。CSS 文件可加 ?sim=<模式> 把产物里的 @supports 条件改成恒假 / 恒真，模拟老浏览器：
//   all      text-decoration-thickness / :has() / 相对颜色（@property 根驱动）三者全部判为不支持
//   nohas    只有 :has() 判为不支持（介于第 0 档与现代档之间）
//   not      只有 text-decoration-thickness 判为不支持
//   norel    只有相对颜色判为不支持（没有根驱动，pulse / shimmer 退回 fade）
//   noclip   background-clip:text 判为不支持（强制走 clip 撤回分支）
//   ios      iOS 分支（-webkit-touch-callout）判为支持
// 可用逗号叠加，如 sim=nohas,ios。
// 用法：node serve.mjs <端口> <改前 dist 目录> <改后 dist 目录> [派生变量实验 dist 目录，第 4 项 A/B 用]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [PORT, BEFORE, AFTER, DERIVE] = [+(process.argv[2] || 5197), path.resolve(process.argv[3] || "dist"), path.resolve(process.argv[4] || "dist"), path.resolve(process.argv[5] || process.argv[4] || "dist")];
const MIME = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg" };
const FALSE_COND = "(not (display:block))", TRUE_COND = "(display:block)";
const SIMS = { all: ["T", "has", "rel"], nohas: ["has"], not: ["T"], norel: ["rel"] };

/** 把 CSS 里的 @supports 前置条件按模拟模式改写，其余原样 */
export function simulate(css, sim) {
  if (!sim) return css;
  const modes = sim.split(",");
  const off = new Set(modes.flatMap((m) => SIMS[m] || []));
  let out = "", i = 0;
  for (;;) {
    const j = css.indexOf("@supports", i);
    if (j < 0) { out += css.slice(i); break; }
    const start = j + "@supports".length;
    let k = start, depth = 0;
    while (k < css.length && !(css[k] === "{" && depth === 0)) { if (css[k] === "(") depth++; else if (css[k] === ")") depth--; k++; }
    const prelude = css.slice(start, k).trim();
    let next = prelude;
    if (prelude.includes("-webkit-touch-callout")) next = modes.includes("ios") ? TRUE_COND : prelude;
    else if (prelude.startsWith("not")) next = modes.includes("noclip") ? TRUE_COND : prelude;
    else if ((off.has("T") && prelude.includes("text-decoration-thickness")) || (off.has("has") && prelude.includes("selector(:has")) || (off.has("rel") && prelude.includes("rgb(from"))) next = FALSE_COND;
    out += css.slice(i, j) + "@supports " + next;
    i = k;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("serve.mjs")) {
  http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const u = decodeURIComponent(url.pathname);
    let p, base = ROOT;
    const m = u.match(/^\/d\/(before|after|derive)\/(.+)$/);
    if (m) { base = m[1] === "before" ? BEFORE : m[1] === "derive" ? DERIVE : AFTER; p = path.join(base, m[2]); } else p = path.join(ROOT, u);
    if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
    const ext = path.extname(p);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
    if (ext === ".css" && url.searchParams.get("sim")) res.end(simulate(fs.readFileSync(p, "utf8"), url.searchParams.get("sim")));
    else fs.createReadStream(p).pipe(res);
  }).listen(PORT, () => console.log(`static on ${PORT} before=${BEFORE} after=${AFTER}`));
}
