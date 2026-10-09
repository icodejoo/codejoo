// SVG 方案验证：用正式构建 CSS + enable()，检查动画、深色、老浏览器模拟、暂停
const PORT = 9333, HOST = "http://localhost:5188/demo/.tmp-svg/perf.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const go = async (css) => { await send("Page.navigate", { url: `${HOST}?css=${css}` }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(500); };
await send("Page.enable"); await send("Page.bringToFront");
const check = async (label, opts, extra = "") => {
  const info = await ev(`(async () => {
    const { enable } = await import("/src/index.ts");
    const root = document.getElementById("root");
    await setup(20, [], false);
    ${extra}
    window.__off?.(); window.__off = enable(root, ${JSON.stringify(opts)});
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const img = root.querySelector("img"), after = getComputedStyle(root, "::after");
    const bi = getComputedStyle(img).backgroundImage;
    return { attrs: root.getAttributeNames().filter((a) => a !== "id").join(" "), rootAnim: getComputedStyle(root).animationName, bgImg: bi === "none" ? "none" : bi.slice(0, 26) + "…" + (bi.includes("opacity%3D%22.1%22") || bi.includes("%22.1%3B") || bi.includes("%3B.1%3B") ? "[深色]" : "[浅色]"), bgSize: getComputedStyle(img).backgroundSize, afterAnim: after.animationName };
  })()`);
  const clip = { x: 0, y: 0, width: 600, height: 300, scale: 1 }, shots = [];
  for (let k = 0; k < 4; k++) { shots.push((await send("Page.captureScreenshot", { format: "png", clip })).result.data); await sleep(250); }
  console.log(label, JSON.stringify({ ...info, 画面在动: new Set(shots).size > 1 }));
};
await go("prod");
await check("[支持] svg shimmer 叶子", { effect: "shimmer", text: "leaf", engine: "svg" });
await check("[支持] svg pulse 叶子", { effect: "pulse", text: "leaf", engine: "svg" });
await check("[支持] svg shimmer 深色", { effect: "shimmer", text: "leaf", engine: "svg" }, `document.documentElement.setAttribute("data-x-ske-theme","dark");`);
await check("[支持] svg shimmer 暂停", { effect: "shimmer", text: "leaf", engine: "svg" }, `document.documentElement.removeAttribute("data-x-ske-theme");`);
await ev(`document.getElementById("root").setAttribute("x-ske-paused",""); 0`);
console.log("  ↳ 打上 x-ske-paused 后：", JSON.stringify(await ev(`getComputedStyle(document.querySelector("#root img")).backgroundImage.slice(0,10)`)));
await check("[支持] css shimmer 叶子（对照）", { effect: "shimmer", text: "leaf" });
await go("prodOff");
await check("[模拟老浏览器] svg shimmer + fallback=sweep", { effect: "shimmer", text: "leaf", engine: "svg", fallback: "sweep" });
await check("[模拟老浏览器] css shimmer + fallback=sweep（对照）", { effect: "shimmer", text: "leaf", fallback: "sweep" });
await send("Browser.close").catch(() => {});
process.exit(0);
