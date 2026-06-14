// 诊断：抓 odo-full 的主线程事件耗时分布（RecalcStyle/Layout/Paint/Composite/Script）+ 合成层数量
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const MODE = process.argv[2] || "odo-full";
const URL = "http://127.0.0.1:5180/stress.html";
const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--new-window", URL]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ws_url() {
  for (let i = 0; i < 50; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === "page" && t.url.includes("stress.html"));
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
  return new Promise((r) => pend.set(i, r));
};
const evaluate = async (expr) => (await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await cmd("Runtime.enable");
await cmd("Page.enable");
await cmd("Page.navigate", { url: URL });
await sleep(1300);
await evaluate(`(document.getElementById("kind").value=${JSON.stringify(MODE)},document.getElementById("apply").click(),1)`);
await sleep(600);

// 抓 3s 完整 timeline，按事件名汇总耗时（X 类事件带 dur，单位 µs）
const ev = [];
lis.set("Tracing.dataCollected", (p) => p.value && ev.push(...p.value));
const done = new Promise((r) => lis.set("Tracing.tracingComplete", r));
await cmd("Tracing.start", {
  transferMode: "ReportEvents",
  categories: "disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,v8.execute",
});
await sleep(3000);
await cmd("Tracing.end");
await done;

const TRACK = ["RunTask", "FunctionCall", "UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Layerize", "UpdateLayer", "CompositeLayers", "Commit", "ScrollLayer", "RasterTask", "DecodeImage"];
const sum = {},
  cnt = {};
let drawn = 0,
  dropped = 0;
for (const e of ev) {
  if (e.name === "DrawFrame") drawn++;
  else if (e.name === "DroppedFrame") dropped++;
  if (e.ph === "X" && e.dur && TRACK.includes(e.name)) {
    sum[e.name] = (sum[e.name] || 0) + e.dur;
    cnt[e.name] = (cnt[e.name] || 0) + 1;
  }
}
const rows = Object.keys(sum)
  .map((k) => ({ event: k, total_ms: +(sum[k] / 1000).toFixed(1), calls: cnt[k], avg_us: Math.round(sum[k] / cnt[k]) }))
  .sort((a, b) => b.total_ms - a.total_ms);

// 合成层数量
const layers = await (async () => {
  await cmd("LayerTree.enable");
  const got = new Promise((r) => lis.set("LayerTree.layerTreeDidChange", (p) => r(p.layers?.length || 0)));
  await sleep(500);
  return Promise.race([got, sleep(1500).then(() => -1)]);
})();

console.log(`mode=${MODE}  fps=${Math.round((drawn / 3000) * 1000)}  drop%=${drawn + dropped ? Math.round((dropped / (drawn + dropped)) * 100) : 0}  layers=${layers}`);
console.table(rows);
ws.close();
chrome.kill();
process.exit(0);
