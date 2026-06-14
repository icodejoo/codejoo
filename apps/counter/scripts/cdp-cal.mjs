// 实验：拆解 calendar 的性能成本（阴影 / 3D 各占多少）
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
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

// 注入的实验性覆盖样式
const overrides = {
  baseline: "",
  // 关掉阴影动画（保留折叠）
  noshadow: `
    .cd-calendar-next.cd-flipping::before{animation:none!important}
    .cd-calendar-now.cd-flipping::after{animation:none!important}
    .cd-calendar-next.cd-flipping::after{animation:cd-foldin var(--_cd-duration) linear forwards!important}
    .cd-calendar-now.cd-flipping::before{animation:cd-foldout var(--_cd-duration) linear forwards!important}`,
  // 关阴影 + 去 3D 透视（折叠仍是 rotateX，但无 perspective，近似正交）
  noshadow_no3d: `
    .cd-calendar-num{perspective:none!important}
    .cd-calendar-next.cd-flipping::before{animation:none!important}
    .cd-calendar-now.cd-flipping::after{animation:none!important}
    .cd-calendar-next.cd-flipping::after{animation:cd-foldin var(--_cd-duration) linear forwards!important}
    .cd-calendar-now.cd-flipping::before{animation:cd-foldout var(--_cd-duration) linear forwards!important}`,
  // 用 filter:brightness 做"折叠变暗"替代 box-shadow（filter 动画走合成器）
  brightness: `
    @keyframes cd-b-out{0%{filter:brightness(1)}100%{filter:brightness(.4)}}
    @keyframes cd-b-in{0%{filter:brightness(.4)}100%{filter:brightness(1)}}
    .cd-calendar-now.cd-flipping::before{animation:cd-foldout var(--_cd-duration) linear forwards,cd-b-out var(--_cd-duration) linear forwards!important}
    .cd-calendar-now.cd-flipping::after{animation:cd-b-out var(--_cd-duration) linear forwards!important}
    .cd-calendar-next.cd-flipping::before{animation:cd-b-in var(--_cd-duration) linear forwards!important}
    .cd-calendar-next.cd-flipping::after{animation:cd-foldin var(--_cd-duration) linear forwards,cd-b-in var(--_cd-duration) linear forwards!important}`,
};

const out = [];
for (const [name, css] of Object.entries(overrides)) {
  await cmd("Page.navigate", { url: URL });
  await sleep(1300);
  if (css) await evaluate(`(()=>{const s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s);return 1})()`);
  await evaluate(`(document.getElementById("kind").value="calendar",document.getElementById("apply").click(),1)`);
  await sleep(600);
  out.push({ variant: name, ...(await traceFrames(3000)) });
}
console.log(JSON.stringify(out, null, 1));
ws.close();
chrome.kill();
process.exit(0);
