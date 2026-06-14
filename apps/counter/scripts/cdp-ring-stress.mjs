// ring 压测：真实 Chrome 跑 100 实例，采 FPS / 掉帧 / JS 堆 / DOM 节点；对比 glow 开关与每秒/毫秒模式，并做泄漏检测。
// 用法：node scripts/cdp-ring-stress.mjs   （需先起 dev server：vite --port 5191）
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9344;
const BASE = "http://localhost:5191/ring-stress.html";
const profile = mkdtempSync(join(tmpdir(), "cdp-stress-"));
// 非 headless + 解除节流与帧率上限：让合成器以「能多快画多快」运行，DrawFrame 计数才反映真实光栅吞吐。
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--new-window",
  "--window-size=1000,1000",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  BASE + "?n=100&ms=1&glow=0",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ws_url() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === "page" && t.url.includes("ring-stress"));
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("no target");
}
const ws = new WebSocket(await ws_url());
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pend = new Map(),
  lis = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) (pend.get(m.id)(m), pend.delete(m.id));
  else if (m.method && lis.has(m.method)) lis.get(m.method)(m.params);
};
const cmd = (method, params = {}) => {
  const i = id++;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => {
    const to = setTimeout(() => {
      if (pend.has(i)) (pend.delete(i), r({ __timeout: true }));
    }, 15000);
    pend.set(i, (m) => (clearTimeout(to), r(m)));
  });
};
const evaluate = async (expr) => (await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

async function traceFrames(ms) {
  const ev = [];
  lis.set("Tracing.dataCollected", (p) => p.value && ev.push(...p.value));
  const done = new Promise((r) => lis.set("Tracing.tracingComplete", r));
  await cmd("Tracing.start", { transferMode: "ReportEvents", categories: "disabled-by-default-devtools.timeline.frame" });
  await sleep(ms);
  await cmd("Tracing.end");
  await done;
  lis.delete("Tracing.dataCollected");
  lis.delete("Tracing.tracingComplete");
  let drawn = 0,
    dropped = 0;
  for (const e of ev) {
    if (e.name === "DrawFrame") drawn++;
    else if (e.name === "DroppedFrame") dropped++;
  }
  return { fps: Math.round((drawn / ms) * 1000), drawn, dropped };
}
async function metrics() {
  const r = await cmd("Performance.getMetrics");
  const m = {};
  for (const { name, value } of r.result.metrics) m[name] = value;
  return m;
}
const gc = () => cmd("HeapProfiler.collectGarbage");
const heapMB = (m) => +(m.JSHeapUsedSize / 1048576).toFixed(2);

await cmd("Runtime.enable");
await cmd("Page.enable");
await cmd("Performance.enable");
await cmd("HeapProfiler.enable");

const ready = async () => {
  for (let i = 0; i < 50; i++) {
    if (await evaluate("!!(window.__count && window.__count() > 0)")) return;
    await sleep(150);
  }
};
async function nav(q) {
  await cmd("Page.navigate", { url: BASE + q });
  await ready();
  await sleep(1000);
}
async function phase(q, label, out) {
  await nav(q);
  const m0 = await metrics();
  const f = await traceFrames(5000);
  const m1 = await metrics();
  f.pageRafFps = await evaluate('Number(document.getElementById("fps").textContent)');
  // 5s 内各阶段累计耗时（秒）：脚本 / 样式重算 / 布局 / 总任务；其余≈光栅+合成+绘制
  const d = (k) => +(m1[k] - m0[k]).toFixed(3);
  f.scriptS = d("ScriptDuration");
  f.recalcStyleS = d("RecalcStyleDuration");
  f.layoutS = d("LayoutDuration");
  f.taskS = d("TaskDuration");
  f.otherS_rasterPaintComposite = +(f.taskS - f.scriptS - f.recalcStyleS - f.layoutS).toFixed(3);
  await gc();
  const m = await metrics();
  f.heapMB = heapMB(m);
  f.nodes = m.Nodes;
  out[label] = f;
}

await ready();
await sleep(1500);
const out = {};

// 纯 JS 全量重绘开销（与 GPU 无关，机器间可比）
await evaluate("__bench(100, 1000)");
out.JS_fullPaintCost = JSON.parse(await evaluate("JSON.stringify(__bench(800, 1000))"));

// glow 关：每帧重绘（最坏）与每秒（真实）的耗时分解
await phase("?n=100&ms=1&glow=0", "A_ms_everyFrame", out); // 优化对象
await phase("?n=100&ms=0&glow=0", "C_perSec", out); // 参考

// 泄漏检测
await nav("?n=100&ms=1&glow=0");
await evaluate("__teardown()");
await gc();
await gc();
await sleep(500);
const h0 = heapMB(await metrics());
for (let i = 0; i < 5; i++) {
  await evaluate("__mount(100, true)");
  await sleep(300);
  await evaluate("__teardown()");
  await sleep(200);
}
await gc();
await gc();
await sleep(500);
const h1 = heapMB(await metrics());
out.D_leak = { heapEmptyBeforeMB: h0, heapEmptyAfter5RoundsMB: h1, growthMB: +(h1 - h0).toFixed(2), nodes: (await metrics()).Nodes };

await evaluate("__mount(100, true)"); // 恢复展示
console.log(JSON.stringify(out, null, 2));
ws.close();
process.exit(0); // 留窗口给你肉眼看
