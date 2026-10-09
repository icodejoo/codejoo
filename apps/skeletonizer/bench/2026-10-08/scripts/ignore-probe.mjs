// 忽略区行为验证：用 enable() 开启，检查根属性、祖先下划线、隐式 fade
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5188/demo/.tmp-perf/perf.html?css=final" });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
await sleep(500);
const r = await ev(`(async () => {
  const { enable } = await import("/src/index.ts");
  const root = document.getElementById("root");
  root.getAttributeNames().forEach((a) => a !== "id" && root.removeAttribute(a));
  root.innerHTML = '<div id="wrap"><p id="txt">abc</p><div id="ign" x-ske-ignore><button id="btn">取消</button></div></div>';
  const off = enable(root);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cs = (id, p) => getComputedStyle(document.getElementById(id))[p];
  const out = {
    hasIgnoreAttr: root.hasAttribute("x-ske-has-ignore"),
    rootAnim: getComputedStyle(root).animationName,
    wrapDecoration: cs("wrap", "textDecorationLine"),
    txtDecoration: cs("txt", "textDecorationLine"),
    btnInert: document.getElementById("btn").closest("[inert]") !== null,
    btnPointer: cs("btn", "pointerEvents"),
  };
  off();
  out.afterOff = root.getAttributeNames().join(",");
  return out;
})()`);
console.log(JSON.stringify(r, null, 1));
await send("Browser.close").catch(() => {});
process.exit(0);
