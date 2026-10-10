// 生成 scenarios/*.json（每格换一个无意义的 css 令牌 f<序号>，强制每格重新加载页面，避免同一页面里前面场景留下的动画 / 状态影响：
// 见 NOTES.md 的"会话状态陷阱"）：
//   sc-L.json  完整版 2000 卡 {pulse, shimmer} × {clip, underline}（global + enable，改前 / 改后 / 派生变量实验共用），首尾各一对金丝雀
//   sc-C.json  core 页面（core-js + core.css）2000 卡 {fade, pulse, shimmer}（第 3 批预览数据），同样首尾金丝雀
//   sc-Ls.json 同 sc-L 但不换令牌（同一页面里顺序跑；第一轮数据用的就是这版，保留作对照）
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const G = "base,global,tofu";
const sc = (name, css, n, attrs, extra = {}) => ({ name, css, n, attrs, ...extra });
const fresh = (list) => list.map((s, i) => ({ ...s, css: `${s.css},f${i}` }));
const canary = (t, css, eff) => [sc(`CAN-${t} canary ${eff} clip @500`, css, 500, { effect: eff }, { probe: eff === "shimmer" }), sc(`CAN-${t}f canary fade clip @2000`, css, 2000, { effect: "fade" })];
fs.mkdirSync(new URL("scenarios/", HERE), { recursive: true });

const L = [...canary("1", G, "shimmer")];
for (const [mode, extra] of [["clip", {}], ["underline", { text: "underline" }]]) {
  for (const eff of ["pulse", "shimmer"]) L.push(sc(`L-${eff}-${mode} @2000`, G, 2000, { effect: eff, ...extra }, { probe: eff === "shimmer", toggle: true, toggleN: 5 }));
}
L.push(...canary("2", G, "shimmer"));
fs.writeFileSync(new URL("scenarios/sc-Ls.json", HERE), JSON.stringify(L));
fs.writeFileSync(new URL("scenarios/sc-L.json", HERE), JSON.stringify(fresh(L)));

const C = [...canary("1", "core", "shimmer")];
for (const eff of ["fade", "pulse", "shimmer"]) C.push(sc(`C-${eff}-clip @2000`, "core", 2000, { effect: eff }, { probe: eff === "shimmer", toggle: true, toggleN: 5 }));
C.push(...canary("2", "core", "shimmer"));
fs.writeFileSync(new URL("scenarios/sc-Cs.json", HERE), JSON.stringify(C));
fs.writeFileSync(new URL("scenarios/sc-C.json", HERE), JSON.stringify(fresh(C)));
console.log("L", L.length, "C", C.length);
