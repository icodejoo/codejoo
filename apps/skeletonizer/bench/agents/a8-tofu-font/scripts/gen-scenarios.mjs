// 生成场景：{500,2000} x {pulse global, shimmer global, shimmer svg} x {underline, clip(dist 默认), tofu}，加 4x 降速与 tofuall 对照
import fs from "node:fs";
const M = {
  underline: (eng) => ({ css: eng === "svg" ? "base,svg" : "base,global", text: "underline" }),
  clip: (eng) => ({ css: eng === "svg" ? "base,svg" : "base,global", text: undefined }),
  tofu: (eng) => ({ css: eng === "svg" ? "base,svg,tofu" : "base,global,tofu", text: "tofu" }),
  tofuall: (eng) => ({ css: eng === "svg" ? "base,svg,tofuall" : "base,global,tofuall", text: "tofu" }),
};
const E = [["pulse", "global", "pulse global"], ["shimmer", "global", "shimmer global"], ["shimmer", "svg", "shimmer svg"]];
const sc = [], cpu4 = [];
const mk = (m, effect, eng, label, n, cpu) => { const v = M[m](eng); const attrs = { effect }; if (v.text) attrs.text = v.text; if (eng === "svg") attrs.engine = "svg"; const o = { name: `${m} ${label} @${n}${cpu ? " cpu" + cpu : ""}`, css: v.css, n, attrs, toggle: true, toggleN: 7, snap: false }; if (cpu) o.cpu = cpu; return o; };
for (const n of [500, 2000]) for (const [effect, eng, label] of E) for (const m of ["underline", "clip", "tofu"]) sc.push(mk(m, effect, eng, label, n));
for (const n of [500, 2000]) sc.push(mk("tofuall", "shimmer", "global", "shimmer global", n));
for (const [effect, eng, label] of [E[1], E[2]]) for (const m of ["underline", "clip", "tofu"]) cpu4.push(mk(m, effect, eng, label, 2000, 4));
sc.sort((a, b) => a.css.localeCompare(b.css)); cpu4.sort((a, b) => a.css.localeCompare(b.css));
fs.writeFileSync("data/sc-perf.json", JSON.stringify(sc, null, 1)); fs.writeFileSync("data/sc-perf-cpu4.json", JSON.stringify(cpu4, null, 1));
console.log(sc.length, cpu4.length);
