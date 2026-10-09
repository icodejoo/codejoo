// 视觉截图：对 visual.html 的各种参数组合截图，存到 shots/。须经 run-locked-a5.mjs 拿锁运行。
// 用法：node run-locked-a5.mjs <port> <profile> shot-a5.mjs <visual 页面 URL> <输出目录>
import fs from "node:fs";
const PORT = +(process.env.PERF_PORT || 9345), HOST = process.env.PERF_HOST;
const OUT = process.argv[2] || "shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result.result.value;
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1132, height: 900, deviceScaleFactor: 1, mobile: false });
// 名称 -> 查询参数
const SHOTS = [
  ["01-raw-light", "mode=raw"],
  ["02-A-light", "mode=A"],
  ["03-B-light", "mode=B"],
  ["04-C-light", "mode=C"],
  ["05-raw-dark", "mode=raw&theme=dark"],
  ["06-A-dark", "mode=A&theme=dark"],
  ["07-B-dark", "mode=B&theme=dark"],
  ["08-A-light-r22", "mode=A&r=22"],
  ["09-A-light-r64", "mode=A&r=64"],
];
for (const [name, qs] of SHOTS) {
  await send("Page.navigate", { url: `${HOST}?${qs}` });
  await sleep(1200);
  for (let i = 0; i < 40 && !(await ev("[...document.images].every(i=>i.complete)")); i++) await sleep(250);
  await sleep(500);
  const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1132, height: h, scale: 1 } });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64"));
  console.log(name, qs, h);
}
await send("Browser.close").catch(() => {});
process.exit(0);
