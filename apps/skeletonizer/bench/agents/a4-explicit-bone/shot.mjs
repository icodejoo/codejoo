// 在持锁期间对 C(explicit) 与 A(叶子模式) 截图。用法：node shot.mjs（由 run-shot.mjs 在锁内启动）
import fs from "node:fs";
const PORT = +process.env.PERF_PORT, BASE = "http://localhost:5188/demo/.tmp-a4/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
const jobs = [
  ["perf-bone", "explicit", [["x-ske-effect", "pulse"]], "shot-C-explicit.png"],
  ["perf-bone", "explicit-nodesc", [["x-ske-effect", "pulse"]], "shot-C2-explicit-nodesc.png"],
  ["perf", "prod", [["x-ske-effect", "shimmer"], ["x-ske-text", "leaf"]], "shot-A-leaf.png"],
  ["perf", "prod", [], "shot-off.png"],
];
for (const [page, css, attrs, out] of jobs) {
  await send("Page.navigate", { url: `${BASE}${page}.html?css=${css}` });
  for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
  await sleep(500);
  const n = await ev(`setup(6, ${JSON.stringify(attrs)})`);
  if (out === "shot-off.png") await ev(`document.getElementById("root").removeAttribute("x-ske")`);
  await sleep(500);
  const info = await ev(`JSON.stringify({n:${n}, h3: getComputedStyle(document.querySelector("h3")).backgroundColor, h3color:getComputedStyle(document.querySelector("h3")).color, img:getComputedStyle(document.querySelector("img")).backgroundColor, btn:getComputedStyle(document.querySelector("button")).backgroundColor, p:getComputedStyle(document.querySelector("p")).backgroundColor, span:getComputedStyle(document.querySelector("span")).backgroundColor, i:getComputedStyle(document.querySelector("i")).backgroundColor})`);
  console.log(out, info);
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 640, height: 420, scale: 1 } });
  fs.writeFileSync(out, Buffer.from(r.result.data, "base64"));
}
await send("Browser.close").catch(() => {});
process.exit(0);
