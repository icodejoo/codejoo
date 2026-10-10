// 用 CDP Tracing 拆每帧耗时：主线程样式/布局/绘制，光栅线程，GPU。场景从 argv[2] 的 JSON 文件读。
// 相对 kit/trace.mjs 的增补：每秒事件数（Paint / PrePaint / UpdateLayoutTree / Commit / RasterTask / GPU 任务），Paint 时长分布；场景 probe 字段采样 --skz-shimmer-p 的实际变化频率；PERF_DUMP=1 打印各线程事件名计数
import fs from "node:fs";
const PORT = +(process.env.PERF_PORT || 9333), HOST = process.env.PERF_HOST || "http://localhost:5192/bench/2026-10-09-clip-steps/perf.html";
const scen = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const REPS = +(process.argv[3] || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const evs = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method) evs.push(d); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const waitEvent = async (name, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = evs.findIndex((e) => e.method === name); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } return null; };
await send("Page.enable"); await send("Page.bringToFront");
// 可选：固定视口（PERF_VIEWPORT=1200x800，DPR 1）；默认不改，行为与旧版一致
if (process.env.PERF_VIEWPORT) { const [w, h] = process.env.PERF_VIEWPORT.split("x").map(Number); await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); }
// 可选：PERF_SCHEME=dark 模拟深色模式
if (process.env.PERF_SCHEME) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.PERF_SCHEME }] });
// 窗口被最小化（或被系统隐藏）时 rAF 停摆，帧数会全错：每次测量前把窗口还原，测完核对页面可见且实际耗时没拖长，否则这次作废重测
const ensureVisible = async () => { try { const w = await send("Browser.getWindowForTarget"); if (w.result && w.result.bounds && w.result.bounds.windowState !== "normal") await send("Browser.setWindowBounds", { windowId: w.result.windowId, bounds: { windowState: "normal" } }); } catch {} await send("Page.bringToFront"); };
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("__timeout__"), ms))]);
let stalls = 0;
let curCss = null;
const go = async (css) => { if (css === curCss) return; await send("Page.navigate", { url: `${HOST}?css=${css}` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400); curCss = css; };

const MAIN = ["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "UpdateLayer", "HitTest"];
async function traceOnce(ms) {
  await send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "gpu", "viz", "toplevel"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReturnAsStream" });
  const t0 = Date.now();
  const frames = await withTimeout(ev(`frames(${ms})`), ms + 10000);
  const wall = Date.now() - t0;
  const vis = await withTimeout(ev("document.visibilityState"), 5000);
  await send("Tracing.end");
  const done = await waitEvent("Tracing.tracingComplete");
  if (!done) { console.error("trace timeout, skip"); return null; }
  if (frames === "__timeout__" || vis !== "visible" || wall > ms + 1500) { stalls++; console.error(`[stall] 作废这次测量：frames=${frames} vis=${vis} wall=${wall}ms`); await ensureVisible(); return null; }
  let data = ""; for (;;) { const r = await send("IO.read", { handle: done.params.stream, size: 1 << 22 }); data += r.result.base64Encoded ? Buffer.from(r.result.data, "base64").toString() : r.result.data; if (r.result.eof) break; }
  await send("IO.close", { handle: done.params.stream });
  const t = JSON.parse(data); const events = t.traceEvents || t;
  const tname = {}; for (const e of events) if (e.ph === "M" && e.name === "thread_name") tname[`${e.pid}:${e.tid}`] = e.args.name;
  const sum = {}; const add = (k, v) => (sum[k] = (sum[k] || 0) + v);
  const cnt = {}; const inc = (k, n = 1) => (cnt[k] = (cnt[k] || 0) + n);
  const dump = {};
  const paintDurs = [], paintTs = [];
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    const th = tname[`${e.pid}:${e.tid}`] || "";
    if (process.env.PERF_DUMP) { const k = `${th}|${e.name}`; dump[k] = (dump[k] || 0) + 1; }
    if (th === "CrRendererMain") { if (e.name === "Paint") { inc("nPaint"); paintDurs.push(e.dur); paintTs.push(e.ts); } else if (["PrePaint", "UpdateLayoutTree", "Commit", "Layout"].includes(e.name)) inc("n" + e.name); }
    else if ((th.startsWith("CompositorTileWorker") || th.startsWith("ThreadPoolForegroundWorker")) && e.name === "RasterTask") { inc("nRaster"); add("rasterMs", e.dur); }
    else if (th === "CrGpuMain" && (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask")) inc("nGpuTask");
    if (th === "CrRendererMain") { if (MAIN.includes(e.name)) add(e.name, e.dur); if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("mainBusy", e.dur); }
    else if (th.startsWith("CompositorTileWorker")) { if (e.name === "RasterTask" || e.name.startsWith("TaskGraphRunner")) add("raster", e.dur); }
    else if (th === "Compositor" || th === "VizCompositorThread") { if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("compositor", e.dur); }
    else if (th === "CrGpuMain") { if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("gpu", e.dur); }
  }
  const per = { fps: +(frames / (ms / 1000)).toFixed(1) };
  for (const [k, v] of Object.entries(sum)) per[k] = +(v / 1000 / frames).toFixed(2);
  // 每秒事件数（按追踪窗口 ms 折算）与 Paint 时长分布
  for (const [k, v] of Object.entries(cnt)) per[k + "PS"] = +(v / (ms / 1000)).toFixed(1);
  // 把间隔 <8ms 的 Paint 事件归为同一个"有绘制的帧"（一帧里常有多个 Paint 事件），折算每秒有绘制的帧数
  paintTs.sort((a, b) => a - b); let pf = 0, lastTs = -1e9; for (const t of paintTs) { if (t - lastTs > 8000) pf++; lastTs = t; }
  per.paintFramesPS = +(pf / (ms / 1000)).toFixed(1);
  per.paintBigPS = +(paintDurs.filter((d) => d > 300).length / (ms / 1000)).toFixed(1);
  per.paintMaxMs = +(Math.max(0, ...paintDurs) / 1000).toFixed(2);
  if (process.env.PERF_DUMP) { const top = Object.entries(dump).sort((a, b) => b[1] - a[1]).slice(0, 60); console.error(JSON.stringify(top)); }
  return per;
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const s of scen) {
  await go(s.css || "prod");
  // 可选：场景里写 "cpu": 4 即 CPU 降速 4 倍（Emulation.setCPUThrottlingRate）；不写为 1（不降速）
  await send("Emulation.setCPUThrottlingRate", { rate: s.cpu || 1 });
  const elements = await ev(`setup(${s.n}, ${JSON.stringify(s.attrs || [])})`);
  if (s.js2) await ev(`jsDrive2(${JSON.stringify(s.js2[0])}, ${JSON.stringify(s.js2[1])}, ${s.js2[2]})`); 
  await ev(`typeof jsDrive === 'function' && jsDrive(${JSON.stringify(s.js ? s.js[0] : '')}, ${s.js ? s.js[1] : 0})`).catch(() => {});
  let probe = null;
  if (s.probe && !(s.attrs && s.attrs.engine === "svg")) { await sleep(500); probe = await ev("sampleP(2000)"); }
  const runs = [];
  if (!s.noTrace) for (let k = 0; k < REPS; k++) { let r = null; for (let tries = 0; tries < 5 && !r; tries++) { await ensureVisible(); await sleep(800); r = await traceOnce(2500); } if (r) runs.push(r); }
  const keys = [...new Set(runs.flatMap(Object.keys))];
  const out = { name: s.name, elements }; for (const k of keys) out[k] = med(runs.map((r) => r[k] ?? 0));
  if (s.toggle) { const xs = []; for (let k = 0; k < (s.toggleN || 5); k++) { let v = "__timeout__"; for (let tries = 0; tries < 3 && v === "__timeout__"; tries++) { await ensureVisible(); v = await withTimeout(ev("toggleCost()"), 15000); } xs.push(v); } out.toggleMs = +med(xs).toFixed(1); }
  if (s.snap) out.snap = await ev("snap()");
  if (probe) out.probe = probe;
  if (s.attrs && s.attrs.engine === "svg") out.svgPatched = await ev("window.__svgPatched");
  await send("Emulation.setCPUThrottlingRate", { rate: 1 });
  out.stalls = stalls; stalls = 0;
  console.log(JSON.stringify(out));
}
await send("Browser.close").catch(() => {});
process.exit(0);
