// 观感取证：对每个变体用 CDP screencast 抓连续帧（只在合成器出新帧时才有帧），同时每个 rAF 记一次 --skz-shimmer-p。
// 由 run-locked.mjs 拉起（PERF_SCRIPT=frames.mjs），argv[2] 是变体列表 JSON：[{ "name": "s36", "css": "base,global,x-s36", "attrs": { "effect": "shimmer", "engine": "svg" } }]（attrs 可省，默认 CSS 引擎 shimmer），输出写到 frames/<name>/。
// 每个变体输出：f000.jpg…（按到达顺序）、manifest.json（每帧相对首帧的毫秒）、p.json（rAF 级 [毫秒, p] 采样）。
import fs from "node:fs";
import path from "node:path";
const PORT = +(process.env.PERF_PORT || 9611), HOST = process.env.PERF_HOST;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "frames");
const variants = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); let onFrame = null;
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  else if (d.method === "Page.screencastFrame") { ws.send(JSON.stringify({ id: ++id, method: "Page.screencastFrameAck", params: { sessionId: d.params.sessionId } })); onFrame?.(d.params); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 520, deviceScaleFactor: 1, mobile: false });
const SPAN = 2000; // 抓 2 秒：1.33 个周期
for (const v of variants) {
  await send("Page.navigate", { url: `${HOST}?css=${v.css}` });
  for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
  await sleep(400);
  await ev(`setup(${v.n || 12}, ${JSON.stringify(v.attrs || { effect: "shimmer" })})`);
  await ev(`(window.logP = async (ms) => { const out = []; const t0 = performance.now(); const root = document.getElementById("root"); while (performance.now() - t0 < ms) { await new Promise((r) => requestAnimationFrame(r)); out.push([+(performance.now() - t0).toFixed(1), +getComputedStyle(root).getPropertyValue("--skz-shimmer-p")]); } return out; }, true)`);
  await sleep(800);
  const dir = path.join(OUT, v.name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  onFrame = (p) => frames.push(p);
  await send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
  const p = await ev(`logP(${SPAN})`);
  await send("Page.stopScreencast"); onFrame = null;
  const t0 = frames.length ? frames[0].metadata.timestamp : 0;
  const manifest = frames.map((f, i) => { fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, "0")}.jpg`), Buffer.from(f.data, "base64")); return +((f.metadata.timestamp - t0) * 1000).toFixed(1); });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "p.json"), JSON.stringify(p));
  const ch = p.filter((x, i) => i && x[1] !== p[i - 1][1]);
  console.log(JSON.stringify({ name: v.name, screencastFrames: frames.length, frameRatePerSec: +(frames.length / (SPAN / 1000)).toFixed(1), rafSamples: p.length, pChangesPerSec: +(ch.length / (SPAN / 1000)).toFixed(1) }));
}
await send("Browser.close").catch(() => {});
process.exit(0);
