// 用 CDP Tracing 拆每帧耗时：主线程样式/布局/绘制，光栅线程，GPU。场景从 argv[2] 的 JSON 文件读
import fs from "node:fs";
const PORT = +(process.env.PERF_PORT || 9333), HOST = process.env.PERF_HOST || "http://localhost:5188/demo/.tmp-perf/perf.html";
const scen = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const REPS = +(process.argv[3] || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const evs = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method) evs.push(d); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await Promise.race([send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error("ev 超时 300s: " + e.slice(0, 60))), 300000))]); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const waitEvent = async (name, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = evs.findIndex((e) => e.method === name); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } return null; };
await send("Page.enable"); await send("Page.bringToFront");
let curCss = null;
const go = async (css) => { if (css === curCss) return; await send("Page.navigate", { url: `${HOST}?css=${css}` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400); curCss = css; };

const MAIN = ["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "UpdateLayer", "HitTest"];
let IDLE = false;
async function traceOnce(ms) {
  await send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "gpu", "viz", "toplevel"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReturnAsStream" });
  const frames = await ev(IDLE ? `idleWait(${ms})` : `frames(${ms})`);
  await send("Tracing.end");
  const done = await waitEvent("Tracing.tracingComplete");
  if (!done) { console.error("trace timeout, skip"); return null; }
  let data = ""; for (;;) { const r = await send("IO.read", { handle: done.params.stream, size: 1 << 22 }); data += r.result.base64Encoded ? Buffer.from(r.result.data, "base64").toString() : r.result.data; if (r.result.eof) break; }
  await send("IO.close", { handle: done.params.stream });
  const t = JSON.parse(data); const events = t.traceEvents || t;
  const tname = {}; for (const e of events) if (e.ph === "M" && e.name === "thread_name") tname[`${e.pid}:${e.tid}`] = e.args.name;
  const sum = {}; const add = (k, v) => (sum[k] = (sum[k] || 0) + v);
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    const th = tname[`${e.pid}:${e.tid}`] || "";
    if (th === "CrRendererMain") { if (MAIN.includes(e.name)) add(e.name, e.dur); if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("mainBusy", e.dur); }
    else if (th.startsWith("CompositorTileWorker")) { if (e.name === "RasterTask" || e.name.startsWith("TaskGraphRunner")) add("raster", e.dur); }
    else if (th === "Compositor" || th === "VizCompositorThread") { if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("compositor", e.dur); }
    else if (th === "CrGpuMain") { if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("gpu", e.dur); }
  }
  const per = { fps: +(frames / (ms / 1000)).toFixed(1) };
  { const an = events.filter((e) => e.name === "Animation" && e.args && e.args.data).map((e) => ({ ph: e.ph, ...e.args.data })); if (an.length) { const o = {}; for (const a of an) o[JSON.stringify({ state: a.state, compositeFailed: a.compositeFailed, unsupportedProperties: a.unsupportedProperties, displayName: a.displayName })] = (o[JSON.stringify({ state: a.state, compositeFailed: a.compositeFailed, unsupportedProperties: a.unsupportedProperties, displayName: a.displayName })] || 0) + 1; fs.appendFileSync("diag-animation-events.jsonl", JSON.stringify({ scen: globalThis.__curName, summary: o }) + String.fromCharCode(10)); } }
  { const th = {}; for (const e of events) { if (e.ph !== "X" || !e.dur) continue; if (e.name !== "ThreadControllerImpl::RunTask" && e.name !== "RunTask" && e.name !== "RasterTask" && e.name !== "ThreadPool_RunTask") continue; const n = (tname[`${e.pid}:${e.tid}`] || "?").replace(/\d+$/, "#"); th[n] = (th[n] || 0) + e.dur; } const o = {}; for (const [k, v] of Object.entries(th)) o[k] = +(v / 1000 / frames).toFixed(2); fs.appendFileSync("diag-threads.jsonl", JSON.stringify({ scen: globalThis.__curName, msPerFrame: o }) + String.fromCharCode(10)); }
  const nDraw = events.filter((e) => e.name === "LayerTreeHostImpl::DrawLayers" || e.name === "DrawLayers").length;
  const nSwap = events.filter((e) => e.name === "Display::DrawAndSwap").length;
  per.drawFps = +(nDraw / (ms / 1000)).toFixed(1); per.swapFps = +(nSwap / (ms / 1000)).toFixed(1); if (IDLE) per.fps = per.swapFps;
  const names = {}; for (const e of events) if (e.ph === "X" || e.ph === "B") names[e.name] = (names[e.name] || 0) + 1;
  if (process.env.PERF_DUMP) fs.writeFileSync(process.env.PERF_DUMP, JSON.stringify(Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 80)));
  const wthreads = {}; for (const e of events) if (e.ph === "X" && e.dur) { const th = tname[`${e.pid}:${e.tid}`] || ""; if (/Worklet|Paint/i.test(th)) wthreads[th] = (wthreads[th] || 0) + e.dur; }
  for (const [k, v] of Object.entries(wthreads)) per["th:" + k] = v;
  per.mode = IDLE ? "idle" : "raf";
  for (const [k, v] of Object.entries(sum)) per[k] = +(v / 1000 / frames).toFixed(2);
  return per;
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const s of scen) {
  await go(s.css || "prod");
  const elements = await ev(`setup(${s.n}, ${JSON.stringify(s.attrs || [])})`);
  let protoRes = null;
  if (s.prepre) await ev(s.prepre);
  if (s.proto) { protoRes = await ev(`proto(${JSON.stringify(s.proto)})`); await sleep(1500); }
  if (s.pre) { await ev(s.pre); await sleep(800); }
  globalThis.__curName = s.name; IDLE = !!s.idle;
  if (s.js2) await ev(`jsDrive2(${JSON.stringify(s.js2[0])}, ${JSON.stringify(s.js2[1])}, ${s.js2[2]})`); 
  await ev(`typeof jsDrive === 'function' && jsDrive(${JSON.stringify(s.js ? s.js[0] : '')}, ${s.js ? s.js[1] : 0})`).catch(() => {});
  const runs = [];
  if (!s.noTrace) for (let k = 0; k < REPS; k++) { await sleep(800); const r = await traceOnce(2500); if (r) runs.push(r); }
  const keys = [...new Set(runs.flatMap(Object.keys))];
  const out = { name: s.name, elements }; for (const k of keys) out[k] = med(runs.map((r) => r[k] ?? 0));
  if (protoRes) out.proto = protoRes;
  if (s.resize) out.resize = await ev("testResize()");
  if (s.toggle) { const xs = []; for (let k = 0; k < (s.toggleN || 5); k++) xs.push(await ev("toggleCost()")); out.toggleMs = +med(xs).toFixed(1); }
  console.log(JSON.stringify(out));
}
if (!process.env.PERF_KEEP) await send("Browser.close").catch(() => {});
process.exit(0);
