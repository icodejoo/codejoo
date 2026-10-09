// 通过 CDP 驱动独立 Chrome 跑 demo/bench.html 的 bench()，输出每帧平均耗时中位数
const PORT = 9333;
const URL = "http://localhost:5188/demo/bench.html";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tabs;
for (let i = 0; i < 50; i++) {
  try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); }
}
const page = tabs.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
};

await send("Page.enable");
await send("Page.bringToFront");
await send("Page.navigate", { url: URL });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(300);

const configs = [
  ["shimmer叶子 linear", [["x-ske-text", "leaf"], ["x-ske-effect", "shimmer"]]],
  ["shimmer叶子 30fps", [["x-ske-text", "leaf"], ["x-ske-effect", "shimmer"], ["style", "--x-ske-shimmer-timing: steps(45)"]]],
  ["shimmer叶子 24fps", [["x-ske-text", "leaf"], ["x-ske-effect", "shimmer"], ["style", "--x-ske-shimmer-timing: steps(36)"]]],
];
const sizes = [500, 2000];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const res = {};
for (let rep = 0; rep < 5; rep++) {
  for (const n of sizes) {
    const order = rep % 2 ? [...configs].reverse() : configs;
    for (const [name, attrs] of order) {
      const r = await ev(`bench(${n}, ${JSON.stringify(attrs)}, 2000)`);
      ((res[name + " " + r.elements] ??= [])).push(r.avg_ms);
    }
  }
  console.error("rep", rep);
}
for (const [k, v] of Object.entries(res)) console.log(k + "	median " + med(v) + "	[" + v.join(", ") + "]");
await send("Browser.close").catch(() => {});
process.exit(0);
