// 集成验证：防火墙、SVG blob 颜色、深色、显式模式圆角。需在拿锁、Chrome 已启动（端口 argv[2]）后运行
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
const go = async (url) => { await send("Page.navigate", { url }); for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250); await sleep(500); };
const shot = async (name) => { const d = (await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 640, height: 360, scale: 1 } })).result.data; fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(d, "base64")); return d; };
await send("Page.enable"); await send("Page.bringToFront");
const HOST = "http://localhost:5188/demo/.tmp-int/";

await go(HOST + "perf.html");
await ev(`setup(200, { effect: "shimmer", text: "leaf" })`); await sleep(600);
const fw = () => ev(`(() => { const cards = [...document.querySelectorAll("#root > .card")]; const vis = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > -200 && r.top < innerHeight + 200; }); return { total: cards.length, marked: cards.filter((c) => c.hasAttribute("x-ske-fw")).length, visibleMarked: vis.filter((c) => c.hasAttribute("x-ske-fw")).length, visible: vis.length, h3pos: getComputedStyle(cards[0].querySelector("h3")).backgroundPosition }; })()`);
const a = await fw(); await sleep(300); const b = await fw();
console.log("防火墙 顶部", JSON.stringify({ ...a, h3pos: `${a.h3pos} → ${b.h3pos}` }));
await ev(`scrollTo(0, document.body.scrollHeight / 2); 0`); await sleep(500);
console.log("防火墙 滚到中间", JSON.stringify(await fw()));
await ev(`scrollTo(0, 0); 0`); await sleep(300);
const s1 = await shot("fw-top-1"); await sleep(300); const s2 = await shot("fw-top-2");
console.log("防火墙 顶部画面在动", s1 !== s2);

await ev(`setup(20, { effect: "shimmer", text: "leaf", engine: "svg" })`); await sleep(400);
console.log("svg blob 默认", JSON.stringify(await ev(`({ shimmer: document.getElementById("root").style.getPropertyValue("--x-ske-svg-shimmer").slice(0, 16), img: getComputedStyle(document.querySelector("#root h3")).backgroundImage.slice(0, 16) })`)));
await ev(`document.getElementById("root").style.setProperty("--x-ske-highlight", "#ff0000"); setup(20, { effect: "shimmer", text: "leaf", engine: "svg" })`); await sleep(500);
await shot("svg-red");
const red = await ev(`(async () => { const c = document.createElement("canvas"); return 0; })()`);
await ev(`document.getElementById("root").style.removeProperty("--x-ske-highlight"); document.documentElement.setAttribute("data-x-ske-theme","dark"); document.body.style.background="#111"; setup(20, { effect: "shimmer", text: "leaf", engine: "svg" })`); await sleep(500);
await shot("svg-dark");
console.log("svg blob 深色 高光变量", await ev(`getComputedStyle(document.getElementById("root")).getPropertyValue("--x-ske-highlight")`));
await ev(`document.documentElement.removeAttribute("data-x-ske-theme"); document.body.style.background=""; 0`);

await go(HOST + "perf-bone.html");
await ev(`setup(20, { effect: "solid", mode: "explicit" })`); await sleep(400);
await shot("explicit");
console.log("显式模式", JSON.stringify(await ev(`(() => { const img = document.querySelector("#root img"), h3 = document.querySelector("#root h3"); return { imgRadius: getComputedStyle(img).borderRadius, imgBg: getComputedStyle(img).backgroundColor, h3Bg: getComputedStyle(h3).backgroundColor, h3Radius: getComputedStyle(h3).borderRadius, mode: document.getElementById("root").getAttribute("x-ske-mode") }; })()`)));
await ev(`setup(20, { effect: "solid" })`); await sleep(300);
console.log("自动模式 头像圆角", await ev(`getComputedStyle(document.querySelector("#root img")).borderRadius`));
await send("Browser.close").catch(() => {});
process.exit(0);
