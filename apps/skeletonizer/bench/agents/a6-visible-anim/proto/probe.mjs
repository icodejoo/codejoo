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


// ===== probe：同步方式对照（waapi / delay / none）+ 跳转首帧细节 =====
const RESULT2 = RESULT.replace("verify-result", "probe-result");
await go("a");
for (const effect of ["shimmer", "pulse"]) {
  for (const mode of ["waapi", "delay", "none"]) {
    const o = effect === "shimmer" ? { effect, text: "leaf", a: true } : { effect, a: true };
    await ev(`setup(2000, ${JSON.stringify(o)})`);
    await ev(`window.__skzSync = "${mode}"; startSchemeA(root)`); // 切模式后重新挂载
    await ev(`jsDrive("top")`);
    // 1) 慢速连续滚动：每帧 60px，视口内新旧卡片并存，每帧采样一次
    const slow = await ev(`(async () => { scrollTo(0, 30000); await sleep(800); aReset(); const rows = []; for (let f = 0; f < 120; f++) { scrollBy(0, 60); await nf(); const s = V.sample(); const sp = V.spread(s); rows.push({ n: s.n, pSpread: sp.pSpread, pErr: sp.pErrVsTimeline, ch: Math.max(...sp.colorSpread), bgx: sp.bgxDistinct }); } return rows; })()`);
    // 2) 随机时刻的静止态（滚到某处等 700ms 再采样），10 次
    const still = [];
    for (let i = 0; i < 10; i++) {
      await sleep(Math.floor(Math.random() * 1500));
      still.push(await ev(`(async () => { scrollTo(0, ${Math.floor(Math.random() * 150000)}); await sleep(700); await nf(); const sp = V.spread(V.sample()); return { pSpread: sp.pSpread, pErr: sp.pErrVsTimeline, ch: Math.max(...sp.colorSpread) }; })()`));
    }
    // 3) 跳转后逐帧细节：第一张可见卡片的动画状态
    const jump = await ev(`(async () => { scrollTo(0, 0); await sleep(600); scrollTo(0, 90000); const rows = []; for (let f = 0; f < 6; f++) { await nf(); const c = [...root.children].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })[0]; rows.push({ f, tl: +document.timeline.currentTime.toFixed(1), attr: c.hasAttribute("skz-anim"), p: parseFloat(getComputedStyle(c).getPropertyValue("--skz-shimmer-p")), anims: c.getAnimations().map((a) => ({ name: a.animationName, st: a.startTime == null ? null : +a.startTime.toFixed(1), ct: a.currentTime == null ? null : +a.currentTime.toFixed(1), pending: a.pending, state: a.playState })) }); } return rows; })()`);
    const st = await ev(`(() => { const s = aStats(); return { calls: s.calls, entries: s.entries, enter: s.enter, ms: +s.ms.toFixed(2), maxMs: +s.maxMs.toFixed(2) }; })()`);
    const sum = (a, k) => Math.max(...a.map((x) => x[k]));
    out(`probe_${effect}_${mode}`, { slow: { frames: slow.length, maxPSpread: sum(slow, "pSpread"), maxPErr: sum(slow, "pErr"), maxChSpread: sum(slow, "ch"), framesBgxMismatch: slow.filter((x) => x.bgx > 1).length, framesPSpreadOver1: slow.filter((x) => x.pSpread > 1).length, framesChOver2: slow.filter((x) => x.ch > 2).length }, still: { maxPSpread: sum(still, "pSpread"), maxPErr: sum(still, "pErr"), maxChSpread: sum(still, "ch") }, jump, io: st });
  }
}
await ev(`window.__skzSync = "waapi"`);
fs.writeFileSync(RESULT2, JSON.stringify(R, null, 1));
await send("Browser.close").catch(() => {});
process.exit(0);
