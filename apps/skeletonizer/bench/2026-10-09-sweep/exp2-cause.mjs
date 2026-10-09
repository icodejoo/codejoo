// 实验 2：根因验证。(a) 滚到根中部看光带是否出现；(b) 去掉 skewX 看是否任意高度可见；(c) skew 原点改到视口附近；(d) DPR=2；(e) 去掉 will-change
import { launch, open, pauseAt, sleep, grab, diff } from "./cdp.mjs";
import fs from "node:fs";
const b = await launch();
await open(b, "css=base,sweep&v=orig");
const out = [];
const N = 296; // 40049px
const variants = {
  /* 仅重跑 noskew */
  orig: "",
  noskew: "[skz][skz-effect=sweep]::after{animation-name:skz-sweep-ns!important} @keyframes skz-sweep-ns{from{transform:translateX(-100%)}to{transform:translateX(100%)}}",
  nowillchange: "[skz][skz-effect=sweep]::after{will-change:auto!important}",
  origintop: "[skz][skz-effect=sweep]::after{transform-origin:50% 0!important}",
  noblend: "[skz][skz-effect=sweep]::after{mix-blend-mode:normal!important}",
};
async function measure(label, scrollFrac, extra = {}) {
  const H = await b.ev('document.documentElement.scrollHeight');
  await b.ev(`window.scrollTo(0, ${Math.round((H - 800) * scrollFrac)})`); await sleep(300);
  await pauseAt(b, 0); await sleep(250); const a = await grab(b);
  await pauseAt(b, 550); await sleep(250); const c = await grab(b, `cause-${label}-s${Math.round(scrollFrac * 100)}.png`);
  const r = { label, H, scrollFrac, ...extra, ...diff(a, c) }; out.push(r); console.log(JSON.stringify(r));
}
for (const [name, css] of Object.entries(variants)) {
  if (process.argv[2] && process.argv[2] !== name) continue;
  await b.ev(`(() => { document.getElementById("exp")?.remove(); const s = document.createElement("style"); s.id = "exp"; s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`);
  await b.ev(`setup(${N}, { effect: "sweep" })`); await sleep(500);
  for (const f of [0, 0.25, 0.5, 0.75, 1]) await measure(name, f);
}
if (!process.argv[2]) {
// DPR 2
await open(b, "css=base,sweep&v=orig", [1200, 800, 2]);
await b.ev(`setup(${N}, { effect: "sweep" })`); await sleep(500);
for (const f of [0, 0.5]) await measure("dpr2", f);
}
fs.writeFileSync(`results/exp2-cause${process.argv[2] ? "-" + process.argv[2] : ""}.jsonl`, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
await b.close();
