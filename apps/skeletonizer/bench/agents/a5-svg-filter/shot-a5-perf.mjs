// 性能页滤镜有效性校验截图：n=500/2000 在顶部、中部、底部各截一张视口，确认超高元素上滤镜真的生效。须经 run-locked-a5.mjs 拿锁。
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
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${HOST}?css=filter` });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
const cases = [
  ["A-light", { filter: "light", variant: "A", anim: "none" }],
  ["A-shimmer", { filter: "light", variant: "A", anim: "shimmer" }],
  ["A-dark", { filter: "dark", variant: "A", anim: "none" }],
];
for (const n of [500, 2000]) for (const [cn, spec] of cases) {
  const els = await ev(`setup(${n}, ${JSON.stringify(spec)})`);
  const H = await ev("document.documentElement.scrollHeight");
  for (const [pos, y] of [["top", 0], ["mid", Math.floor(H / 2)], ["bottom", H - 600]]) {
    await ev(`scrollTo(0, ${y})`); await sleep(1500);
    const r = await send("Page.captureScreenshot", { format: "png" });
    const f = `${OUT}/perf-n${n}-${cn}-${pos}.png`;
    fs.writeFileSync(f, Buffer.from(r.result.data, "base64"));
    console.log(f, "elements", els, "docH", H);
  }
}
// 校验滚动场景真的在滚：frames(1000) 前后读 scrollY
for (const spec of [{ filter: "light", variant: "A", anim: "none" }, []]) {
  await ev(`setup(2000, ${JSON.stringify(spec)})`);
  await ev("window.__scroll = true");
  const f = await ev("frames(1000)");
  console.log("scroll-check", JSON.stringify(spec), "frames", f, "scrollY", await ev("scrollY"), "docH", await ev("document.documentElement.scrollHeight"));
}
// 对照：同样位置不加滤镜（只 n=500）
await ev("setup(500, [])"); await ev("document.getElementById('root').removeAttribute('x-ske')"); await sleep(800);
const r = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(`${OUT}/perf-n500-raw-top.png`, Buffer.from(r.result.data, "base64"));
await send("Browser.close").catch(() => {});
process.exit(0);
