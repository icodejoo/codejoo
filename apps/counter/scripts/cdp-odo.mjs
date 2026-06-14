// 实验：odo-full 在 will-change 开/关、transform 用 calc(var()) vs 纯百分比 下的帧率与层数
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9337;
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
  return { fps: Math.round((drawn / ms) * 1000), dropPct: drawn + dropped ? Math.round((dropped / (drawn + dropped)) * 100) : 0 };
}
await cmd("Runtime.enable");
await cmd("Page.enable");

// odo-min 重绘来源排查：基线 / 把背景从滚动 span 移到静止 cell（span 透明，重绘只画字形）
const css = {
  baseline: "",
  bg_on_cell: `
    .cd-odometer-cell{background:var(--cd-bg,#333)}
    .cd-odometer-num>span{background:transparent!important}`,
};
const out = [];
for (let pass = 0; pass < 2; pass++) {
  for (const [name, override] of Object.entries(css)) {
    await cmd("Page.navigate", { url: URL });
    await sleep(1300);
    if (override) await evaluate(`(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(override)};document.head.appendChild(s);return 1})()`);
    await evaluate(`(document.getElementById("kind").value="odo-min",document.getElementById("apply").click(),1)`);
    await sleep(600);
    out.push({ variant: name + "#" + pass, ...(await traceFrames(3000)) });
  }
}
console.log(JSON.stringify(out, null, 1));
ws.close();
chrome.kill();
process.exit(0);
