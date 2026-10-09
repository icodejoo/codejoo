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



  ["pulse(下划线)", [["x-ske-effect", "pulse"]]],
  ["shimmer(下划线)", [["x-ske-effect", "shimmer"]]],
  ["pulse(叶子)", [["x-ske-text", "leaf"], ["x-ske-effect", "pulse"]]],
  ["shimmer(叶子)", [["x-ske-text", "leaf"], ["x-ske-effect", "shimmer"]]],
];
const sizes = [19, 38, 75, 125];
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const rows = [];
// 对照：无骨架
for (const n of sizes) {
  const runs = [];
  for (let k = 0; k < 3; k++) {
    runs.push(await ev(`(async()=>{build(${n});const nf=()=>new Promise(r=>requestAnimationFrame(r));await nf();await nf();const d=[];let l=performance.now();const e=l+2000;while(performance.now()<e){await nf();const t=performance.now();d.push(t-l);l=t;}return +(d.reduce((a,b)=>a+b,0)/d.length).toFixed(1)})()`));
  }
  rows.push({ config: "无骨架(对照)", n, runs, median: med(runs) });
}
for (const [name, attrs] of configs) {
  for (const n of sizes) {
    const runs = [];
    let elements = 0;
    for (let k = 0; k < 3; k++) {
      const r = await ev(`bench(${n}, ${JSON.stringify(attrs)}, 2000)`);
      runs.push(r.avg_ms); elements = r.elements;
    }
    rows.push({ config: name, n, elements, runs, median: med(runs) });
    console.error(name, n, runs);
  }
}
console.log(JSON.stringify({ ua: await ev("navigator.userAgent"), rows }, null, 1));
await send("Browser.close").catch(() => {});
process.exit(0);
