// 截图 + 像素检查：光带只出现在骨头上、颜色来自 CSS 变量、确实在动
import fs from "node:fs";
const PORT = +(process.env.PERF_PORT || 9342), HOST = process.env.PERF_HOST;
const OUT = new URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
await send("Page.enable"); await send("Page.bringToFront");
await send("Page.navigate", { url: `${HOST}?css=prod` });
for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
await sleep(400);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 640, height: 480, scale: 1 } }); fs.writeFileSync(OUT + name + ".png", Buffer.from(r.result.data, "base64")); return r.result.data; };
/** 像素分析：偏红（r-g>25）像素在骨头矩形内外各多少；骨头内灰色像素多少 */
const analyze = (b64) => ev(`(async()=>{
  const img=new Image(); img.src='data:image/png;base64,${b64}'; await img.decode();
  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; const x=c.getContext('2d'); x.drawImage(img,0,0);
  const d=x.getImageData(0,0,c.width,c.height).data; const rects=clientBoneRects().filter(r=>r[1]<480&&r[0]<640);
  const inside=(px,py)=>rects.some(r=>px>=r[0]-1&&px<=r[0]+r[2]+1&&py>=r[1]-1&&py<=r[1]+r[3]+1);
  let redIn=0,redOut=0,tot=0; for(let py=0;py<c.height;py++)for(let px=0;px<c.width;px++){const i=(py*c.width+px)*4; if(d[i]-d[i+1]>25){ tot++; inside(px,py)?redIn++:redOut++; }}
  return {redIn,redOut,tot,bones:rects.length};
})()`);
const cases = [
  ["base-root", [["x-ske-effect", "shimmer"], ["x-ske-text", "leaf"]], null],
  ["svg", [["x-ske-effect", "shimmer"], ["x-ske-text", "leaf"], ["x-ske-engine", "svg"]], null],
  ["A", [["x-ske-effect", "solid"], ["x-ske-text", "leaf"]], "a"],
  ["B1", [["x-ske-effect", "solid"], ["x-ske-text", "leaf"]], "b1"],
  ["B2", [["x-ske-effect", "solid"], ["x-ske-text", "leaf"]], "b2"],
];
const res = {};
for (const [name, attrs, proto] of cases) {
  for (const red of [false, true]) {
    await ev(`setup(40, ${JSON.stringify(attrs)})`);
    if (proto) await ev(`proto(${JSON.stringify(proto)})`);
    if (red) await ev(`document.getElementById('root').style.setProperty('--x-ske-highlight','#ff0000')`);
    await sleep(1200);
    // 动起来了吗：不暂停连拍 3 张，看哈希是否不同
    const hs = []; for (let k = 0; k < 3; k++) { const b = await shot(`${name}${red ? "-red" : ""}-live${k}`); hs.push(b.length + ":" + b.slice(5000, 5040)); await sleep(230); }
    const moving = new Set(hs).size;
    // 暂停在 1/3 周期处截一张 + 像素分析
    await ev(`document.getAnimations().forEach(a=>{a.pause();a.currentTime=500})`); await sleep(600);
    const b = await shot(`${name}${red ? "-red" : ""}-paused`);
    const an = red ? await analyze(b) : null;
    res[name + (red ? "-red" : "")] = { distinctLiveShots: moving, analysis: an, animations: await ev("document.getAnimations().length") };
  }
}
console.log(JSON.stringify(res, null, 1));
await send("Browser.close").catch(() => {});
process.exit(0);
