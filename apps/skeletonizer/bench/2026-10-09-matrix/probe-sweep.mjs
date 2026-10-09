// 探针：sweep 的 ::after 动画暂停在不同进度，看画面是否随之变化（排查"连拍 12 张画面完全相同"）
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PERF_PORT || 9351), HOST = process.env.PERF_HOST;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; const to = setTimeout(() => j(new Error("timeout " + method)), 30000); pend.set(i, (d) => { clearTimeout(to); r(d); }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${HOST}?css=base,sweep` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400);
const out = [];
for (const n of (process.env.PROBE_N || "20,60,100,115,130,200,500").split(",").map(Number)) {
  await ev(`setup(${n}, { effect: "sweep"${process.env.PROBE_BG ? ", _attrs: [[\"skz-sweep\", \"bg\"]]" : ""} })`); await sleep(500);
  const h = await ev("Math.round(document.getElementById(\"root\").getBoundingClientRect().height)");
  const hs = [];
  for (const t of [0, 600]) {
    await ev(`(() => { for (const a of document.getAnimations()) if (a.animationName === "skz-sweep") { a.pause(); a.currentTime = ${t}; } })()`); await sleep(250);
    const d = (await send("Page.captureScreenshot", { format: "png" })).result.data;
    if (n === 20 || n === 200) fs.writeFileSync(path.join(HERE, "shots", `probe-sweep-n${n}-t${t}.png`), Buffer.from(d, "base64"));
    hs.push(crypto.createHash("md5").update(d).digest("hex").slice(0, 6));
  }
  out.push({ n, rootHeight: h, changes: hs[0] !== hs[1], hs });
  console.log(JSON.stringify(out.at(-1)));
}
fs.writeFileSync(path.join(HERE, "results", "probe-sweep.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await send("Browser.close").catch(() => {});
process.exit(0);
