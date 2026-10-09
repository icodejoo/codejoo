// 视觉截图（第二批：深色主题媒体底色改浅 + 2x 放大文字对照）：对 visual.html 的各种参数组合截图，存到 shots/。须经 run-locked-a5.mjs 拿锁运行。
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
  ["10-A-dark-mediabg-light", "mode=A&theme=dark&mbg=light"],
  ["11-B-dark-mediabg-light", "mode=B&theme=dark&mbg=light"],
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
// 2x 放大：长文字卡片 + 第一张卡片文字，raw 与 A
await send("Emulation.setDeviceMetricsOverride", { width: 1132, height: 900, deviceScaleFactor: 2, mobile: false });
for (const [name, qs] of [["12-raw-zoom2x", "mode=raw"], ["13-A-zoom2x", "mode=A"], ["14-A-r22-zoom2x", "mode=A&r=22"], ["15-A-r64-zoom2x", "mode=A&r=64"], ["16-C-zoom2x", "mode=C"]]) {
  await send("Page.navigate", { url: `${HOST}?${qs}` }); await sleep(1500);
  for (let i = 0; i < 40 && !(await ev("[...document.images].every(i=>i.complete)")); i++) await sleep(250);
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 16, y: 150, width: 560, height: 160, scale: 1 } });
  fs.writeFileSync(`${OUT}/${name}-card1.png`, Buffer.from(r.result.data, "base64"));
  const r2 = await send("Page.captureScreenshot", { format: "png", clip: { x: 16, y: 640, width: 560, height: 150, scale: 1 } });
  fs.writeFileSync(`${OUT}/${name}-longtext.png`, Buffer.from(r2.result.data, "base64"));
  console.log(name, qs);
}
await send("Browser.close").catch(() => {});
process.exit(0);
