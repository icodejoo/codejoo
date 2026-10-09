// 诊断：E / C 组 enable 路径下防火墙到底有没有生效（数 skz-fw 项、读 div 状态）。由 run-shot-locked.mjs 第 5 个参数启动。
const PORT = +(process.env.PERF_PORT || 9334), HOST = process.env.PERF_HOST;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
import fs from "node:fs";
const scen = JSON.parse(fs.readFileSync(process.env.DBG_SC || "sc-E.json", "utf8"));
const CSS = scen[0].css;
await send("Page.navigate", { url: `${HOST}?css=${CSS}` });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
await sleep(400);
const state = `(() => { const r = document.getElementById("root"); const d = r.querySelector("[skz-auto]"); return { scrollY, fw: r.querySelectorAll(":scope > [skz-fw]").length, children: r.children.length, divFw: d ? d.hasAttribute("skz-fw") : null, attrs: r.getAttributeNames().join(",") }; })()`;
for (const s of scen.slice(0, +(process.env.DBG_N || 4))) {
  await ev(`setup(${s.n}, ${JSON.stringify(s.attrs)})`);
  await sleep(800); await ev("frames(2500)");
  console.log(s.name, "after setup+frames", JSON.stringify(await ev(state)));
  for (let k = 0; k < 7; k++) await ev("toggleCost()");
  console.log(s.name, "after toggles", JSON.stringify(await ev(state)));
}
await send("Browser.close").catch(() => {});
process.exit(0);
