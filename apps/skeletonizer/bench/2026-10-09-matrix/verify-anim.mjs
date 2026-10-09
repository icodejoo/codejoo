// 补充抽查：连拍 12 张整视口截图（每 130ms），统计不同画面数；同时读 document.getAnimations() 的进度。
// 用法同 verify-matrix.mjs（PERF_SCRIPT=本文件，经 run-locked 跑）；结果 results/verify-anim.jsonl，截图 shots/anim-*.png
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PERF_PORT || 9351), HOST = process.env.PERF_HOST;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; const to = setTimeout(() => j(new Error("timeout " + method)), 30000); pend.set(i, (d) => { clearTimeout(to); r(d); }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
let cur = null;
const go = async (css) => { if (css === cur) return; await send("Page.navigate", { url: `${HOST}?css=${css}` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400); cur = css; };
const css = (e, more = []) => [["skz-effect", e], ...more];
const CASES = [
  ["fade", "base", { effect: "fade" }],
  ["sweep", "base,sweep", { effect: "sweep" }],
  ["sweep-bg", "base,sweep", { effect: "sweep", _attrs: [["skz-sweep", "bg"]] }],
  ["shimmer-svg", "base,svg", { effect: "shimmer", engine: "svg" }],
  ["pulse-svg", "base,svg", { effect: "pulse", engine: "svg" }],
  ["shimmer-leaf-svg", "base,svg", { effect: "shimmer", text: "leaf", engine: "svg" }],
  ["form-shimmer-svg", "base,svg,form", { effect: "shimmer", engine: "svg" }],
  ["form-shimmer-default", "base,global,form", { effect: "shimmer" }],
  ["shimmer-enable", "base,global", { effect: "shimmer" }],
];
const only = process.env.VERIFY_ONLY ? process.env.VERIFY_ONLY.split(",") : null;
const out = [];
for (const [name, c, spec] of CASES) {
  if (only && !only.includes(name)) continue;
  await go(c);
  await ev(`setup(${c.includes("form") ? 400 : 200}, ${JSON.stringify(spec)})`); await sleep(700);
  const hashes = []; let first = null;
  for (let i = 0; i < 12; i++) {
    const d = (await send("Page.captureScreenshot", { format: "png" })).result.data;
    if (i === 0) first = d;
    hashes.push(crypto.createHash("md5").update(d).digest("hex").slice(0, 6)); await sleep(130);
  }
  fs.writeFileSync(path.join(HERE, "shots", `anim-${name}.png`), Buffer.from(first, "base64"));
  const anims = await ev(`(() => { const t = [], r = document.getElementById("root"); for (const a of document.getAnimations()) { const e = a.effect; const tg = e && e.target; if (tg && (tg === r || r.contains(tg) || tg === document.documentElement)) t.push({ name: a.animationName || a.id || a.constructor.name, pseudo: e.pseudoElement, state: a.playState }); } return { count: t.length, sample: t.slice(0, 3) }; })()`);
  const rec = { name, unique: new Set(hashes).size, of: 12, hashes: hashes.join(","), anims }; console.log(JSON.stringify(rec)); out.push(rec);
}
fs.writeFileSync(path.join(HERE, "results", "verify-anim.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await send("Browser.close").catch(() => {});
process.exit(0);
