// 生成 scenarios/sc-Y.json：每个场景换一个无意义的 css 令牌（r1..r6），强制每格都重新加载页面，
// 排除"同一页面里前面场景留下的状态"的影响；underline shimmer 是要看的点，clip shimmer 作对照。
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const G = "base,global,tofu";
const list = [];
for (let i = 1; i <= 6; i++) {
  list.push({ name: `Y-shimmer-underline r${i}`, css: `${G},r${i}`, n: 2000, attrs: { effect: "shimmer", text: "underline" } });
  list.push({ name: `Y-shimmer-clip r${i}`, css: `${G},q${i}`, n: 2000, attrs: { effect: "shimmer" } });
}
fs.writeFileSync(new URL("scenarios/sc-Y.json", HERE), JSON.stringify(list));
console.log("Y", list.length);
