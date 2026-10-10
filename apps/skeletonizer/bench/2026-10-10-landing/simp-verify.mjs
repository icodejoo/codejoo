// simplify 前后对照：同一页面（simp.html）分别加载"改前 / 改后"两份冻结 dist（端口 5195 / 5196），
// 暂停动画并定在同一时刻，逐元素对比计算样式；再单独验证 shimmer 光带按步移动 / 同步、pulse + clip 文字背景仍在脉冲、防火墙。
// 用法：PORT_CDP=9644 node simp-verify.mjs [diff|steps|fw|ff]，缺省全跑。真实 Chrome、临时 user-data-dir，测完按端口只关自己起的。
import { launch, sleep } from "./lib.mjs";
const SRV = { before: 5195, after: 5196 };
const which = process.argv[2] || "all";
const run = (k) => which === "all" || which === k;
const c = await launch({ headless: false, w: 1280, h: 900, lock: true });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const scheme = (s) => c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: s }] });
const open = async (ver, css, opts) => {
  await c.goto(`http://localhost:${SRV[ver]}/bench/2026-10-10-landing/simp.html?css=${css}`, "window.ready===true");
  return c.ev(`setup(${JSON.stringify(opts)})`);
};
// 暂停所有动画并定到同一时刻，再逐元素读计算样式（第一张卡的所有元素）
const SNAP = `(async()=>{
  await new Promise(r=>setTimeout(r,500));
  for (const a of document.getAnimations()) { try { a.pause(); a.currentTime = 700; } catch {} }
  await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>requestAnimationFrame(r));
  const P=["backgroundColor","backgroundImage","backgroundPosition","backgroundClip","backgroundAttachment","backgroundSize","color","webkitTextFillColor","textDecorationLine","textDecorationColor","textDecorationThickness","textUnderlineOffset","fontFamily","visibility","borderRadius","opacity","objectFit","display"];
  const card=root.children[0]; const out={};
  const path=(e)=>{const a=[];for(;e&&e!==root;e=e.parentElement){const i=[...e.parentElement.children].indexOf(e);a.unshift(e.tagName.toLowerCase()+i)}return a.join(">")};
  for (const e of [card,...card.querySelectorAll("*")]) { const cs=getComputedStyle(e); const o={}; for (const p of P) o[p]=String(cs[p]).replace(/blob:[^")]*/g,"blob").slice(0,90); out[path(e)||"card"]=o; }
  const rs=getComputedStyle(root); out["#root"]={anim:rs.animationName+"|"+rs.animationTimingFunction, fill:rs.getPropertyValue("--skz-fill").trim(), ulfill:rs.getPropertyValue("--skz-ul-fill").trim(), bgpos:rs.getPropertyValue("--skz-bg-pos").trim(), bgimg:rs.getPropertyValue("--skz-bg-img").trim().slice(0,40)};
  return out;
})()`;
const diffSnaps = (snaps, label, diffs) => {
  let d = 0;
  for (const k of Object.keys(snaps.before)) for (const p of Object.keys(snaps.before[k])) if (snaps.before[k][p] !== snaps.after[k]?.[p]) { d++; diffs.push({ label, el: k, prop: p, before: snaps.before[k][p], after: snaps.after[k]?.[p] }); }
  if (Object.keys(snaps.after).length !== Object.keys(snaps.before).length) { d++; diffs.push({ label, note: "元素数不同" }); }
  return d;
};
// 已知的、不可见的差异：控件 / 控件后代 / 忽略区里 text-decoration 为 none 或被 visibility:hidden 藏起来的元素，装饰线颜色 / 线型不影响绘制；
// 根上 --skz-ul-fill 不再给 clip / leaf 根声明（没人读）。其余算"意外差异"，原样列出。
const KNOWN = (d) => (/#root/.test(d.el || "") && d.prop === "ulfill") || (/^textDecoration/.test(d.prop || "") && /(button|input|select|textarea)\d+(>|$)|div13/.test(d.el || ""));
const classify = (diffs) => {
  const known = {}, unexpected = [];
  for (const d of diffs) { if (KNOWN(d)) { const k = `${d.el}|${d.prop}`; known[k] = (known[k] || 0) + 1; } else unexpected.push(d); }
  return { knownInvisible: known, unexpectedCount: unexpected.length, unexpected: unexpected.slice(0, 60) };
};
const out = {};
try {
  if (run("diff")) {
    let cells = 0, same = 0; const diffs = [];
    const CASES = [];
    for (const s of ["light", "dark"]) for (const text of [undefined, "clip", "underline", "leaf", "tofu"]) for (const effect of ["solid", "fade", "pulse", "shimmer"]) CASES.push([s, "base,global,tofu", { effect, text }, `global/${s}/${effect}/${text ?? "默认"}`]);
    for (const text of [undefined, "underline", "leaf", "tofu"]) for (const effect of ["pulse", "shimmer"]) CASES.push(["light", "base,svg,tofu", { effect, text, engine: "svg" }, `svg/light/${effect}/${text ?? "默认"}`]);
    for (const [s, css, opts, label] of CASES) {
      await scheme(s);
      const snaps = {};
      for (const ver of ["before", "after"]) { await open(ver, css, opts); snaps[ver] = await c.ev(SNAP); }
      cells++;
      const d = diffSnaps(snaps, label, diffs);
      if (!d) same++;
      console.error(label, d ? `DIFF ${d}` : `same(${Object.keys(snaps.before).length} 元素)`);
    }
    out.diff = { cells, identicalCells: same, diffCount: diffs.length, ...classify(diffs) };
  }
  // 撤回分支强制开启（base-ff.css：把 @supports not (background-clip:text) 换成恒真），clip 根退回 underline 外观；pulse 下装饰线颜色允许变成静态
  if (run("ff")) {
    const r = {}; const diffs = [];
    await scheme("light");
    for (const effect of ["solid", "pulse", "shimmer"]) for (const text of [undefined, "underline"]) {
      const snaps = {};
      for (const ver of ["before", "after"]) { await open(ver, "base,global,ff", { effect, text }); snaps[ver] = await c.ev(SNAP); }
      const d = diffSnaps(snaps, `ff/${effect}/${text ?? "默认"}`, diffs);
      r[`${effect}/${text ?? "clip(撤回)"}`] = d ? `DIFF ${d}` : "same";
    }
    out.ff = { r, diffCount: diffs.length, ...classify(diffs) };
  }
  // 光带按步移动 + pulse + clip 文字背景仍在脉冲（改前改后各跑一遍对照）
  if (run("steps")) {
    await scheme("light");
    const probe = `(async()=>{
      const h3=root.querySelector("h3"), ic=root.querySelector("i"), im=root.querySelector("img"), btn=root.querySelector("button"); const cs=(e)=>getComputedStyle(e);
      const rows=[]; const t0=performance.now();
      while(performance.now()-t0<2000){ await new Promise(r=>requestAnimationFrame(r));
        rows.push([+cs(root).getPropertyValue("--skz-shimmer-p"), cs(h3).backgroundPosition, cs(ic).backgroundPosition, cs(im).backgroundPosition, cs(h3).backgroundColor, cs(h3).textDecorationColor, cs(btn).backgroundColor, cs(h3).color]); }
      let ch=0; const st=[]; for(let i=1;i<rows.length;i++) if(rows[i][0]!==rows[i-1][0]){ch++;st.push(+(rows[i][0]-rows[i-1][0]).toFixed(2));}
      const d=(i)=>new Set(rows.map(r=>r[i])).size;
      return {frames:rows.length, pChangesPerSec:+(ch/2).toFixed(1), stepVw:[...new Set(st)].slice(0,3), bgPosSyncTextIconImg:rows.every(r=>r[1]===r[2]&&r[2]===r[3]), h3BgPosDistinct:d(1), h3BgColorDistinct:d(4), h3DecoColorDistinct:d(5), btnBgDistinct:d(6), h3ColorDistinct:d(7), anim:cs(root).animationName+" "+cs(root).animationTimingFunction};
    })()`;
    const r = {};
    for (const ver of ["before", "after"]) for (const [effect, text] of [["shimmer", undefined], ["shimmer", "underline"], ["shimmer", "tofu"], ["pulse", undefined], ["pulse", "underline"], ["pulse", "tofu"]]) {
      await open(ver, "base,global,tofu", { effect, text });
      await sleep(400);
      r[`${ver} ${effect}/${text ?? "clip"}`] = await c.ev(probe);
    }
    out.steps = r;
  }
  // 防火墙：200 卡，视口外卡片（skz-fw）的文字背景 / 装饰线 / 文字颜色是否钉住；近处卡片是否仍在变
  if (run("fw")) {
    await scheme("light");
    const r = {};
    for (const ver of ["before", "after"]) for (const [effect, text] of [["pulse", undefined], ["shimmer", undefined], ["pulse", "underline"], ["pulse", "tofu"], ["shimmer", "underline"]]) {
      await open(ver, "base,global,tofu", { effect, text, n: 200 });
      await sleep(500);
      r[`${ver} ${effect}/${text ?? "clip"}`] = await c.ev(`(async()=>{
        const cards=[...root.children]; const fw=cards.filter(x=>x.hasAttribute("skz-fw")).length;
        const far=cards[150].querySelector("h3"), near=cards[0].querySelector("h3");
        const v=(e)=>{const cs=getComputedStyle(e);return [cs.backgroundColor,cs.backgroundPosition,cs.textDecorationColor,cs.color].join(" | ")};
        const a=[v(far),v(near)]; await new Promise(r=>setTimeout(r,400)); const b=[v(far),v(near)]; await new Promise(r=>setTimeout(r,300)); const d=[v(far),v(near)];
        return {fwCards:fw, total:cards.length, farStatic:new Set([a[0],b[0],d[0]]).size===1, nearChanges:new Set([a[1],b[1],d[1]]).size>1, far:a[0], near:[a[1],b[1],d[1]]};
      })()`);
    }
    out.fw = r;
  }
} finally {
  await c.close();
}
console.log(JSON.stringify(out, null, 1));
