// 正确性抽查：每组 × 每系列截一张图，并读探针元素的计算样式。由 run-shot-locked.mjs 在拿锁期间启动。
// 探针：根里插入的未标记 <p>（probe-out，在标记区）；mix 组另在 skz-auto 外壳里插一个未标记 <p>（probe-in）。
import fs from "node:fs";
import path from "node:path";
const PORT = +(process.env.PERF_PORT || 9334), HOST = process.env.PERF_HOST;
const OUT = process.env.SHOT_DIR;
const GROUPS = { A: "auto&mode=auto", B: "scoped&mode=mark", C: "scoped&mode=autoroot", D: "explicit&mode=mark", E: "scoped&mode=mix" };
const SERIES = { U: [], L: [["skz-text", "leaf"]] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
const log = [];
for (const [g, css] of Object.entries(GROUPS)) for (const [s, attrs] of Object.entries(SERIES)) {
  await send("Page.navigate", { url: `${HOST}?css=${css}` });
  for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
  await sleep(300);
  await ev(`setup(10, ${JSON.stringify([["skz-effect", "pulse"], ...attrs])})`);
  // 插探针
  await ev(`(() => { const r = document.getElementById("root"); const p = document.createElement("p"); p.id = "probe-out"; p.textContent = "未标记段落（标记区，应是普通文字）"; r.insertBefore(p, r.firstChild);
    const d = r.querySelector("[skz-auto]"); if (d) { const q = document.createElement("p"); q.id = "probe-in"; q.textContent = "未标记段落（skz-auto 内，应是骨头）"; d.insertBefore(q, d.firstChild); } })()`);
  await sleep(300);
  const info = await ev(`(() => { const f = (el) => { if (!el) return null; const c = getComputedStyle(el); return { bg: c.backgroundColor, fill: c.webkitTextFillColor, vis: c.visibility, ul: c.textDecorationLine }; };
    const r = document.getElementById("root"); const cards = r.querySelectorAll(".card"); const first = cards[0]; const last = cards[cards.length - 1];
    return { rootAttrs: r.getAttributeNames(), probeOut: f(document.getElementById("probe-out")), probeIn: f(document.getElementById("probe-in")),
      firstH3: f(first.querySelector("h3")), firstImg: f(first.querySelector("img")), lastH3: f(last.querySelector("h3")), lastP: f(last.querySelector("p")), lastSpan: f(last.querySelector("span")), lastCardDiv: f(last.querySelector(":scope > div")) }; })()`);
  log.push({ group: g, series: s, ...info });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, `shot-${g}-${s}.png`), Buffer.from(shot.result.data, "base64"));
  console.log(JSON.stringify({ group: g, series: s, ...info }));
  // E 组：再滚到 skz-auto 外壳截一张，看自动区里的推导骨头
  if (g === "E") {
    await ev(`document.querySelector("[skz-auto]").scrollIntoView(); window.scrollBy(0, -40)`);
    await sleep(300);
    const s2 = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `shot-${g}-${s}-autozone.png`), Buffer.from(s2.result.data, "base64"));
  }
}
fs.writeFileSync(path.join(OUT, "shot-computed-styles.json"), JSON.stringify(log, null, 1));
await send("Browser.close").catch(() => {});
process.exit(0);
