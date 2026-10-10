// 分层验证：同一页面（verify.html / core.html）分别加载"改前 / 改后"冻结 dist（静态服务 5197，见 serve.mjs），
// 暂停动画并定在同一时刻，逐元素对比计算样式 + 整页截图像素对比。
// 用法：PORT_CDP=9688 node verify.mjs <diff|sim|core|shots>
//   diff   完整版各入口组合（all.css / base+global / base 单独 / explicit 系）× 文字模式 × 效果 × 明暗，改前 vs 改后
//   sim    老浏览器模拟（把产物里的 @supports 条件改成恒假 / 恒真，见 serve.mjs），改前 vs 改后
//   core   最小 core 页面（core-js + core.css）对照完整版 all.css 的默认文字模式
//   shots  各模拟下的截图（改前 / 改后 / core），存 shots/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRV = `http://localhost:${process.env.SRV_PORT || 5197}/bench/2026-10-10-layering`;
const which = process.argv[2] || "diff";
const SHOTS = path.join(HERE, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(path.join(HERE, "results"), { recursive: true });

const c = await launch({ headless: false, w: 1280, h: 900 });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const scheme = (s) => c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: s }] });
const open = async (page, qs, opts) => {
  await c.goto(`${SRV}/${page}?${qs}`, "window.ready===true");
  return c.ev(`setup(${JSON.stringify(opts)})`);
};

// 暂停所有动画并定到同一时刻，再逐元素读计算样式（第一张卡的所有元素 + 宿主 ::before + 根上的变量）
const SNAP = `(async()=>{
  await new Promise(r=>setTimeout(r,500));
  for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = 700; } catch {} }
  await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r));
  const P=["backgroundColor","backgroundImage","backgroundPosition","backgroundClip","backgroundAttachment","backgroundSize","color","webkitTextFillColor","textDecorationLine","textDecorationColor","textDecorationThickness","textUnderlineOffset","fontFamily","visibility","borderRadius","opacity","objectFit","display","pointerEvents"];
  const card=root.children[0]; const out={};
  const path=(e)=>{const a=[];for(;e&&e!==root;e=e.parentElement){const i=[...e.parentElement.children].indexOf(e);a.unshift(e.tagName.toLowerCase()+i)}return a.join(">")};
  for (const e of [card,...card.querySelectorAll("*")]) { const cs=getComputedStyle(e); const o={}; for (const p of P) o[p]=String(cs[p]).replace(/blob:[^")]*/g,"blob").slice(0,90); out[path(e)||"card"]=o; }
  const wc=card.querySelector("wc-card"); if (wc) { const b=getComputedStyle(wc,"::before"); const o={}; for (const p of ["backgroundColor","backgroundImage","backgroundPosition","backgroundSize","content","borderRadius"]) o[p]=String(b[p]).replace(/blob:[^")]*/g,"blob").slice(0,90); out["wc::before"]=o; }
  const rs=getComputedStyle(root); out["#root"]={anim:rs.animationName+"|"+rs.animationTimingFunction, fill:rs.getPropertyValue("--skz-fill").trim(), ulfill:rs.getPropertyValue("--skz-ul-fill").trim(), bgpos:rs.getPropertyValue("--skz-bg-pos").trim(), bgimg:rs.getPropertyValue("--skz-bg-img").trim().slice(0,40), opacity:rs.opacity};
  return out;
})()`;

const shot = async () => (await c.send("Page.captureScreenshot", { format: "png" })).result.data;

// 在页面里用 canvas 逐像素比两张 png（base64），返回不同像素数
const CMP = `(async (a,b)=>{
  const load=(s)=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src="data:image/png;base64,"+s;});
  const [x,y]=await Promise.all([load(a),load(b)]);
  const cv=(i)=>{const k=document.createElement("canvas");k.width=i.width;k.height=i.height;const g=k.getContext("2d");g.drawImage(i,0,0);return g.getImageData(0,0,i.width,i.height).data;};
  if(x.width!==y.width||x.height!==y.height) return {size:[x.width,x.height,y.width,y.height]};
  const p=cv(x),q=cv(y);let d=0,maxd=0;for(let i=0;i<p.length;i+=4){const m=Math.max(Math.abs(p[i]-q[i]),Math.abs(p[i+1]-q[i+1]),Math.abs(p[i+2]-q[i+2]),Math.abs(p[i+3]-q[i+3]));if(m>0){d++;if(m>maxd)maxd=m;}}
  return {diffPixels:d,maxChannelDiff:maxd,total:p.length/4};
})`;
const pixelDiff = (a, b) => c.ev(`${CMP}(${JSON.stringify(a)},${JSON.stringify(b)})`);

const diffSnaps = (snaps, label, diffs) => {
  let d = 0;
  const A = snaps.before;
  const B = snaps.after;
  for (const k of Object.keys(A)) {
    for (const p of Object.keys(A[k])) {
      if (A[k][p] !== B[k]?.[p]) {
        d++;
        diffs.push({ label, el: k, prop: p, before: A[k][p], after: B[k]?.[p] });
      }
    }
  }
  if (Object.keys(A).length !== Object.keys(B).length) {
    d++;
    diffs.push({ label, note: "元素数不同" });
  }
  return d;
};
const save = (name, b64) => fs.writeFileSync(path.join(SHOTS, name), Buffer.from(b64, "base64"));
const tag = (label) => label.replace(/[^\w.=+-]/g, "_");
/** 文字模式写法：raw:xxx 直接写 skz-text 的任意取值（enable 不会写未知取值） */
const textOpts = (t) => (t?.startsWith("raw:") ? { rawText: t.slice(4) } : { text: t });

const out = {};
try {
  if (which === "diff" || which === "sim") {
    const groups = [];
    const T = [undefined, "clip", "underline", "leaf", "tofu", "raw:foo"];
    const E = ["solid", "fade", "pulse", "shimmer"];
    const sims = which === "sim" ? ["all", "nohas", "not", "norel", "noclip", "ios"] : [""];
    for (const sim of sims) {
      if (which === "diff") {
        for (const s of ["light", "dark"]) for (const t of T) for (const e of E) groups.push({ s, sim, css: "all", js: "global,svg", label: `all.css/${s}/${e}/${t ?? "默认"}`, opts: { effect: e, ...textOpts(t) } });
        for (const t of [undefined, "underline", "leaf", "tofu"]) for (const e of ["pulse", "shimmer"]) groups.push({ s: "light", sim, css: "all", js: "global,svg", label: `all.css+svg引擎/${e}/${t ?? "默认"}`, opts: { effect: e, text: t, engine: "svg" } });
        for (const t of T) for (const e of E) groups.push({ s: "light", sim, css: "base,global", js: "global", label: `base+global(无tofu.css)/${e}/${t ?? "默认"}`, opts: { effect: e, ...textOpts(t) } });
        for (const t of [undefined, "underline", "leaf"]) for (const e of E) groups.push({ s: "light", sim, css: "base", js: "", label: `base 单独/${e}/${t ?? "默认"}`, opts: { effect: e, text: t } });
        for (const e of E) groups.push({ s: "light", sim, css: "explicit", js: "", label: `explicit 单独/${e}`, opts: { effect: e } });
        for (const e of E) groups.push({ s: "light", sim, css: "explicit,global", js: "global", label: `explicit+global/${e}`, opts: { effect: e } });
      } else {
        for (const t of [undefined, "underline", "leaf", "tofu"]) for (const e of ["pulse", "shimmer"]) groups.push({ s: "light", sim, css: "all", js: "global,svg", label: `sim=${sim}/all.css/${e}/${t ?? "默认"}`, opts: { effect: e, ...textOpts(t) } });
        for (const e of ["pulse", "shimmer"]) groups.push({ s: "light", sim, css: "base", js: "", label: `sim=${sim}/base 单独/${e}`, opts: { effect: e } });
        groups.push({ s: "light", sim, css: "explicit,global", js: "global", label: `sim=${sim}/explicit+global/pulse`, opts: { effect: "pulse" } });
      }
    }
    const diffs = [];
    const cells = [];
    let same = 0;
    let pxSame = 0;
    for (const g of groups) {
      await scheme(g.s);
      const snaps = {};
      const shots = {};
      for (const ver of ["before", "after"]) {
        await open("verify.html", `ver=${ver}&css=${g.css}&js=${g.js}${g.sim ? `&sim=${g.sim}` : ""}`, g.opts);
        snaps[ver] = await c.ev(SNAP);
        shots[ver] = await shot();
      }
      const d = diffSnaps(snaps, g.label, diffs);
      const px = await pixelDiff(shots.before, shots.after);
      if (!d) same++;
      if (px.diffPixels === 0) pxSame++;
      cells.push({ label: g.label, styleDiffs: d, px: px.diffPixels });
      if (d || px.diffPixels) {
        save(`diff-${tag(g.label)}-before.png`, shots.before);
        save(`diff-${tag(g.label)}-after.png`, shots.after);
      }
      console.error(g.label, d ? `STYLE-DIFF ${d}` : "style same", px.diffPixels ? `PIXEL-DIFF ${px.diffPixels}(max ${px.maxChannelDiff})` : "pixel same");
    }
    out[which] = { cells: cells.length, styleIdentical: same, pixelIdentical: pxSame, differing: cells.filter((x) => x.styleDiffs || x.px), diffs };
    fs.writeFileSync(path.join(HERE, "results", `${which}.json`), JSON.stringify(out[which], null, 1));
  }

  if (which === "core") {
    // core 页面（core-js + core.css）对照完整版 all.css 的默认文字模式：现代 Chrome 里应当一致
    const diffs = [];
    const cells = [];
    for (const s of ["light", "dark"]) {
      for (const e of ["solid", "fade", "pulse", "shimmer"]) {
        await scheme(s);
        await open("verify.html", "ver=after&css=all&js=global,svg&nowc=1", { effect: e });
        const a = await c.ev(SNAP);
        const pa = await shot();
        await open("core.html", "ver=after", { effect: e });
        const b = await c.ev(SNAP);
        const pb = await shot();
        const d = diffSnaps({ before: a, after: b }, `core/${s}/${e}`, diffs);
        const px = await pixelDiff(pa, pb);
        cells.push({ label: `core vs all.css ${s}/${e}`, styleDiffs: d, px: px.diffPixels });
        console.error(`core vs all.css ${s}/${e}`, d ? `STYLE-DIFF ${d}` : "style same", px.diffPixels ? `PIXEL-DIFF ${px.diffPixels}` : "pixel same");
        if (s === "light") save(`core-${e}.png`, pb);
      }
    }
    out.core = { cells, diffs: diffs.slice(0, 80) };
    fs.writeFileSync(path.join(HERE, "results", "core.json"), JSON.stringify(out.core, null, 1));
  }

  if (which === "derive") {
    // 第 4 项实验版（派生变量只在骨头上计算）对照改后 dist：global 引擎下外观应一致（已知例外：后代自己改 --skz-color、svg 引擎）
    const diffs = [];
    const cells = [];
    for (const s of ["light", "dark"]) {
      for (const t of [undefined, "underline", "tofu", "leaf"]) {
        for (const e of ["solid", "fade", "pulse", "shimmer"]) {
          if (process.env.ONLY && !`${s}/${e}/${t ?? "默认"}`.includes(process.env.ONLY)) continue;
          await scheme(s);
          const snaps = {};
          const shots = {};
          for (const [k, ver] of [["before", "after"], ["after", "derive"]]) {
            await open("verify.html", `ver=${ver}&css=all&js=global`, { effect: e, text: t });
            snaps[k] = await c.ev(SNAP);
            shots[k] = await shot();
          }
          const label = `derive/${s}/${e}/${t ?? "默认"}`;
          const d = diffSnaps(snaps, label, diffs);
          const px = await pixelDiff(shots.before, shots.after);
          cells.push({ label, styleDiffs: d, px: px.diffPixels });
          console.error(label, d ? `STYLE-DIFF ${d}` : "style same", px.diffPixels ? `PIXEL-DIFF ${px.diffPixels}(max ${px.maxChannelDiff})` : "pixel same");
        }
      }
    }
    out.derive = { cells: cells.length, differing: cells.filter((x) => x.styleDiffs || x.px), diffs: diffs.slice(0, 600) };
    fs.writeFileSync(path.join(HERE, "results", "derive.json"), JSON.stringify(out.derive, null, 1));
  }

  if (which === "dup") {
    // 重复加载：core.css 与完整版样式同时引入（两种顺序），对照只引完整版 —— 重复规则会不会改变层叠结果
    const T = [undefined, "clip", "underline", "leaf", "tofu", "raw:foo"];
    const diffs = [];
    const cells = [];
    for (const [ref, dupes] of [["all", ["core,all", "all,core"]], ["base,global", ["core,base,global", "base,global,core"]]]) {
      for (const dupCss of dupes) {
        for (const t of T) {
          for (const e of ["solid", "fade", "pulse", "shimmer"]) {
            await scheme("light");
            await open("verify.html", `ver=after&css=${ref}&js=global`, { effect: e, ...textOpts(t) });
            const a = await c.ev(SNAP);
            const pa = await shot();
            await open("verify.html", `ver=after&css=${dupCss}&js=global`, { effect: e, ...textOpts(t) });
            const b = await c.ev(SNAP);
            const pb = await shot();
            const label = `${ref} vs ${dupCss}/${e}/${t ?? "默认"}`;
            const d = diffSnaps({ before: a, after: b }, label, diffs);
            const px = await pixelDiff(pa, pb);
            cells.push({ label, styleDiffs: d, px: px.diffPixels });
            console.error(label, d ? `STYLE-DIFF ${d}` : "style same", px.diffPixels ? `PIXEL-DIFF ${px.diffPixels}` : "pixel same");
            if (d || px.diffPixels) save(`dup-${tag(label)}.png`, pb);
          }
        }
      }
    }
    out.dup = { cells: cells.length, differing: cells.filter((x) => x.styleDiffs || x.px), diffs: diffs.slice(0, 120) };
    fs.writeFileSync(path.join(HERE, "results", "dup.json"), JSON.stringify(out.dup, null, 1));
  }

  if (which === "shots") {
    // 老浏览器模拟截图：完整版 base.css（改前 / 改后）与 core.css（改后）在各模拟下的样子（动画定到同一时刻）
    await scheme("light");
    for (const sim of ["", "all", "nohas", "not", "norel"]) {
      const name = sim || "modern";
      const simq = sim ? `&sim=${sim}` : "";
      for (const ver of ["before", "after"]) {
        await open("verify.html", `ver=${ver}&css=base,global&js=global${simq}`, { effect: "shimmer", text: "underline" });
        await c.ev(SNAP);
        save(`sim-${name}-full-underline-${ver}.png`, await shot());
        await open("verify.html", `ver=${ver}&css=base,global&js=global${simq}`, { effect: "shimmer" });
        await c.ev(SNAP);
        save(`sim-${name}-full-clip-${ver}.png`, await shot());
      }
      await open("core.html", `ver=after${simq}`, { effect: "shimmer" });
      await c.ev(SNAP);
      save(`sim-${name}-core-after.png`, await shot());
    }
  }
} finally {
  await c.close();
}
console.log(JSON.stringify(out, null, 1));
