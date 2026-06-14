// ring 插件自检：headless Chrome 打开 ring-demo 的确定性单帧，截 #stage 存到 ref/。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9338;
const BASE = "http://localhost:5191/ring-demo.html";
// name -> query：静态单帧，便于比较旋向/熄灭方向与弧形布局
const SHOTS = [
  ["ring_arc_125", "?static=125&total=300"], // digits 回退 g+polygon、外2/外3圈 use 复用
  ["ring_arc_done", "?static=0&total=300"], // 归零重合
];

const profile = mkdtempSync(join(tmpdir(), "cdp-ring-"));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--window-size=520,520", "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ws_url() {
  for (let i = 0; i < 50; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("no target");
}
const ws = new WebSocket(await ws_url());
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) (pend.get(m.id)(m), pend.delete(m.id));
};
const cmd = (method, params = {}) => {
  const i = id++;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => pend.set(i, r));
};
const evaluate = async (expr) => (await cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await cmd("Runtime.enable");
await cmd("Page.enable");

for (const [name, query] of SHOTS) {
  await cmd("Page.navigate", { url: BASE + query });
  // 轮询：等 #stage 内出现已渲染的 svg（确保模块加载 + 单帧渲染完成）
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(150);
    ready = await evaluate(`!!(document.querySelector("#stage svg"))`);
  }
  if (!ready) {
    console.log("NOT READY for", name);
    continue;
  }
  await sleep(200);
  const rect = JSON.parse(await evaluate(`JSON.stringify((()=>{const r=document.getElementById("stage").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})())`));
  const shot = await cmd("Page.captureScreenshot", { format: "png", clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 2 } });
  const data = shot.result?.data;
  if (data) {
    const path = join("D:/workspaces/codejoo/apps/counter/ref", name + ".png");
    writeFileSync(path, Buffer.from(data, "base64"));
    console.log("SAVED", path);
  } else {
    console.log("NO DATA for", name);
  }
}

ws.close();
chrome.kill();
process.exit(0);
