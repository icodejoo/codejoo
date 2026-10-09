// 实验 7：sweep 合并后（浅色 lighten 混合 / 深色容器色）的真实 Chrome 验证。
// 用法：SWEEP_PORT=9488 SWEEP_PROFILE=<临时目录> node exp7-merged.mjs
// sweep-merged.css 由 `sass --load-path=src/styles src/styles/entries/sweep.scss` 编出。
// 方法同 exp3：暂停动画到 t=0 / 250 / 550ms，整视口截图逐像素差；按 t=0 时像素原色分类统计变化像素。
import { launch, open, pauseAt, sleep, grab, diff, writeDiffViz } from "./cdp.mjs";
import fs from "node:fs";
const PAL = {
  light: { bone: [217, 221, 227], card: [255, 255, 255], page: [249, 250, 251] },
  dark: { bone: [55, 65, 81], card: [31, 41, 55], page: [17, 24, 39] },
};
const same = (d, i, c) => d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2];
function classify(a, c, pal) {
  const r = { bone: [0, 0, 0], card: [0, 0, 0], page: [0, 0, 0], other: [0, 0, 0] }; // [总像素, 变化像素, 变化量之和]
  for (let i = 0; i < a.data.length; i += a.ch) {
    const k = same(a.data, i, pal.bone) ? "bone" : same(a.data, i, pal.card) ? "card" : same(a.data, i, pal.page) ? "page" : "other";
    r[k][0]++;
    const d = Math.max(Math.abs(a.data[i] - c.data[i]), Math.abs(a.data[i + 1] - c.data[i + 1]), Math.abs(a.data[i + 2] - c.data[i + 2]));
    if (d > 0) { r[k][1]++; r[k][2] += d; }
  }
  return Object.fromEntries(Object.entries(r).map(([k, [t, n, s]]) => [k, { total: t, changed: n, meanDelta: n ? +(s / n).toFixed(2) : 0 }]));
}
const out = [];
const b = await launch();
for (const theme of ["light", "dark"]) {
  await open(b, `css=base,sweep&v=merged&theme=${theme}`);
  await b.ev(`setup(5, { effect: "sweep" })`); await sleep(500);
  const info = await b.ev(`(() => { const a = getComputedStyle(root, "::after"); return { blend: a.mixBlendMode, mask: a.maskImage.slice(0, 20), top: a.top, rgb: getComputedStyle(root).getPropertyValue("--skz-sweep-rgb"), a: getComputedStyle(root).getPropertyValue("--skz-sweep-a") }; })()`);
  await pauseAt(b, 0); await sleep(250); const a0 = await grab(b, `merged-${theme}-t0.png`);
  for (const t of [250, 550]) {
    await pauseAt(b, t); await sleep(250); const c = await grab(b, `merged-${theme}-t${t}.png`);
    writeDiffViz(a0, c, `merged-${theme}-diff-t${t}.png`);
    const r = { theme, t, info, vsT0: diff(a0, c), ...classify(a0, c, PAL[theme]) }; out.push(r); console.log(JSON.stringify(r));
  }
}
fs.writeFileSync("results/exp7-merged.jsonl", out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await b.close();
