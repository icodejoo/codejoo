// 落地验证：真实 Chrome（端口 9622、临时 user-data-dir）。node verify.mjs [anim|steps|fw|ios|tofu|shots|band]，缺省全跑
import fs from "node:fs";
import { launch, sleep } from "./lib.mjs";
const BASE = `http://localhost:${process.env.PORT_SRV || 5193}/bench/2026-10-10-landing/verify.html`;
const DIR = new URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.mkdirSync(DIR, { recursive: true });
const which = process.argv[2] || "all";
const run = (k) => which === "all" || which === k;
const c = await launch({ headless: false, w: 1280, h: 900 });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const out = {};
const scheme = (s) => c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: s }] });
const open = async (css, opts) => {
  await c.goto(`${BASE}?css=${css}`, "window.ready===true");
  return c.ev(`setup(${JSON.stringify(opts)})`);
};
const rootAnim = () => c.ev(`getComputedStyle(root).animationName + " | " + getComputedStyle(root).animationTimingFunction`);
try {
  // 1) 根动画：各模式 shimmer / pulse 挂了哪些动画
  if (run("anim")) {
    const r = {};
    for (const text of [undefined, "clip", "underline", "leaf", "tofu"]) {
      await open("base,global,tofu", { effect: "shimmer", text });
      r["shimmer/" + (text ?? "默认")] = await rootAnim();
    }
    await open("base,global,tofu", { effect: "pulse" });
    r["pulse"] = await rootAnim();
    await open("base,global,tofu", { effect: "shimmer" });
    await c.ev(`root.style.setProperty("--skz-shimmer-timing","linear")`);
    r["shimmer+linear 变量"] = await rootAnim();
    await c.ev(`root.style.setProperty("--skz-shimmer-timing","steps(18)")`);
    r["shimmer+steps(18)"] = await rootAnim();
    // steps(calc()) 能否跟随时长：试一下
    await c.ev(`root.style.setProperty("--skz-duration","3s");root.style.setProperty("--skz-shimmer-timing","steps(calc(var(--skz-duration) / 1s * 24))")`);
    r["steps(calc(duration/1s*24)) @3s"] = await rootAnim();
    out.anim = r;
  }
  // 2) 光带按步移动：每帧读 p 与文字条 / 图标 / 头像的 background-position，统计每秒变化次数
  if (run("steps")) {
    const r = {};
    for (const text of [undefined, "underline", "tofu"]) {
      await open("base,global,tofu", { effect: "shimmer", text });
      r[text ?? "clip"] = await c.ev(`(async()=>{
        const h3=root.querySelector("h3"), ic=root.querySelector("i"), im=root.querySelector("img");
        const rows=[]; const t0=performance.now(); const cs=(e)=>getComputedStyle(e);
        while(performance.now()-t0<2000){ await new Promise(r=>requestAnimationFrame(r));
          rows.push([Math.round(performance.now()-t0), +cs(root).getPropertyValue("--skz-shimmer-p"), cs(h3).backgroundPosition, cs(ic).backgroundPosition, cs(im).backgroundPosition, cs(h3).color, cs(h3).fontFamily.slice(0,12), cs(h3).textDecorationColor]); }
        let ch=0; const steps=[]; for(let i=1;i<rows.length;i++) if(rows[i][1]!==rows[i-1][1]){ch++;steps.push(+(rows[i][1]-rows[i-1][1]).toFixed(2));}
        const sync=rows.every(r=>r[2]===r[3]&&r[3]===r[4]);
        const colors=new Set(rows.map(r=>r[5])), decos=new Set(rows.map(r=>r[7]));
        return {frames:rows.length, pChangesPerSec:+(ch/2).toFixed(1), stepVw:[...new Set(steps)].slice(0,4), bgPosSyncTextIconImg:sync, distinctColor:colors.size, distinctDecoColor:decos.size, sample:rows.slice(0,3), font:rows[0][6]};
      })()`);
    }
    out.steps = r;
  }
  // 3) 防火墙：200 张卡，不可见卡的 --skz-tbg 是否钉住（pulse + clip）
  if (run("fw")) {
    const r = {};
    for (const [label, css, opts] of [
      ["pulse+clip 新", "base,global", { effect: "pulse", n: 200 }],
      ["pulse+clip 旧", "base,global,oldglobal", { effect: "pulse", n: 200 }],
      ["shimmer+clip 新", "base,global", { effect: "shimmer", n: 200 }],
      ["pulse+underline 新", "base,global", { effect: "pulse", text: "underline", n: 200 }],
    ]) {
      await open(css, opts);
      await sleep(500);
      r[label] = await c.ev(`(async()=>{
        const cards=[...root.children]; const fw=cards.filter(x=>x.hasAttribute("skz-fw")).length;
        const far=cards[150].querySelector("h3"), near=cards[0].querySelector("h3");
        const v=(e)=>{const cs=getComputedStyle(e);return cs.getPropertyValue("--skz-tbg").trim()+" / bg:"+cs.backgroundColor};
        const a=[v(far),v(near)]; await new Promise(r=>setTimeout(r,400)); const b=[v(far),v(near)]; await new Promise(r=>setTimeout(r,300)); const d=[v(far),v(near)];
        return {fwCards:fw, total:cards.length, far:[a[0],b[0],d[0]], near:[a[1],b[1],d[1]], farStatic:new Set([a[0],b[0],d[0]]).size===1, nearChanges:new Set([a[1],b[1],d[1]]).size>1};
      })()`);
    }
    out.fw = r;
  }
  // 4) iOS 模拟（global-ios.css：把 @supports (-webkit-touch-callout) 换成 Chrome 满足的条件）
  if (run("ios")) {
    const r = {};
    for (const text of [undefined, "underline"]) {
      await open("base,global,ios", { effect: "shimmer", text, n: 200 });
      await sleep(500);
      r[text ?? "clip"] = await c.ev(`(async()=>{
        const cs=(e)=>getComputedStyle(e); const near=root.children[0].querySelector("h3"), far=root.children[150].querySelector("h3");
        const rows=[]; const t0=performance.now();
        while(performance.now()-t0<1500){ await new Promise(r=>requestAnimationFrame(r)); rows.push([cs(root).getPropertyValue("--skz-fill"), cs(near).backgroundColor, cs(far).backgroundColor, cs(near).backgroundImage.slice(0,20)]); }
        return {anim: cs(root).animationName, bgImgOfNear: rows[0][3], rootFillDistinct:new Set(rows.map(x=>x[0])).size, nearBgDistinct:new Set(rows.map(x=>x[1])).size, farBgDistinct:new Set(rows.map(x=>x[2])).size, fwCards:[...root.children].filter(x=>x.hasAttribute("skz-fw")).length};
      })()`);
    }
    out.ios = r;
  }
  // 5) tofu：字体加载、宽度、颜色
  if (run("tofu")) {
    const r = {};
    await open("base,global,tofu", { effect: "solid", text: "tofu" });
    r.withCss = await c.ev(`(async()=>{ await document.fonts.ready; const cs=(e)=>getComputedStyle(e);
      const w=(t,fs=100)=>{const s=document.createElement("span");s.style.cssText="position:absolute;visibility:hidden;white-space:pre;font-size:"+fs+"px";s.textContent=t;root.querySelector("p").appendChild(s);const x=s.getBoundingClientRect().width;s.remove();return x};
      const p=root.querySelector("p");
      return {fonts:[...document.fonts].map(f=>f.family+":"+f.status), h3:cs(root.querySelector("h3")).fontFamily, code:cs(root.querySelector("code")).fontFamily, codeDeco:cs(root.querySelector("code")).textDecorationLine, ign:cs(root.querySelector("[skz-ignore]")).fontFamily, btn:cs(root.querySelector("button")).fontFamily, btnFill:cs(root.querySelector("button")).webkitTextFillColor, input:cs(root.querySelector("input")).fontFamily, li:cs(root.querySelector("li")).fontFamily, deco:cs(p).textDecorationLine, color:cs(p).color, fill:cs(p).webkitTextFillColor, bgClip:cs(p).backgroundClip, widthsAt100px:{A:w("A"),zh:w("中"),space:w(" "),zwj:w("\\u200d"),emoji:w("😀")}};
    })()`);
    await open("base,global", { effect: "solid", text: "tofu" });
    r.noCss = await c.ev(`(()=>{const cs=(e)=>getComputedStyle(e),p=root.querySelector("p");return {font:cs(p).fontFamily.slice(0,20), deco:cs(p).textDecorationLine, decoColor:cs(p).textDecorationColor, fill:cs(p).webkitTextFillColor, bgClip:cs(p).backgroundClip, thick:cs(p).textDecorationThickness}})()`);
    out.tofu = r;
  }
  // 6) 截图：clip / underline / leaf / tofu / tofu 无 css × 浅深
  if (run("shots")) {
    for (const s of ["light", "dark"]) {
      await scheme(s);
      for (const [name, css, opts] of [
        ["clip", "base,global,tofu", { effect: "solid" }],
        ["underline", "base,global,tofu", { effect: "solid", text: "underline" }],
        ["leaf", "base,global,tofu", { effect: "solid", text: "leaf" }],
        ["tofu", "base,global,tofu", { effect: "solid", text: "tofu" }],
        ["tofu-nocss", "base,global", { effect: "solid", text: "tofu" }],
        ["tofu-shimmer", "base,global,tofu", { effect: "shimmer", text: "tofu" }],
        ["clip-shimmer", "base,global,tofu", { effect: "shimmer" }],
      ]) {
        await open(css, opts);
        await sleep(400);
        await c.shot(DIR + `${name}-${s}.png`, { x: 0, y: 0, width: 560, height: 470 }, 1);
      }
    }
    out.shots = DIR;
  }
  // 8) Web Component 宿主（shadow DOM）：::before 骨头读动画变量
  if (run("wc")) {
    const r = {};
    const probe = `(async()=>{
      const cs=(e,p)=>getComputedStyle(e,p); const host=root.querySelector("wc-card"), im=root.querySelector("img"), h3=root.querySelector("h3");
      const rows=[]; const t0=performance.now();
      while(performance.now()-t0<1500){ await new Promise(r=>requestAnimationFrame(r));
        const b=cs(host,"::before"); rows.push([b.backgroundColor, b.backgroundImage.slice(0,30), b.backgroundPosition, b.backgroundAttachment, cs(im).backgroundPosition, cs(root).opacity]); }
      const d=(i)=>new Set(rows.map(x=>x[i])).size;
      return {frames:rows.length, hostBgColorDistinct:d(0), hostBgImg:rows[0][1], hostBgPosDistinct:d(2), hostBgPosSyncWithImg:rows.every(x=>x[2]===x[4]), attachment:rows[0][3], rootOpacityDistinct:d(5), samplePos:[rows[0][2], rows[20][2]], sampleColor:[rows[0][0], rows[30][0]]};
    })()`;
    for (const [label, css, opts] of [
      ["shimmer global", "base,global", { effect: "shimmer" }],
      ["shimmer svg", "base,svg", { effect: "shimmer", engine: "svg" }],
      ["pulse global", "base,global", { effect: "pulse" }],
      ["pulse svg", "base,svg", { effect: "pulse", engine: "svg" }],
      ["fade", "base", { effect: "fade" }],
      ["solid", "base", { effect: "solid" }],
    ]) {
      await open(css, opts);
      await sleep(600);
      r[label] = await c.ev(probe);
    }
    await scheme("light");
    for (const [name, css, opts] of [["wc-shimmer-global", "base,global", { effect: "shimmer" }], ["wc-shimmer-svg", "base,svg", { effect: "shimmer", engine: "svg" }]]) {
      await open(css, opts);
      await sleep(500);
      await c.shot(DIR + `${name}.png`, { x: 0, y: 0, width: 560, height: 560 }, 1);
    }
    out.wc = r;
  }
  // 7) 光带逐步移动的截图序列（clip shimmer，间隔 ~42ms，8 张）
  if (run("band")) {
    await scheme("light");
    await open("base,global", { effect: "shimmer" });
    const ps = [];
    for (let i = 0; i < 8; i++) {
      ps.push(await c.ev(`+getComputedStyle(root).getPropertyValue("--skz-shimmer-p")`));
      await c.shot(DIR + `band-${i}.png`, { x: 0, y: 0, width: 560, height: 200 }, 1);
      await sleep(42);
    }
    out.bandP = ps;
  }
} finally {
  await c.close();
}
console.log(JSON.stringify(out, null, 1));
