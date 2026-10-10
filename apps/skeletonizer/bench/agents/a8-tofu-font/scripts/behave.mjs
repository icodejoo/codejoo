// 行为验证：pulse 逐帧变色、global / svg 引擎、ignore / leaf / 表单控件、字体加载与失败降级
import { launch, sleep } from "./lib.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
const out = {};
const col = `(()=>{const e=document.querySelector("#cards h3");const s=getComputedStyle(e);return {color:s.color,fill:s.webkitTextFillColor,ff:s.fontFamily,td:s.textDecorationLine,bg:s.backgroundColor,bgi:s.backgroundImage}})()`;
for (const [name, cssq, opts] of [
  ["global-pulse", "base,global,tofu", { effect: "pulse", text: "tofu" }],
  ["global-shimmer", "base,global,tofu", { effect: "shimmer", text: "tofu" }],
  ["svg-pulse", "base,svg,tofu", { effect: "pulse", text: "tofu", engine: "svg" }],
  ["svg-shimmer", "base,svg,tofu", { effect: "shimmer", text: "tofu", engine: "svg" }],
  ["fade", "base,global,tofu", { effect: "fade", text: "tofu" }],
  ["solid", "base,global,tofu", { effect: "solid", text: "tofu" }],
]) {
  await c.goto(BASE + `demo.html?css=${cssq}`, "window.ready===true");
  await c.ev(`apply(${JSON.stringify(opts)})`); await sleep(400);
  const samples = [];
  for (let i = 0; i < 4; i++) { samples.push(await c.ev(col)); await sleep(300); }
  const colors = [...new Set(samples.map((s) => s.color))];
  const info = await c.ev(`(()=>{const q=(s)=>{const e=document.querySelector(s);const c=getComputedStyle(e);return {ff:c.fontFamily.slice(0,20),color:c.color,fill:c.webkitTextFillColor,td:c.textDecorationLine,bg:c.backgroundColor,bgi:c.backgroundImage.slice(0,30)}};return {input:q("#cards input"),select:q("#cards select"),textarea:q("textarea"),button:q("#cards .btn"),small:q("#cards small"),b:q("#cards b"),ignoreSpan:q("#ig"),ignoreP:q("#ign p[skz-ignore]"),img:q("#cards img"),icon:q("#cards .icon-star"),rootAttrs:Object.fromEntries(document.querySelector("#cards").getAttributeNames().map(a=>[a,document.querySelector("#cards").getAttribute(a).slice(0,20)]))}})()`);
  out[name] = { distinctColors: colors.length, colors, first: samples[0], info };
  await c.shot(`shots/cards-${name}.png`, { x: 0, y: 0, width: 1100, height: 450 });
  console.log(name, "distinct", colors.length, colors.join(" | "), "td", samples[0].td, "ff", samples[0].ff, "bgi", samples[0].bgi);
}
fs.writeFileSync("data/behave.json", JSON.stringify(out, null, 1));
await c.close();
