// 截图确认 SVG 背景真的在动：同一骨头区域隔 300ms 截两次，比较是否不同
const PORT = 9333, HOST = "http://localhost:5188/demo/.tmp-svg/perf.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Page.navigate", { url: `${HOST}?css=svg` });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
await sleep(500);
const LEAF = ["x-ske-text", "leaf"];
for (const [name, attrs] of [["svg shimmer", [["x-ske-effect", "shimmer"], LEAF, ["x-ske-svg", ""]]], ["svg pulse", [["x-ske-effect", "pulse"], LEAF, ["x-ske-svg", ""]]], ["solid 对照", [["x-ske-effect", "solid"], LEAF]]]) {
  await ev(`setup(20, ${JSON.stringify(attrs)})`);
  await sleep(500);
  const clip = { x: 0, y: 0, width: 600, height: 300, scale: 1 };
  const shots = [];
  for (let k = 0; k < 4; k++) { shots.push((await send("Page.captureScreenshot", { format: "png", clip })).result.data); await sleep(300); }
  const distinct = new Set(shots).size;
  const img = await ev(`getComputedStyle(document.querySelector("#root img")).backgroundImage.slice(0, 40)`);
  console.log(`${name}: 4 次截图里不同的帧数 = ${distinct}；图片骨头背景 = ${img}`);
  if (name === "svg shimmer") (await import("node:fs")).writeFileSync(process.argv[2] + "/svg-shimmer.png", Buffer.from(shots[1], "base64"));
}
await send("Browser.close").catch(() => {});
process.exit(0);
