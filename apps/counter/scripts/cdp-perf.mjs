// 用 CDP 驱动真实 Chrome，按 DevTools FPS 表的来源（合成器 DrawFrame/DroppedFrame）测量各模式真实帧率
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const URL = "http://127.0.0.1:5180/stress.html";

const profile = mkdtempSync(join(tmpdir(), "cdp-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--new-window", URL]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.includes("stress.html"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("page target not found");
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res) => (ws.onopen = res));
let nextId = 1;
const pending = new Map();
const listeners = new Map(); // method -> fn
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method && listeners.has(m.method)) {
    listeners.get(m.method)(m.params);
  }
};
const on = (method, fn) => listeners.set(method, fn);
function cmd(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}
async function evaluate(expr) {
  const r = await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
}

// 抓 traceMs 毫秒的合成器帧事件，统计 DrawFrame / DroppedFrame
async function traceFrames(traceMs) {
  const events = [];
  on("Tracing.dataCollected", (p) => p.value && events.push(...p.value));
  const done = new Promise((res) => on("Tracing.tracingComplete", res));
  await cmd("Tracing.start", { transferMode: "ReportEvents", categories: "disabled-by-default-devtools.timeline.frame,benchmark,viz" });
  await sleep(traceMs);
  await cmd("Tracing.end");
  await done;
  listeners.delete("Tracing.dataCollected");
  listeners.delete("Tracing.tracingComplete");
  let drawn = 0,
    dropped = 0;
  for (const e of events) {
    if (e.name === "DrawFrame") drawn++;
    else if (e.name === "DroppedFrame") dropped++;
  }
  return { drawn, dropped, fps: Math.round((drawn / traceMs) * 1000), dropPct: drawn + dropped ? Math.round((dropped / (drawn + dropped)) * 100) : 0 };
}

await cmd("Runtime.enable");
await cmd("Page.enable");

const results = [];
for (const kind of ["flip", "calendar", "slide", "odo-min", "odo-full"]) {
  await cmd("Page.navigate", { url: URL });
  await sleep(1300);
  await evaluate(`(document.getElementById("kind").value=${JSON.stringify(kind)}, document.getElementById("apply").click(), 1)`);
  await sleep(600); // 动画起来
  const fr = await traceFrames(3000);
  const nodes = await evaluate(`document.querySelectorAll("*").length`);
  results.push({ mode: kind, ...fr, nodes });
}
console.log(JSON.stringify(results, null, 1));
ws.close();
chrome.kill();
process.exit(0);
