// 正确性抽查：每种实现截 3 张图（间隔数百 ms）+ 读计算样式，确认动画确实在动。
// 必须在拿锁期间跑：PERF_SCRIPT=<本文件> PERF_VIEWPORT=1200x800 node bench/kit/run-locked.mjs 9351 <配置目录> <任意json> <基准页URL> 1
// 输出 results/verify.jsonl，截图写到 shots/
import fs from "node:fs";
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
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; const to = setTimeout(() => { console.error("TIMEOUT", method, JSON.stringify(params).slice(0, 120)); j(new Error("timeout " + method)); }, 30000); pend.set(i, (d) => { clearTimeout(to); r(d); }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
let cur = null;
const go = async (css) => { if (css === cur) return; await send("Page.navigate", { url: `${HOST}?css=${css}` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400); cur = css; };
const shot = async () => (await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 640, height: 360, scale: 1 } })).result.data;

const FORM = "form";
const css = (e, more = []) => [["skz-effect", e], ...more];
const CASES = [
  ["fade", "base", { effect: "fade" }, "应动"],
  ["solid", "base", { effect: "solid" }, "应静止"],
  ["sweep", "base,sweep", { effect: "sweep" }, "应动"],
  ["sweep-bg", "base,sweep", { effect: "sweep", _attrs: [["skz-sweep", "bg"]] }, "应动"],
  ["pulse-css", "base,globalcss", css("pulse"), "应动"],
  ["shimmer-css", "base,globalcss", css("shimmer"), "应动"],
  ["pulse-enable", "base,global", { effect: "pulse" }, "应动"],
  ["shimmer-enable", "base,global", { effect: "shimmer" }, "应动"],
  ["pulse-svg", "base,svg", { effect: "pulse", engine: "svg" }, "应动"],
  ["shimmer-svg", "base,svg", { effect: "shimmer", engine: "svg" }, "应动"],
  ["shimmer-leaf-enable", "base,global", { effect: "shimmer", text: "leaf" }, "应动"],
  ["shimmer-leaf-svg", "base,svg", { effect: "shimmer", text: "leaf", engine: "svg" }, "应动"],
  ["explicit-shimmer-css", "explicit,globalcss", css("shimmer"), "应动"],
  ["explicit-shimmer-enable", "explicit,global", { effect: "shimmer" }, "应动"],
  ["explicit-shimmer-svg", "explicit,svg", { effect: "shimmer", engine: "svg" }, "应动"],
  ["form-shimmer-default", `base,global,${FORM}`, { effect: "shimmer" }, "应动（防火墙对 2 个大栏无效）"],
  ["form-shimmer-svg", `base,svg,${FORM}`, { effect: "shimmer", engine: "svg" }, "应动"],
  ["form-shimmer-fps24-noio", `base,global,${FORM},noio`, { effect: "shimmer", fps: 24 }, "应动（计时器）"],
  ["form-shimmer-fpsauto-noio", `base,global,${FORM},noio`, { effect: "shimmer", fps: "auto" }, "应动（计时器）"],
  ["form-pulse-fps24-noio", `base,global,${FORM},noio`, { effect: "pulse", fps: 24 }, "应动（计时器）"],
  ["shimmer-fit", "base,global", { effect: "shimmer", fit: true }, "应动"],
  ["shimmer-cv-enable", "base,global", { effect: "shimmer", _attrs: [["skz-cv", ""]] }, "应动"],
  ["shimmer-cv-css", "base,globalcss", css("shimmer", [["skz-cv", ""]]), "应动"],
  ["shimmer-steps36-css", "base,globalcss", css("shimmer", [["--skz-shimmer-timing", "steps(36)"]]), "应动（阶梯）"],
];
const only = process.env.VERIFY_ONLY ? process.env.VERIFY_ONLY.split(",") : null;
const out = [];
for (const [name, c, spec, expect] of CASES) {
  if (only && !only.includes(name)) continue;
  await go(c);
  const n = c.includes(FORM) ? 400 : 200;
  const elements = await ev(`setup(${n}, ${JSON.stringify(spec)})`);
  await sleep(700);
  const s0 = await ev("snap()"); const a = await shot(); await sleep(350);
  const s1 = await ev("snap()"); const b = await shot(); await sleep(230);
  const s2 = await ev("snap()"); const d = await shot();
  fs.writeFileSync(path.join(HERE, "shots", `${name}.png`), Buffer.from(a, "base64"));
  // 动画变量采样：根驱动读 --skz-shimmer-p / --skz-pulse-t，svg 看 skz-engine，计时器看内联变量
  const vars = await ev(`(() => { const r = document.getElementById("root"); const g = (k) => getComputedStyle(r).getPropertyValue(k).trim(); return { shimmerP: g("--skz-shimmer-p"), pulseT: g("--skz-pulse-t"), inlineStyle: r.getAttribute("style") && r.getAttribute("style").slice(0, 80) }; })()`);
  const moved = a !== b || b !== d;
  const rec = { name, expect, elements, viewport: await ev("({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})"), pixelsChange: { "t0→t1": a !== b, "t1→t2": b !== d }, moved, posSamples: [s0.probePos, s1.probePos, s2.probePos], afterTransform: [s0.afterTransform, s1.afterTransform, s2.afterTransform], rootAnim: s0.rootAnim, rootAttrs: s0.rootAttrs, fw: s0.fw, items: s0.items, vars };
  console.log(JSON.stringify(rec)); out.push(rec);
}
// 防火墙：滚到中间后标记重新分布，视口内项仍在动
await go("base,global");
await ev(`setup(300, { effect: "shimmer" })`); await sleep(600);
await ev("scrollTo(0, document.documentElement.scrollHeight / 2); 0"); await sleep(600);
const fwMid = await ev("snap()"); const m1 = await shot(); await sleep(350); const m2 = await shot();
const fwRec = { name: "firewall-scrolled-mid", fw: fwMid.fw, items: fwMid.items, visibleItems: fwMid.visibleItems, moved: m1 !== m2 };
console.log(JSON.stringify(fwRec)); out.push(fwRec);
fs.writeFileSync(path.join(HERE, "results", "verify.jsonl"), out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await send("Browser.close").catch(() => {});
process.exit(0);
