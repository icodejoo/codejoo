// 计时器验证：画面在动、颜色随主题、变量在变
const PORT = 9333, HOST = "http://localhost:5188/demo/.tmp-tick/perf.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Page.navigate", { url: HOST });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
await sleep(500);
for (const [label, opts, dark] of [["pulse 叶子 fps30", { effect: "pulse", text: "leaf", fps: 30 }, false], ["shimmer 叶子 fps30", { effect: "shimmer", text: "leaf", fps: 30 }, false], ["pulse 叶子 fps30 深色", { effect: "pulse", text: "leaf", fps: 30 }, true], ["shimmer 下划线 fps24", { effect: "shimmer", fps: 24 }, false]]) {
  await ev(`document.documentElement.toggleAttribute("data-x-ske-theme", ${dark}); ${dark} && document.documentElement.setAttribute("data-x-ske-theme","dark"); setup(20, ${JSON.stringify(opts)})`);
  await sleep(300);
  const snap = () => ev(`(() => { const r = document.getElementById("root"), b = r.querySelector("h3"); return { attrs: r.getAttributeNames().filter(a => a !== "id").join(" "), rootAnim: getComputedStyle(r).animationName, t: r.style.getPropertyValue("--x-ske-pulse-t"), p: r.style.getPropertyValue("--x-ske-shimmer-p"), bg: getComputedStyle(b).backgroundColor, pos: getComputedStyle(b).backgroundPosition }; })()`);
  const a = await snap(); await sleep(450); const b = await snap();
  const clip = { x: 0, y: 0, width: 600, height: 300, scale: 1 }, shots = [];
  for (let k = 0; k < 4; k++) { shots.push((await send("Page.captureScreenshot", { format: "png", clip })).result.data); await sleep(200); }
  console.log(label, JSON.stringify({ attrs: a.attrs, rootAnim: a.rootAnim, pulseT: `${a.t} → ${b.t}`, shimmerP: `${a.p} → ${b.p}`, 骨头颜色: `${a.bg} → ${b.bg}`, 画面在动: new Set(shots).size > 1 }));
}
await send("Browser.close").catch(() => {});
process.exit(0);
