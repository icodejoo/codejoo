// 画面等价核对：shimmer 时"带 pulse"与"不跑 pulse"（-nop）在同一冻结时刻的截图是否逐字节一致。
// 做法：用 Web Animations API 把页面所有动画暂停并把 currentTime 设为 450ms，两边停在同一时间点再截图（PNG 字节比较）。
// 由 run-locked.mjs 拉起（PERF_SCRIPT=equiv.mjs），argv[2] 是 JSON：[{ "name": "...", "css": "base,global,x-lin", "attrs": {...}, "freeze": true }]，截图写到 equiv/<name>.png
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const PORT = +(process.env.PERF_PORT || 9611), HOST = process.env.PERF_HOST;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "equiv");
fs.mkdirSync(OUT, { recursive: true });
const list = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 520, deviceScaleFactor: 1, mobile: false });
for (const v of list) {
  await send("Page.navigate", { url: `${HOST}?css=${v.css}` });
  for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
  await sleep(400);
  await ev(`setup(12, ${JSON.stringify(v.attrs)})`);
  await ev(`document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 450; })`);
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(shot.result.data, "base64");
  fs.writeFileSync(path.join(OUT, `${v.name}.png`), buf);
  const p = await ev(`getComputedStyle(document.getElementById("root")).getPropertyValue("--skz-shimmer-p") + " / " + getComputedStyle(document.getElementById("root")).getPropertyValue("--skz-pulse-c")`);
  console.log(JSON.stringify({ name: v.name, sha1: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12), bytes: buf.length, computed: p }));
}
await send("Browser.close").catch(() => {});
process.exit(0);
