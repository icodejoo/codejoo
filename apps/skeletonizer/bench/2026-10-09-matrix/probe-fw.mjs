// 探针：滚动到列表中部后，视口内的骨头是否还在动（防火墙正确性）。对照：纯 CSS（无防火墙）、滚回顶部。
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
let cur = null;
const go = async (css) => { if (css === cur) return; await send("Page.navigate", { url: `${HOST}?css=${css}` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400); cur = css; };
const hashes = async (k) => { const hs = []; for (let i = 0; i < k; i++) { const d = (await send("Page.captureScreenshot", { format: "png" })).result.data; hs.push(crypto.createHash("md5").update(d).digest("hex").slice(0, 6)); await sleep(130); } return hs; };
const state = `(() => { const cs = [...document.querySelectorAll("#root > .card")]; const v = cs.find((c) => { const r = c.getBoundingClientRect(); return r.top > 100 && r.bottom < innerHeight; }); const h = v && v.querySelector("h3"); const root = document.getElementById("root"); return { visibleIdx: cs.indexOf(v), fw: v && v.hasAttribute("skz-fw"), paused: root.hasAttribute("skz-paused"), h3pos: h && getComputedStyle(h).backgroundPosition, h3bg: h && getComputedStyle(h).backgroundImage.slice(0, 50), rootP: getComputedStyle(root).getPropertyValue("--skz-shimmer-p"), cardP: v && getComputedStyle(v).getPropertyValue("--skz-shimmer-p") }; })()`;
const out = [];
for (const [name, c, spec, text] of [["enable-fw", "base,global", { effect: "shimmer" }], ["css-nofw", "base,globalcss", [["skz-effect", "shimmer"]]], ["enable-fw-leaf", "base,global", { effect: "shimmer", text: "leaf" }]]) {
  await go(c); await ev(`setup(300, ${JSON.stringify(spec)})`); await sleep(600);
  const top = { state: await ev(state), hashes: await hashes(8) };
  await ev("scrollTo(0, document.documentElement.scrollHeight / 2); 0"); await sleep(800);
  const mid = { state: await ev(state), hashes: await hashes(8) }; await sleep(130);
  const mid2 = await ev(state);
  const rec = { name, top: { ...top, unique: new Set(top.hashes).size }, mid: { ...mid, unique: new Set(mid.hashes).size }, mid2 }; console.log(JSON.stringify(rec)); out.push(rec);
}
fs.writeFileSync(path.join(HERE, "results", "probe-fw.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await send("Browser.close").catch(() => {});
process.exit(0);
