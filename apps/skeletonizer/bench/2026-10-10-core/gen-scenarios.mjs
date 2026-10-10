// 生成 scenarios/*.json。每格换一个无意义的 css 令牌 f<序号>，强制每格重新加载页面（避免同一页面里前一格留下的动画状态影响，见 ../2026-10-10-layering/NOTES.md 的"会话状态陷阱"）。
// 卡片数 n：每卡 8 个元素，125 / 250 / 500 卡 = 约 1000 / 2000 / 4000 元素（根下元素数在结果的 elements 字段里）。
//   sc-M.json  主批：core {125, 250, 500} × {fade, solid, pulse, shimmer}；完整版 {125, 250, 500} × {pulse, shimmer}；
//              4× CPU 降速：250 卡 core / 完整版 × {pulse, shimmer}；首尾各一对金丝雀（core shimmer @250、core fade @500）
//   sc-T.json  上限批：core / 完整版 {750, 1000, 1500, 2000} 卡 × {pulse, shimmer}（正常速度）；4× 降速：core {63, 125, 188} 卡、core / 完整版 500 卡 × {pulse, shimmer}；金丝雀同上
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const sc = (name, css, n, attrs, extra = {}) => ({ name, css, n, attrs, ...extra });
const fresh = (list) => list.map((s, i) => ({ ...s, css: `${s.css},f${i}` }));
const canary = (t) => [sc(`CAN-${t} core shimmer @250`, "core", 250, { effect: "shimmer" }, { probe: true }), sc(`CAN-${t}f core fade @500`, "core", 500, { effect: "fade" })];
const cell = (mode, eff, n, extra = {}) => sc(`${mode}-${eff} @${n}${extra.cpu ? " 4x" : ""}`, mode, n, { effect: eff }, { probe: eff === "shimmer", toggle: true, toggleN: 5, snap: true, ...extra });
fs.mkdirSync(new URL("scenarios/", HERE), { recursive: true });

const M = [...canary("1")];
for (const n of [125, 250, 500]) for (const eff of ["fade", "solid", "pulse", "shimmer"]) M.push(cell("core", eff, n));
for (const n of [125, 250, 500]) for (const eff of ["pulse", "shimmer"]) M.push(cell("full", eff, n));
for (const mode of ["core", "full"]) for (const eff of ["pulse", "shimmer"]) M.push(cell(mode, eff, 250, { cpu: 4 }));
M.push(...canary("2"));
fs.writeFileSync(new URL("scenarios/sc-M.json", HERE), JSON.stringify(fresh(M)));

const T = [...canary("1")];
for (const n of [750, 1000, 1500, 2000]) for (const mode of ["core", "full"]) for (const eff of ["pulse", "shimmer"]) T.push(cell(mode, eff, n));
for (const n of [63, 125, 188]) for (const eff of ["pulse", "shimmer"]) T.push(cell("core", eff, n, { cpu: 4 }));
for (const mode of ["core", "full"]) for (const eff of ["pulse", "shimmer"]) T.push(cell(mode, eff, 500, { cpu: 4 }));
T.push(...canary("2"));
fs.writeFileSync(new URL("scenarios/sc-T.json", HERE), JSON.stringify(fresh(T)));
console.log("M", M.length, "T", T.length);
