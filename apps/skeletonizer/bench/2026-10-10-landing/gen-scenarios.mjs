// 生成场景 scenarios/sc-{A,B}.json。node gen-scenarios.mjs
// 新 = 落地后的 dist；旧 = 落地前的 global.css（old/global.css：linear + shimmer 一律挂 pulse + 防火墙没钉 --skz-tbg）叠在新 base 上
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const MODE = { clip: {}, ul: { text: "underline" }, tofu: { text: "tofu" } };
const sc = (id, desc, css, n, attrs, extra = {}) => ({ name: `${id} ${desc} @${n}`, css, n, attrs, ...extra });
const NEW_G = "base,global,tofu", NEW_S = "base,svg,tofu", OLD_G = "base,global,tofu,oldglobal";
const row = (id, ver, eff, mode, css, extra = {}) =>
  sc(`${id}-${ver}-${eff}-${mode}`, `${ver} ${eff} ${mode}`, css, 2000, { effect: eff === "shimmer-svg" ? "shimmer" : eff, ...(eff === "shimmer-svg" ? { engine: "svg" } : {}), ...MODE[mode] }, { probe: eff === "shimmer", ...extra });
const canary = (t) => [sc(`CAN-${t}`, "canary shimmer global clip(新)", NEW_G, 500, { effect: "shimmer" }, { probe: true }), sc(`CAN-${t}f`, "canary fade clip", "base", 2000, { effect: "fade" })];
const wrap = (tag, list) => [...canary(`${tag}1`), ...list, ...canary(`${tag}2`)];
// A：2000 卡，{shimmer global, pulse global, shimmer svg} × {clip, underline, tofu}（新），外加落地前的 clip / underline 基线
const A = [];
for (const mode of ["clip", "ul", "tofu"]) {
  A.push(row("A", "新", "shimmer", mode, NEW_G), row("A", "新", "pulse", mode, NEW_G), row("A", "新", "shimmer-svg", mode, NEW_S));
}
A.push(row("A", "旧", "shimmer", "clip", OLD_G), row("A", "旧", "pulse", "clip", OLD_G), row("A", "旧", "shimmer", "ul", OLD_G), row("A", "旧", "pulse", "ul", OLD_G));
// B：4× CPU 降速，2000 卡 shimmer global
const B = [];
for (const mode of ["clip", "ul", "tofu"]) B.push(row("B", "新", "shimmer", mode, NEW_G, { cpu: 4 }));
B.push(row("B", "旧", "shimmer", "clip", OLD_G, { cpu: 4 }), row("B", "旧", "shimmer", "ul", OLD_G, { cpu: 4 }));
// C：4× CPU 降速 + --skz-shimmer-timing: steps(18)（12 次/秒），2000 卡 shimmer global，验证降速下更低档位是否有收益
const C = [];
for (const mode of ["clip", "ul", "tofu"]) C.push({ ...row("C", "新", "shimmer", mode, NEW_G, { cpu: 4 }), name: `C-新-steps18-${mode} 新 shimmer steps(18) ${mode} @2000`, attrs: { effect: "shimmer", ...MODE[mode], _vars: { "--skz-shimmer-timing": "steps(18)" } } });
fs.mkdirSync(new URL("scenarios/", HERE), { recursive: true });
const OUT = { A: wrap("A", A), B: wrap("B", B), C: wrap("C", C) };
for (const [k, list] of Object.entries(OUT)) { fs.writeFileSync(new URL(`scenarios/sc-${k}.json`, HERE), JSON.stringify(list)); console.log(k, list.length); }
