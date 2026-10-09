// class vs 属性 根标记 A/B：两种模式交替跑，每项 5 轮取中位数
const PORT = 9333, BASE = "http://localhost:5188/demo/.tmp-ab/ab.html?mode=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
const toggles = [["开启 4000 默认", 500, []], ["开启 16000 默认", 2000, []], ["开启 16000 叶子", 2000, [["x-ske-text", "leaf"]]]];
const frames = [["每帧 16000 fade", 2000, []], ["每帧 4000 pulse", 500, [["x-ske-effect", "pulse"]]], ["每帧 4000 shimmer叶子", 500, [["x-ske-text", "leaf"], ["x-ske-effect", "shimmer"]]]];
const res = {};
const add = (k, mode, v) => { ((res[k] ??= { class: [], attr: [] })[mode]).push(v); };
for (let rep = 0; rep < 5; rep++) {
  for (const mode of rep % 2 ? ["attr", "class"] : ["class", "attr"]) {
    await send("Page.navigate", { url: BASE + mode });
    for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
    await sleep(500);
    for (const [k, n, a] of toggles) {
      // 每项先热身一次，再取 3 次的中位数
      await ev(`toggleCost(${n}, ${JSON.stringify(a)})`);
      const xs = []; for (let j = 0; j < 3; j++) xs.push(await ev(`toggleCost(${n}, ${JSON.stringify(a)})`));
      add(k, mode, xs.sort((p, q) => p - q)[1]);
    }
    for (const [k, n, a] of frames) add(k, mode, await ev(`frameCost(${n}, ${JSON.stringify(a)})`));
    console.error("rep", rep, mode, "done");
  }
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [k, v] of Object.entries(res)) {
  const c = med(v.class), t = med(v.attr);
  console.log(`${k}\tclass ${c}\tattr ${t}\tdiff ${(((t - c) / c) * 100).toFixed(1)}%\t| class ${v.class.join(",")} | attr ${v.attr.join(",")}`);
}
await send("Browser.close").catch(() => {});
process.exit(0);
