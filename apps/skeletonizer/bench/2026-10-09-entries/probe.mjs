const PORT = +process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable");
for (const css of ["base", "explicit", "base-rev"]) {
  await send("Page.navigate", { url: `http://localhost:5188/demo/.tmp-exp/perf-bone.html?css=${css}` });
  for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
  await sleep(500);
  await ev(`setup(5, [["x-ske-effect","shimmer"],["x-ske-text","leaf"]])`);
  await sleep(300);
  console.log(css, JSON.stringify(await ev(`(() => { const r = document.getElementById("root"), h = r.querySelector("h3"); return { href: document.getElementById("css").href.split("/").pop(), sheets: document.styleSheets.length, rules: [...document.styleSheets].map(s => { try { return s.cssRules.length } catch { return -1 } }), rootAnim: getComputedStyle(r).animationName, h3bg: getComputedStyle(h).backgroundColor, h3img: getComputedStyle(h).backgroundImage.slice(0, 30) }; })()`)));
}
await send("Browser.close").catch(() => {});
process.exit(0);
