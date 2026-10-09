// SVG blob 颜色核对：根上改高光色后重新 enable，读 blob 内容 + 截图
import fs from "node:fs";
const PORT = +process.argv[2], OUT = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Page.navigate", { url: "http://localhost:5188/demo/.tmp-int/perf.html" });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
await sleep(500);
const blobInfo = (label) => ev(`(async () => { const r = document.getElementById("root"); const u = r.style.getPropertyValue("--x-ske-svg-shimmer").match(/blob:[^"]+/)?.[0]; const t = u ? await (await fetch(u)).text() : ""; return ${JSON.stringify(label)} + " → " + (t.match(/stop-color="([^"]+)"/)?.[1] ?? "无") + " dur=" + (t.match(/dur="([^"]+)"/)?.[1] ?? "-"); })()`);
await ev(`setup(20, { effect: "shimmer", text: "leaf", engine: "svg" })`); await sleep(300);
console.log(await blobInfo("默认浅色"));
await ev(`(async () => { const { enable } = await import("/src/index.ts"); const r = document.getElementById("root"); r.style.setProperty("--x-ske-highlight", "#ff0000"); r.style.setProperty("--x-ske-duration", "3s"); enable(r, { effect: "shimmer", text: "leaf", engine: "svg" }); })()`);
await sleep(700);
console.log(await blobInfo("根上改成红色 + 3s"));
const d = (await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 640, height: 360, scale: 1 } })).result.data;
fs.writeFileSync(`${OUT}/svg-red.png`, Buffer.from(d, "base64"));
await ev(`(async () => { const { enable } = await import("/src/index.ts"); const r = document.getElementById("root"); r.style.removeProperty("--x-ske-highlight"); r.style.removeProperty("--x-ske-duration"); document.documentElement.setAttribute("data-x-ske-theme","dark"); enable(r, { effect: "shimmer", text: "leaf", engine: "svg" }); })()`);
await sleep(400);
console.log(await blobInfo("深色主题"));
await send("Browser.close").catch(() => {});
process.exit(0);
