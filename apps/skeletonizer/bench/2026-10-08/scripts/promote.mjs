// 转正后验证：支持 / 模拟不支持 @property 两条路径的取样，加一次性能复测
const PORT = 9333, HOST = "http://localhost:5188/demo/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
const go = async (url) => { await send("Page.navigate", { url }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(400); };
await send("Page.enable"); await send("Page.bringToFront");

const PU = ["x-ske-effect", "pulse"], SH = ["x-ske-effect", "shimmer"], LEAF = ["x-ske-text", "leaf"], IGN = ["data-ign", ""];
for (const css of ["on", "off"]) {
  await go(`${HOST}.tmp-fb/fb.html?css=${css}`);
  for (const [name, attrs] of [["默认", []], ["pulse", [PU]], ["shimmer 下划线", [SH]], ["shimmer 叶子", [SH, LEAF]]])
    console.log(`PROBE [${css === "on" ? "支持" : "不支持"}] ${name}`, JSON.stringify(await ev(`probe(${JSON.stringify(attrs)})`)));
}
// 忽略区专测
for (const css of ["on", "off"]) {
  await go(`${HOST}.tmp-fb/fb.html?css=${css}`);
  const r = await ev(`(async () => {
    const root = document.getElementById("root");
    root.innerHTML = '<div class="card"><p>abc</p><button x-ske-ignore>取消</button></div>';
    root.getAttributeNames().forEach((a) => a !== "id" && root.removeAttribute(a));
    root.setAttribute("x-ske-effect", "shimmer"); root.setAttribute("x-ske", "");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return getComputedStyle(root).animationName;
  })()`);
  console.log(`IGNORE [${css === "on" ? "支持" : "不支持"}] shimmer 根动画: ${r}`);
}

await go(`${HOST}bench.html`);
const CV = ["x-ske-cv", ""];
const configs = [["pulse 下划线", [PU]], ["shimmer 下划线", [SH]], ["shimmer 叶子", [SH, LEAF]], ["shimmer 叶子 + cv", [SH, LEAF, CV]]];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const res = {};
for (let rep = 0; rep < 3; rep++) for (const n of [500, 2000]) for (const [name, attrs] of configs) {
  const r = await ev(`bench(${n}, ${JSON.stringify(attrs)}, 2000)`);
  (res[`${name} @${r.elements}`] ??= []).push(r.avg_ms);
}
for (const [k, v] of Object.entries(res)) console.log(`BENCH ${k}\tmedian ${med(v)}\t[${v.join(", ")}]`);
await send("Browser.close").catch(() => {});
process.exit(0);
