// [a5 toggle 版：不测稳态，而是 trace 一次"开启"动作前后 2 秒内各线程总耗时（ms，非每帧）] 用 CDP Tracing 拆每帧耗时：主线程样式/布局/绘制，光栅线程，GPU。场景从 argv[2] 的 JSON 文件读
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
const ev = async (e) => { const r = await Promise.race([send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error("ev 超时 180s: " + e.slice(0, 60))), 180000))]); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const waitEvent = async (name, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = evs.findIndex((e) => e.method === name); if (i >= 0) return evs.splice(i, 1)[0]; await sleep(50); } return null; };
await send("Page.enable"); await send("Page.bringToFront");
let curCss = null;
const go = async (css) => { if (css === curCss) return; await send("Page.navigate", { url: `${HOST}?css=${css}` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400); curCss = css; };

const MAIN = ["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "UpdateLayer", "HitTest"];
async function traceToggle() {
  await ev("(()=>{const r=document.getElementById('root'); r.removeAttribute(toggleAttrName()); return 1})()");
  await ev("frames(800)");
  await send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "gpu", "viz", "toplevel"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReturnAsStream" });
  const t0 = await ev("(()=>{const t=performance.now(); document.getElementById('root').setAttribute(toggleAttrName(), toggleValue()); return t})()");
  const frames = await ev("frames(2000)");
  await send("Tracing.end");
  const done = await waitEvent("Tracing.tracingComplete");
  if (!done) return null;
  let data = ""; for (;;) { const r = await send("IO.read", { handle: done.params.stream, size: 1 << 22 }); data += r.result.base64Encoded ? Buffer.from(r.result.data, "base64").toString() : r.result.data; if (r.result.eof) break; }
  await send("IO.close", { handle: done.params.stream });
  const t = JSON.parse(data); const events = t.traceEvents || t;
  const tname = {}; for (const e of events) if (e.ph === "M" && e.name === "thread_name") tname[`${e.pid}:${e.tid}`] = e.args.name;
  const sum = {}; const add = (k, v) => (sum[k] = (sum[k] || 0) + v);
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    const th = tname[`${e.pid}:${e.tid}`] || "";
    if (th === "CrRendererMain") { if (MAIN.includes(e.name)) add(e.name, e.dur); }
    else if (th.startsWith("CompositorTileWorker")) { if (e.name === "RasterTask" || e.name.startsWith("TaskGraphRunner")) add("raster", e.dur); }
    else if (th === "Compositor" || th === "VizCompositorThread") { if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("compositor", e.dur); }
    else if (th === "CrGpuMain") { if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") add("gpu", e.dur); }
  }
  const out = { frames2s: frames };
  for (const [k, v] of Object.entries(sum)) out[k + "_ms"] = +(v / 1000).toFixed(1);
  return out;
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const s of scen) {
  await go(s.css || "prod");
  const elements = await ev(`setup(${s.n}, ${JSON.stringify(s.attrs || [])})`);
  const runs = [];
  for (let k = 0; k < REPS; k++) { await sleep(500); const r = await traceToggle(); if (r) runs.push(r); }
  const keys = [...new Set(runs.flatMap(Object.keys))];
  const out = { name: s.name, elements }; for (const k of keys) out[k] = med(runs.map((r) => r[k] ?? 0));
  console.log(JSON.stringify(out));
}
await send("Browser.close").catch(() => {});
process.exit(0);
