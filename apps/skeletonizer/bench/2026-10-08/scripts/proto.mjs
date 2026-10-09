// 根驱动动画 / content-visibility 原型：先做正确性取样，再交替测每帧耗时
const PORT = 9333, URL = "http://localhost:5188/demo/bench.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Page.navigate", { url: URL });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
await sleep(500);

const L = ["x-ske-legacy-anim", ""], CV = ["x-ske-cv", ""];
const PU = ["x-ske-effect", "pulse"], SH = ["x-ske-effect", "shimmer"], LEAF = ["x-ske-text", "leaf"];

// 正确性：同一骨头隔 700ms 取两次计算样式，变了才说明动画真的在起作用
const probe = (attrs) => ev(`(async () => {
  build(20); const root = window.root;
  root.getAttributeNames().forEach((a) => a !== "id" && root.removeAttribute(a));
  ${JSON.stringify(attrs)}.forEach(([k, v]) => root.setAttribute(k, v)); root.setAttribute("x-ske", "");
  const img = root.querySelector("img"), h3 = root.querySelector("h3");
  const nf = () => new Promise((r) => requestAnimationFrame(r)); await nf(); await nf();
  const snap = () => ({ imgBg: getComputedStyle(img).backgroundColor, imgPos: getComputedStyle(img).backgroundPosition, h3Ul: getComputedStyle(h3).textDecorationColor, h3Bg: getComputedStyle(h3).backgroundColor, h3Pos: getComputedStyle(h3).backgroundPosition });
  const a = snap(); await new Promise((r) => setTimeout(r, 700)); const b = snap();
  root.removeAttribute("x-ske");
  const out = {}; for (const k in a) out[k] = a[k] === b[k] ? "静止 " + a[k] : "变化 " + a[k] + " → " + b[k];
  return out;
})()`);
for (const [name, attrs] of [
  ["pulse 旧", [PU, L]], ["pulse 根驱动", [PU]],
  ["shimmer 下划线 旧", [SH, L]], ["shimmer 下划线 根驱动", [SH]],
  ["shimmer 叶子 旧", [SH, LEAF, L]], ["shimmer 叶子 根驱动", [SH, LEAF]],
]) console.log("PROBE", name, JSON.stringify(await probe(attrs)));

const configs = [
  ["pulse 下划线 旧", [PU, L]], ["pulse 下划线 根驱动", [PU]], ["pulse 下划线 根驱动+cv", [PU, CV]],
  ["shimmer 下划线 旧", [SH, L]], ["shimmer 下划线 根驱动", [SH]],
  ["shimmer 叶子 旧", [SH, LEAF, L]], ["shimmer 叶子 根驱动", [SH, LEAF]], ["shimmer 叶子 根驱动+cv", [SH, LEAF, CV]],
];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const res = {};
for (let rep = 0; rep < 3; rep++) {
  for (const n of [500, 2000]) {
    for (const [name, attrs] of rep % 2 ? [...configs].reverse() : configs) {
      const r = await ev(`bench(${n}, ${JSON.stringify(attrs)}, 2000)`);
      (res[`${name} @${r.elements}`] ??= []).push(r.avg_ms);
    }
  }
  console.error("rep", rep);
}
for (const [k, v] of Object.entries(res)) console.log(`BENCH ${k}\tmedian ${med(v)}\t[${v.join(", ")}]`);
await send("Browser.close").catch(() => {});
process.exit(0);
