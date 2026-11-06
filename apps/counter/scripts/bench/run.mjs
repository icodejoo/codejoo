// CPU / rAF 前后对比：每个场景 base 与 cur 交错跑若干轮，取中位数。
// 用法：node scripts/bench/run.mjs '[["cd1s",100,0],["ring",100]]' [持续ms=6000] [轮数=3]
// 场景：cd1s(整秒倒计时) cdms(毫秒倒计时) cdms-off/cu-off(大量离屏) cu(count-up) ring/card/odo(渲染插件，全在视口内)；第三项为各任务截止时间错开的毫秒数
import { launch, sleep } from "./cdp.mjs";

const scenarios = JSON.parse(process.argv[2] ?? '[["cd1s",100,0]]');
const DUR = Number(process.argv[3] ?? 6000);
const rounds = Number(process.argv[4] ?? 3);
const b = await launch(9444);
const med = (a, k) => a.map((o) => o[k]).sort((x, y) => x - y)[a.length >> 1];
const out = [];
for (const [s, n, o = 0] of scenarios) {
  const acc = { base: [], cur: [] };
  for (let r = 0; r < rounds; r++) {
    for (const v of r % 2 ? ["cur", "base"] : ["base", "cur"]) {
      await b.open({ v, s, n, o });
      await sleep(1500);
      const m0 = await b.metrics();
      const r0 = await b.ev("[__raf,__timer]");
      await sleep(DUR);
      const m1 = await b.metrics();
      const r1 = await b.ev("[__raf,__timer]");
      const sec = DUR / 1000;
      const per = (k) => ((m1[k] - m0[k]) * 1000) / sec;
      acc[v].push({ raf: (r1[0] - r0[0]) / sec, timer: (r1[1] - r0[1]) / sec, js: per("ScriptDuration"), task: per("TaskDuration"), layout: per("LayoutDuration"), style: per("RecalcStyleDuration") });
    }
  }
  for (const v of ["base", "cur"])
    out.push({
      场景: `${s}×${String(n)} 偏移${String(o)}ms`,
      构建: v,
      "rAF/s": +med(acc[v], "raf").toFixed(1),
      "timer/s": +med(acc[v], "timer").toFixed(2),
      "JS ms/s": +med(acc[v], "js").toFixed(2),
      "主线程 ms/s": +med(acc[v], "task").toFixed(2),
      "布局 ms/s": +med(acc[v], "layout").toFixed(2),
      "样式 ms/s": +med(acc[v], "style").toFixed(2),
    });
}
console.table(out);
b.close();
process.exit(0);
