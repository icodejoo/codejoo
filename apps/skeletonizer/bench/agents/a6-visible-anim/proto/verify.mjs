// 方案 A 正确性 + 连续滚动验证（在拿到 bench.lock 的 Chrome 里跑，由 run-verify.mjs 调用）
import fs from "node:fs";
const PORT = +(process.env.PERF_PORT || 9341);
const HOST = process.env.PERF_HOST || "http://localhost:5188/demo/.tmp-a6-visible-anim/perf.html";
const OUT = process.env.OUT_DIR || "E:/workspaces/codejoo/apps/skeletonizer/bench/agents/a6-visible-anim/shots";
const RESULT = process.env.RESULT || "E:/workspaces/codejoo/apps/skeletonizer/bench/agents/a6-visible-anim/verify-result.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
fs.mkdirSync(OUT, { recursive: true });
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64")); };
await send("Page.enable"); await send("Page.bringToFront");
const R = {}; // 结果
const out = (k, v) => { R[k] = v; console.log(k, JSON.stringify(v)); };

/** 页面里的辅助函数 */
const HELPERS = `window.V = (() => {
  const H = () => innerHeight;
  const kids = () => [...root.children];
  const rect = (c) => c.getBoundingClientRect();
  const inView = (c) => { const r = rect(c); return r.bottom > 0 && r.top < H(); };
  const near = (c) => { const r = rect(c); return r.bottom > -200 && r.top < H() + 200; };
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  return {
    /** 视口内/外的动画挂载审计 */
    audit() {
      const cs = kids(); let a = {total: cs.length, withAnim: 0, inView: 0, inViewAnim: 0, near: 0, nearAnim: 0, farWithAttr: 0, farWithAnimations: 0, nearWithoutAttr: 0, withFw: 0, withFwInView: 0};
      for (const c of cs) {
        const iv = inView(c), nr = near(c), at = c.hasAttribute("skz-anim"), an = c.getAnimations().length;
        if (at) a.withAnim++;
        if (c.hasAttribute("skz-fw")) { a.withFw++; if (iv) a.withFwInView++; }
        if (iv) { a.inView++; if (at) a.inViewAnim++; }
        if (nr) { a.near++; if (at) a.nearAnim++; else a.nearWithoutAttr++; }
        if (!nr && at) a.farWithAttr++;
        if (!nr && an) a.farWithAnimations++;
      }
      a.docAnimations = document.getAnimations().length; a.rootAnimations = root.getAnimations().length;
      a.rootHasSkzA = root.hasAttribute("skz-a"); a.scrollY = Math.round(scrollY);
      return a;
    },
    /** 同一时刻采样视口内卡片 */
    sample() {
      const t = document.timeline.currentTime;
      const rows = kids().filter(inView).map((c) => { const s = getComputedStyle(c), h = getComputedStyle(c.querySelector("h3")); return { p: parseFloat(s.getPropertyValue("--skz-shimmer-p")), c: s.getPropertyValue("--skz-pulse-c").trim(), bgx: h.backgroundPositionX, bg: h.backgroundColor, ul: getComputedStyle(c.querySelector("span")).textDecorationColor }; });
      return { t, n: rows.length, rows };
    },
    /** 采样汇总：p 的极差、pulse 颜色各通道极差、bgx 是否一致、与理论相位的差 */
    spread(s) {
      const ps = s.rows.map((r) => r.p), cs = s.rows.map((r) => rgb(r.c)), bx = new Set(s.rows.map((r) => r.bgx)), bgs = new Set(s.rows.map((r) => r.bg)), uls = new Set(s.rows.map((r) => r.ul));
      const ch = [0, 1, 2].map((i) => Math.max(...cs.map((c) => c[i])) - Math.min(...cs.map((c) => c[i])));
      const exp = -60 + 170 * ((s.t % 1500) / 1500);
      return { n: s.n, pSpread: +(Math.max(...ps) - Math.min(...ps)).toFixed(4), pFirst: ps[0], pExpected: +exp.toFixed(3), pErrVsTimeline: +Math.abs(ps[0] - exp).toFixed(3), colorSpread: ch, colorFirst: s.rows[0].c, bgxDistinct: bx.size, bgDistinct: bgs.size, ulDistinct: uls.size };
    },
    nextSpread: async function () { await nf(); return this.spread(this.sample()); },
    /** 连续滚动：每帧滚 px，持续 ms，统计帧间隔与观察器回调 */
    async scrollTest(px, ms) {
      scrollTo(0, 0); await nf(); await sleep(500); aReset();
      let long = 0; const po = new PerformanceObserver((l) => { long += l.getEntries().length; }); try { po.observe({ entryTypes: ["longtask"] }); } catch {}
      const maxY = document.body.scrollHeight - innerHeight; let y = 0, dir = 1; const ts = []; const start = performance.now(); let last = start;
      while (performance.now() - start < ms) { await nf(); const n = performance.now(); ts.push(n - last); last = n; y += dir * px; if (y > maxY) { y = maxY; dir = -1; } if (y < 0) { y = 0; dir = 1; } scrollTo(0, y); }
      po.disconnect(); ts.shift(); const s = [...ts].sort((a, b) => a - b); const st = aStats();
      return { px, frames: ts.length, fps: +(ts.length / ((last - start) / 1000)).toFixed(1), medMs: +s[s.length >> 1].toFixed(2), p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(2), maxMs: +s[s.length - 1].toFixed(1), over20: ts.filter((x) => x > 20).length, over33: ts.filter((x) => x > 33).length, longTasks: long, ioCalls: st.calls, ioEntries: st.entries, ioEnter: st.enter, ioTotalMs: +st.ms.toFixed(2), ioMaxMs: +st.maxMs.toFixed(2), ioAvgMs: st.calls ? +(st.ms / st.calls).toFixed(3) : 0 };
    },
    /** 跳到列表中部：逐帧数视口内"还没动起来"的卡片（A：缺 skz-anim；现行：带 skz-fw） */
    async jumpTest() {
      scrollTo(0, 0); await nf(); await sleep(600); scrollTo(0, (document.body.scrollHeight - innerHeight) / 2);
      const miss = []; for (let f = 0; f < 12; f++) { await nf(); const cs = kids().filter(inView); miss.push(cs.filter((c) => (root.hasAttribute("skz-a") ? !c.hasAttribute("skz-anim") : c.hasAttribute("skz-fw"))).length + "/" + cs.length); }
      return miss;
    },
  };
})()`;

let curCss = null;
const go = async (css) => {
  if (css === curCss) return;
  await send("Page.navigate", { url: `${HOST}?css=${css}` });
  for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
  await sleep(400); curCss = css; await ev(HELPERS);
};

// ===== 阶段 1：方案 A shimmer 叶子 2000 卡片 =====
await go("a");
await ev(`setup(2000, {effect: "shimmer", text: "leaf", a: true})`);
await ev(`jsDrive("top")`);
out("p1_audit_top", await ev(`V.audit()`));
{
  const s1 = await ev(`V.sample()`); await sleep(300); const s2 = await ev(`V.sample()`); await sleep(300); const s3 = await ev(`V.sample()`);
  out("p1_motion", { p_t1: s1.rows[0].p, p_t2: s2.rows[0].p, p_t3: s3.rows[0].p, bgx_t1: s1.rows[0].bgx, bgx_t2: s2.rows[0].bgx, changed: s1.rows[0].p !== s2.rows[0].p && s2.rows[0].p !== s3.rows[0].p });
  out("p1_far_card1000", await ev(`(() => { const c = root.children[1000]; const s = getComputedStyle(c); return { hasAttr: c.hasAttribute("skz-anim"), animations: c.getAnimations().length, p: s.getPropertyValue("--skz-shimmer-p"), bgx: getComputedStyle(c.querySelector("h3")).backgroundPositionX }; })()`));
  await sleep(300);
  out("p1_far_card1000_later", await ev(`(() => { const c = root.children[1000]; return { p: getComputedStyle(c).getPropertyValue("--skz-shimmer-p"), bgx: getComputedStyle(c.querySelector("h3")).backgroundPositionX }; })()`));
}
out("p1_sync_top_same_instant", await ev(`V.nextSpread()`));
await shot("a-shimmer-light-top-1"); await sleep(400); await shot("a-shimmer-light-top-2");

// 同步：随机偏移滚动 + 随机延迟，每次滚动后逐帧采样，看新进入的卡片和留下的卡片相位是否一致
{
  const trials = [];
  for (let i = 0; i < 10; i++) {
    const y = Math.floor(Math.random() * 150000);
    await sleep(Math.floor(Math.random() * 1500)); // 随机时刻，覆盖 1.5s 周期与 alternate 奇偶
    const r = await ev(`(async () => { scrollTo(0, ${y}); const rows = []; for (let f = 0; f < 6; f++) { await nf(); const s = V.sample(); rows.push({ f, ...V.spread(s) }); } return rows; })()`);
    trials.push({ y, frames: r.map((x) => ({ f: x.f, n: x.n, pSpread: x.pSpread, pErr: x.pErrVsTimeline, bgx: x.bgxDistinct })) });
  }
  out("p1_sync_scroll_trials", trials);
  const flat = trials.flatMap((t) => t.frames);
  out("p1_sync_scroll_summary", { maxPSpread: Math.max(...flat.map((x) => x.pSpread)), maxPErrVsTimeline: Math.max(...flat.map((x) => x.pErr)), framesWithBgxMismatch: flat.filter((x) => x.bgx > 1).length, framesTotal: flat.length, byFrame: [0, 1, 2, 3, 4, 5].map((f) => ({ f, maxPSpread: Math.max(...trials.map((t) => t.frames[f].pSpread)), maxPErr: Math.max(...trials.map((t) => t.frames[f].pErr)) })) });
}
// 相邻滚动：只滚一小段，留下的卡片和新进来的卡片并存
{
  await ev(`scrollTo(0, 50000)`); await sleep(800);
  await ev(`scrollTo(0, 50000 + 300)`); await sleep(1000);
  out("p1_sync_partial_overlap", await ev(`V.nextSpread()`));
}
await ev(`jsDrive("mid")`);
out("p1_audit_mid", await ev(`V.audit()`));
await shot("a-shimmer-light-mid-1"); await sleep(400); await shot("a-shimmer-light-mid-2");

// 动态插入：视口内头部插 5 张，尾部加 5 张
{
  await ev(`scrollTo(0, 0)`); await sleep(800);
  const r = await ev(`(async () => {
    const mk = () => { const d = root.children[0].cloneNode(true); d.removeAttribute("skz-anim"); return d; };
    const added = []; for (let i = 0; i < 5; i++) { const d = mk(); root.insertBefore(d, root.children[0]); added.push(d); }
    const tail = []; for (let i = 0; i < 5; i++) { const d = mk(); root.appendChild(d); tail.push(d); }
    for (let f = 0; f < 4; f++) await nf(); await sleep(300); await nf();
    const s = V.spread(V.sample());
    return { headAnim: added.map((d) => d.hasAttribute("skz-anim")), headAnimations: added.map((d) => d.getAnimations().length), tailAnim: tail.map((d) => d.hasAttribute("skz-anim")), spread: s };
  })()`);
  out("p1_dynamic_insert", r);
  out("p1_dynamic_remove", await ev(`(async () => { for (let i = 0; i < 5; i++) root.children[0].remove(); await nf(); await nf(); return V.audit(); })()`));
}
// 深色主题
await ev(`scrollTo(0,0)`); await sleep(500);
await ev(`document.documentElement.setAttribute("data-skz-theme", "dark")`); await sleep(500);
out("p1_dark_sample", await ev(`(() => { const s = V.sample(); const far = root.children[1000]; const fh = getComputedStyle(far.querySelector("h3")); return { rows0: s.rows[0], far: { bg: fh.backgroundColor, bgImg: fh.backgroundImage.slice(0, 120), colorVar: getComputedStyle(root).getPropertyValue("--skz-color") } }; })()`));
await shot("a-shimmer-dark-top");
await ev(`document.documentElement.setAttribute("data-skz-theme", "light")`); await sleep(500);
out("p1_light_sample", await ev(`(() => { const s = V.sample(); const far = root.children[1000]; const fh = getComputedStyle(far.querySelector("h3")); return { rows0: s.rows[0], far: { bg: fh.backgroundColor, bgImg: fh.backgroundImage.slice(0, 120) } }; })()`));
await ev(`document.documentElement.removeAttribute("data-skz-theme")`);

// effect 切换：shimmer -> pulse（enable 幂等重调）
{
  await ev(`setOpts({effect: "pulse"}); doEnable()`); await sleep(800);
  const au = await ev(`V.audit()`);
  const a = await ev(`V.sample()`); await sleep(400); const b = await ev(`V.sample()`);
  out("p1_effect_switch_to_pulse", { audit: { inView: au.inView, inViewAnim: au.inViewAnim, withFw: au.withFw, docAnimations: au.docAnimations }, c1: a.rows[0].c, c2: b.rows[0].c, changed: a.rows[0].c !== b.rows[0].c });
  await shot("a-switch-pulse-top");
}
// release：关闭后无残留
{
  out("p1_release", await ev(`(async () => { doDisable(); await nf(); await nf(); return { skzAnimLeft: root.querySelectorAll("[skz-anim]").length, docAnimations: document.getAnimations().length, rootAttrs: root.getAttributeNames() }; })()`));
  out("p1_reenable", await ev(`(async () => { doEnable(); await nf(); await nf(); await sleep(300); await nf(); const a = V.audit(); return { inView: a.inView, inViewAnim: a.inViewAnim, docAnimations: a.docAnimations }; })()`));
}

// ===== 阶段 2：方案 A pulse 下划线 2000 =====
await ev(`setup(2000, {effect: "pulse", a: true})`); await ev(`jsDrive("top")`);
out("p2_audit_top", await ev(`V.audit()`));
{
  const a = await ev(`V.sample()`); await sleep(500); const b = await ev(`V.sample()`);
  out("p2_motion", { c1: a.rows[0].c, c2: b.rows[0].c, ul1: a.rows[0].ul, ul2: b.rows[0].ul, changed: a.rows[0].c !== b.rows[0].c });
  out("p2_far_card1000", await ev(`(() => { const c = root.children[1000]; return { hasAttr: c.hasAttribute("skz-anim"), animations: c.getAnimations().length, c: getComputedStyle(c).getPropertyValue("--skz-pulse-c").trim(), h3bg: getComputedStyle(c.querySelector("h3")).backgroundColor }; })()`));
}
await shot("a-pulse-light-top-1"); await sleep(700); await shot("a-pulse-light-top-2");
// pulse 颜色范围（浅色/深色）：3.3s 内逐帧采样
for (const th of ["light", "dark"]) {
  await ev(`document.documentElement.setAttribute("data-skz-theme", "${th}")`); await sleep(400);
  out(`p2_pulse_range_${th}`, await ev(`(async () => { const lo = [255, 255, 255], hi = [0, 0, 0]; const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 3300) { await nf(); const s = V.sample(); const c = (s.rows[0].c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); } n++; } return { lo, hi, n }; })()`));
  if (th === "dark") await shot("a-pulse-dark-top");
}
// pulse 同步：随机滚动
{
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const y = Math.floor(Math.random() * 150000); await sleep(Math.floor(Math.random() * 1500));
    const r = await ev(`(async () => { scrollTo(0, ${y}); const out = []; for (let f = 0; f < 6; f++) { await nf(); out.push(V.spread(V.sample())); } return out; })()`);
    rows.push(r.map((x) => ({ n: x.n, c: x.colorSpread, ul: x.ulDistinct })));
  }
  const flat = rows.flat();
  out("p2_sync_scroll_summary", { maxChannelSpread: Math.max(...flat.flatMap((x) => x.c)), framesWithUlMismatch: flat.filter((x) => x.ul > 1).length, framesTotal: flat.length });
  out("p2_sync_scroll_perFrame", [0, 1, 2, 3, 4, 5].map((f) => ({ f, maxChannelSpread: Math.max(...rows.map((r) => Math.max(...r[f].c))) })));
}
await ev(`document.documentElement.removeAttribute("data-skz-theme")`);

// ===== 阶段 3：对照：现行（防火墙）截图 =====
await go("base");
await ev(`setup(2000, {effect: "shimmer", text: "leaf"})`); await ev(`jsDrive("top")`);
out("p3_cur_audit_top", await ev(`V.audit()`));
await shot("cur-shimmer-light-top-1"); await sleep(400); await shot("cur-shimmer-light-top-2");

// ===== 阶段 4：连续滚动 / 跳转，现行 vs A =====
const cfgs = [
  ["cur-shimmer", "base", { effect: "shimmer", text: "leaf" }],
  ["A-shimmer", "a", { effect: "shimmer", text: "leaf", a: true }],
  ["cur-pulse", "base", { effect: "pulse" }],
  ["A-pulse", "a", { effect: "pulse", a: true }],
];
for (const n of [2000, 500]) {
  for (const [name, css, o] of cfgs) {
    await go(css);
    await ev(`setup(${n}, ${JSON.stringify(o)})`); await ev(`jsDrive("top")`);
    const res = [];
    for (const px of [40, 160]) for (let k = 0; k < 3; k++) res.push(await ev(`V.scrollTest(${px}, 3000)`));
    out(`p4_scroll_${n}_${name}`, res);
    const jumps = []; for (let k = 0; k < 3; k++) jumps.push(await ev(`V.jumpTest()`));
    out(`p4_jump_${n}_${name}`, jumps);
  }
}
fs.writeFileSync(RESULT, JSON.stringify(R, null, 1));
await send("Browser.close").catch(() => {});
process.exit(0);
