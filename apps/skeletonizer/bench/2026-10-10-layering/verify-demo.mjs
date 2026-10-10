// 完整版 demo 对照：同一份 demo 页（DEMO_BASE=/ 构建的快照，静态服务 5200）
//   A = 改后：页面自己按档位加载新分片（main.js 的 CSS_FILES / loadTier）
//   B = 改前：加载完后把分片样式换成改前的 dist/all.css（冻结快照）
// 同一组状态（效果 × 文字模式 × 深浅色 × 方案）下，暂停动画定到同一时刻，逐元素对比计算样式 + 整页截图像素对比。
// 另外 tiers 模式：只看新分片在档位 0~3 下页面能加载、没有请求失败，并存截图。
// 用法：PORT_CDP=9688 node verify-demo.mjs <diff|tiers>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");
const URL_ = process.env.DEMO_URL || "http://localhost:5200/";
const which = process.argv[2] || "diff";
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.join(HERE, "results"), { recursive: true });
const c = await launch({ headless: false, w: 1280, h: 900 });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const failed = [];
c.events.length = 0;

// 暂停所有动画并定到同一时刻，再逐元素读计算样式（demo 里所有骨架根及其后代）
const SNAP = `(async()=>{
  await new Promise(r=>setTimeout(r,600));
  for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = 700; } catch {} }
  await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r));
  const P=["backgroundColor","backgroundImage","backgroundPosition","backgroundClip","backgroundAttachment","backgroundSize","color","webkitTextFillColor","textDecorationLine","textDecorationColor","textDecorationThickness","textUnderlineOffset","fontFamily","visibility","borderRadius","opacity","objectFit","display","pointerEvents","transform","maxHeight","overflow"];
  const els=[...document.querySelectorAll("[data-demo-root], [data-demo-root] *, [data-demo-fit], [data-demo-fit] *")];
  const out={};
  els.forEach((e,i)=>{ const cs=getComputedStyle(e); const o={}; for (const p of P) o[p]=String(cs[p]).replace(/blob:[^")]*/g,"blob").slice(0,90); if (e.hasAttribute("data-demo-root")||e.hasAttribute("data-demo-fit")) { const a=getComputedStyle(e,"::after"); o["after.bg"]=String(a.backgroundImage).slice(0,60); o["after.tf"]=a.transform; o["anim"]=cs.animationName; } out[i+":"+e.tagName.toLowerCase()]=o; });
  return out;
})()`;
const CMP = `(async (a,b)=>{
  const load=(s)=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src="data:image/png;base64,"+s;});
  const [x,y]=await Promise.all([load(a),load(b)]);
  const cv=(i)=>{const k=document.createElement("canvas");k.width=i.width;k.height=i.height;const g=k.getContext("2d");g.drawImage(i,0,0);return g.getImageData(0,0,i.width,i.height).data;};
  if(x.width!==y.width||x.height!==y.height) return {size:[x.width,x.height,y.width,y.height]};
  const p=cv(x),q=cv(y);let d=0,maxd=0;for(let i=0;i<p.length;i+=4){const m=Math.max(Math.abs(p[i]-q[i]),Math.abs(p[i+1]-q[i+1]),Math.abs(p[i+2]-q[i+2]),Math.abs(p[i+3]-q[i+3]));if(m>0){d++;if(m>maxd)maxd=m;}}
  return {diffPixels:d,maxChannelDiff:maxd,total:p.length/4};
})`;
const fullShot = async () => {
  const m = (await c.send("Page.getLayoutMetrics")).result;
  const h = Math.ceil(m.cssContentSize?.height ?? m.contentSize.height);
  return (await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1200, height: Math.min(h, 12000), scale: 1 } })).result.data;
};
const save = (name, b64) => fs.writeFileSync(path.join(SHOTS, name), Buffer.from(b64, "base64"));

/** 打开 demo 并设置状态；old=true 时把分片样式换成改前的 all.css */
const open = async (state, old) => {
  await c.goto(URL_, "!!window.__sk");
  if (old) {
    await c.ev(`(async()=>{
      document.querySelectorAll("link[data-skz-css]").forEach((l)=>l.remove());
      await new Promise((res)=>{const l=document.createElement("link");l.rel="stylesheet";l.href="/d/before/all.css";l.dataset.skzOld="1";l.onload=l.onerror=res;document.head.appendChild(l);});
    })()`);
  }
  await c.ev(`(async()=>{ const s=window.__sk; Object.assign(s.state, ${JSON.stringify(state)}); ${old ? "" : "await s.loadTier(s.state.tier);"} s.apply(); await new Promise(r=>setTimeout(r,300)); return 1; })()`);
};

const out = {};
try {
  if (which === "diff") {
    const cases = [];
    for (const dark of [false, true]) for (const text of ["clip", "underline", "leaf", "tofu"]) for (const effect of ["fade", "solid", "pulse", "shimmer", "sweep"]) cases.push({ dark, text, effect, engine: "global", tier: 3 });
    for (const text of ["clip", "underline", "leaf", "tofu"]) for (const effect of ["pulse", "shimmer"]) cases.push({ dark: false, text, effect, engine: "svg", tier: 3 });
    cases.push({ dark: false, text: "clip", effect: "shimmer", engine: "global", tier: 3, loading: false });
    const diffs = [];
    const cells = [];
    for (const st of cases) {
      const label = `demo/${st.dark ? "dark" : "light"}/${st.engine}/${st.effect}/${st.text}${st.loading === false ? "/loading关" : ""}`;
      await open(st, false);
      const a = await c.ev(SNAP);
      const pa = await fullShot();
      await open(st, true);
      const b = await c.ev(SNAP);
      const pb = await fullShot();
      let d = 0;
      for (const k of Object.keys(a)) for (const p of Object.keys(a[k])) if (a[k][p] !== b[k]?.[p]) { d++; diffs.push({ label, el: k, prop: p, before: b[k]?.[p], after: a[k][p] }); }
      if (Object.keys(a).length !== Object.keys(b).length) { d++; diffs.push({ label, note: "元素数不同" }); }
      const px = await c.ev(`${CMP}(${JSON.stringify(pb)},${JSON.stringify(pa)})`);
      cells.push({ label, styleDiffs: d, px: px.diffPixels ?? px, elements: Object.keys(a).length });
      console.error(label, d ? `STYLE-DIFF ${d}` : "style same", px.diffPixels ? `PIXEL-DIFF ${px.diffPixels}(max ${px.maxChannelDiff})` : px.size ? `SIZE ${px.size}` : "pixel same");
      if (d || px.diffPixels) { save(`demo-${label.replace(/[^\w.-]/g, "_")}-before.png`, pb); save(`demo-${label.replace(/[^\w.-]/g, "_")}-after.png`, pa); }
    }
    out.demo = { cells: cells.length, identical: cells.filter((x) => !x.styleDiffs && !x.px).length, differing: cells.filter((x) => x.styleDiffs || x.px), diffs: diffs.slice(0, 800) };
    fs.writeFileSync(path.join(HERE, "results", "demo.json"), JSON.stringify(out.demo, null, 1));
  }
  if (which === "tiers") {
    // 档位切换：选择器真实触发 change 事件，确认分片都加载成功（link 的 sheet 存在且有规则）
    await c.goto(URL_, "!!window.__sk");
    const rows = [];
    for (const tier of [0, 1, 2, 3, 1, 3]) {
      const r = await c.ev(`(async()=>{
        const sel=document.querySelector("#sel-tier"); sel.value="${tier}"; sel.dispatchEvent(new Event("change"));
        await new Promise(r=>setTimeout(r,1200));
        const links=[...document.querySelectorAll("link[data-skz-css]")];
        return {tier:${tier}, links:links.map(l=>l.dataset.skzCss), bad:links.filter(l=>!l.sheet || (l.sheet.cssRules.length===0 && !/_firewall|_lazy|_driver-color/.test(l.dataset.skzCss))).map(l=>l.dataset.skzCss)};
      })()`);
      rows.push(r);
      save(`demo-tier-${tier}.png`, (await c.send("Page.captureScreenshot", { format: "png" })).result.data);
      console.error(JSON.stringify(r));
    }
    out.tiers = rows;
  }
} finally {
  await c.close();
}
console.log(JSON.stringify(out, null, 1));
