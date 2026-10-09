// 实验 3：视觉对比与漏光量化。n=5 的短根，orig / new / new+skew(-12deg)，浅/深，blend / bg；
// t=300/550ms 截图 + 与 t=0 的差异放大图；按 t=0 时像素的原色分类统计：骨头（提亮目标）、卡片底、页面底（漏光）、其它（文字/边框）
import { launch, open, pauseAt, sleep, grab, writeDiffViz } from "./cdp.mjs";
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
for (const theme of ["light", "dark"]) for (const v of ["orig", "new", "newskew"]) {
  await open(b, `css=base,sweep&v=${v === "newskew" ? "new" : v}&theme=${theme}`);
  for (const mode of ["blend", "bg"]) {
    const attrs = [mode === "bg" ? '["skz-sweep","bg"]' : null].filter(Boolean);
    const vars = v === "newskew" ? '{"--skz-sweep-skew":"-12deg"}' : "{}";
    await b.ev(`setup(5, { effect: "sweep", _attrs: [${attrs}], _vars: ${vars} })`); await sleep(500);
    await pauseAt(b, 0); await sleep(250); const a = await grab(b);
    for (const t of [550]) {
      await pauseAt(b, t); await sleep(250); const c = await grab(b, `vis-${theme}-${mode}-${v}-t${t}.png`);
      writeDiffViz(a, c, `visdiff-${theme}-${mode}-${v}-t${t}.png`);
      const r = { theme, mode, v, t, ...classify(a, c, PAL[theme]) }; out.push(r); console.log(JSON.stringify(r));
    }
  }
}
fs.writeFileSync("results/exp3-visual.jsonl", out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await b.close();
