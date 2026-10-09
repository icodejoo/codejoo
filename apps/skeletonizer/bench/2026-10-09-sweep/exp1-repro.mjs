// 实验 1：复现。不同根高 x 两种模式：暂停在 t=0（光带在左侧屏外）和 t=550ms（光带在视口内），做像素差
import { launch, open, pauseAt, sleep, grab, diff } from "./cdp.mjs";
import fs from "node:fs";
const v = process.argv[2] || "orig", theme = process.argv[3] || "light";
const b = await launch();
await open(b, `css=base,sweep&v=${v}&theme=${theme}`);
const out = [];
for (const mode of ["blend", "bg"]) for (const n of [37, 100, 140, 148, 150, 296, 591]) {
  await b.ev(`setup(${n}, { effect: "sweep"${mode === "bg" ? ', _attrs: [["skz-sweep","bg"]]' : ""} })`); await sleep(500);
  const h = await b.ev('Math.round(document.getElementById("root").getBoundingClientRect().height)');
  await pauseAt(b, 0); await sleep(250); const a = await grab(b, `repro-${v}-${theme}-${mode}-n${n}-t0.png`);
  await pauseAt(b, 550); await sleep(250); const c = await grab(b, `repro-${v}-${theme}-${mode}-n${n}-t550.png`);
  out.push({ v, theme, mode, n, rootHeight: h, ...diff(a, c) }); console.log(JSON.stringify(out.at(-1)));
}
fs.writeFileSync(`results/exp1-repro-${v}-${theme}.jsonl`, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await b.close();
