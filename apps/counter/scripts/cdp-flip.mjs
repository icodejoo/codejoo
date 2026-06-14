// 实验：对比 flip 的几种实现的真实帧率（scaleY / 双面3D / 单卡3D）
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9335;
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

// 排查：到底是「重声明 animation+新关键帧」还是「静态面属性」恢复了合成
const variants = {
  real_base: "",
  // 只换 animation + 新关键帧（计时仍用 var(--cd-easing)，perspective 仍 var）
  kf_only: `
    @keyframes cd-2f-now{from{transform:rotateX(0)}to{transform:rotateX(-180deg)}}
    @keyframes cd-2f-next{from{transform:rotateX(180deg)}to{transform:rotateX(0)}}
    .cd-flip-now.cd-flipping{animation:cd-2f-now var(--_cd-duration) var(--cd-easing,ease) forwards!important}
    .cd-flip-next.cd-flipping{animation:cd-2f-next var(--_cd-duration) var(--cd-easing,ease) forwards!important}`,
  // 只重声明静态面属性（不碰 animation/keyframes）
  static_only: `
    .cd-flip-cell{perspective:2.5em!important}
    .cd-flip-num{backface-visibility:hidden!important}
    .cd-flip-next{transform:rotateX(180deg)!important}`,
};
const out = [];
for (const [name, css] of Object.entries(variants)) {
  await cmd("Page.navigate", { url: URL });
  await sleep(1300);
  if (css) await evaluate(`(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return 1})()`);
  await evaluate(`(document.getElementById("kind").value="flip",document.getElementById("apply").click(),1)`);
  await sleep(600);
  out.push({ variant: name, ...(await traceFrames(3000)) });
}
console.log(JSON.stringify(out, null, 1));
ws.close();
chrome.kill();
process.exit(0);
