// 生成实验 CSS（exp/*.css）与场景（scenarios/sc-*.json）。node gen-scenarios.mjs
// 变体名 = <shimmer 时间函数>[-nop|-ps]：lin | s36 | s18；-nop 去掉 shimmer 时一起跑的 pulse 动画；-ps pulse 也改 steps(N)
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const TIMING = { lin: "linear", s36: "steps(36)", s18: "steps(18)" };
const STEPS = { s36: 36, s18: 18 };
const PULSE = "skz-pulse-root var(--skz-duration) ease-in-out infinite alternate";

/** 一个变体的 CSS：覆盖 shimmer 根上的 animation，选择器与 dist 的 global.css 同优先级、靠加载顺序胜出 */
const css = (name) => {
  const [t, mod] = name.split("-");
  const pulse = mod === "nop" ? null : mod === "ps" ? `skz-pulse-root var(--skz-duration) steps(${STEPS[t]}) infinite alternate` : PULSE;
  const anims = [`skz-shimmer-root var(--skz-duration) ${TIMING[t]} infinite`, pulse].filter(Boolean).join(",\n    ");
  return `/* 实验变体 ${name}：shimmer ${TIMING[t]}，pulse ${mod === "nop" ? "不跑" : mod === "ps" ? "steps(" + STEPS[t] + ")" : "原样 ease-in-out alternate"} */\n[skz][skz-effect="shimmer"] {\n  animation:\n    ${anims};\n}\n`;
};
const VARIANTS = ["lin", "s36", "s18", "lin-nop", "s36-nop", "s18-nop", "s36-ps", "s18-ps"];
fs.mkdirSync(new URL("exp/", HERE), { recursive: true });
for (const v of VARIANTS) fs.writeFileSync(new URL(`exp/${v}.css`, HERE), css(v));

const sc = (id, desc, css, n, attrs, extra = {}) => ({ name: `${id} ${desc} @${n}`, css, n, attrs, probe: true, ...extra });
const MODE = { clip: {}, ul: { text: "underline" } };
// 一行 = 一个 (规模, 文字模式, 变体)；同变体的 clip / ul 相邻放置（同一次页面加载）
const grid = (id, desc, sizes, variants, modes, extra) =>
  sizes.flatMap((n) => variants.flatMap((v) => modes.map((m) => sc(`${id}-${v}-${m}`, `${desc} ${v} ${m}`, `base,global,x-${v}`, n, { effect: "shimmer", ...MODE[m] }, extra))));
const canary = (t) => [sc(`CAN-${t}`, "canary shimmer lin clip", "base,global,x-lin", 500, { effect: "shimmer" }), sc(`CAN-${t}f`, "canary fade clip", "base", 2000, { effect: "fade" })];
const wrap = (tag, list) => [...canary(`${tag}1`), ...list, ...canary(`${tag}2`)];

// A：主矩阵（shimmer global + enable，pulse 原样）
const A = grid("A", "shimmer", [500, 2000], ["lin", "s36", "s18"], ["clip", "ul"]);
// B：pulse 贡献（去掉 pulse / pulse 也降频），每个变体与 A 的同规模对照
const B = grid("B", "shimmer", [500, 2000], ["lin-nop", "s36-nop", "s18-nop", "s36-ps", "s18-ps"], ["clip", "ul"]);
// C：4x CPU 降速，2000 卡
const C = [...grid("C", "4x shimmer", [2000], ["lin", "s36", "s18", "lin-nop", "s36-nop", "s18-nop"], ["clip", "ul"], { cpu: 4 })];
// D：svg 引擎（SMIL）：原样 vs calcMode=discrete 的 N 档；基准页用 sd<N> 令牌改写生成的 SVG
const svgSc = (v, css, n, m, extra) => sc(`D-${v}-${m}`, `svg shimmer ${v} ${m}`, css, n, { effect: "shimmer", engine: "svg", ...MODE[m] }, extra);
const D = [500, 2000].flatMap((n) => [["nat", "base,svg"], ["d36", "base,svg,sd36"], ["d18", "base,svg,sd18"]].flatMap(([v, c]) => ["clip", "ul"].map((m) => svgSc(v, c, n, m))));
const D4 = [["nat", "base,svg"], ["d36", "base,svg,sd36"], ["d18", "base,svg,sd18"]].flatMap(([v, c]) => ["clip", "ul"].map((m) => svgSc(`4x-${v}`, c, 2000, m, { cpu: 4 })));
fs.mkdirSync(new URL("scenarios/", HERE), { recursive: true });
const OUT = { A: wrap("A", A), B: wrap("B", B), C: wrap("C", C), D: wrap("D", [...D, ...D4]) };
for (const [k, list] of Object.entries(OUT)) { fs.writeFileSync(new URL(`scenarios/sc-${k}.json`, HERE), JSON.stringify(list)); console.log(k, list.length); }
