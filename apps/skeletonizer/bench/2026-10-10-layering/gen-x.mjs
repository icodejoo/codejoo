// 生成 scenarios/sc-X.json：选择器匹配开销实验用的小场景（underline shimmer 是回归点，clip 与 pulse 作对照）
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const G = "base,global,tofu";
const sc = (name, n, attrs, extra = {}) => ({ name, css: G, n, attrs, ...extra });
const list = [
  sc("CAN canary shimmer clip @500", 500, { effect: "shimmer" }),
  sc("X-shimmer-underline @2000", 2000, { effect: "shimmer", text: "underline" }, { toggle: true, toggleN: 5 }),
  sc("X-shimmer-clip @2000", 2000, { effect: "shimmer" }, { toggle: true, toggleN: 5 }),
  sc("X-pulse-underline @2000", 2000, { effect: "pulse", text: "underline" }),
  sc("X-shimmer-tofu @2000", 2000, { effect: "shimmer", text: "tofu" }),
  sc("CAN-2 canary shimmer clip @500", 500, { effect: "shimmer" }),
];
fs.writeFileSync(new URL("scenarios/sc-X.json", HERE), JSON.stringify(list));
console.log("X", list.length);
