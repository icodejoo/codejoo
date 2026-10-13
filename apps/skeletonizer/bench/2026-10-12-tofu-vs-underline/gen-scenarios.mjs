// 生成 scenarios/sc-*.json。node gen-scenarios.mjs
// 每格 underline / tofu 成对相邻、顺序按格交替（ABBA 式，抵消批内漂移）。underline 页不加载 tofu.css，tofu 页加载。
import fs from "node:fs";
const HERE = new URL("./", import.meta.url);
const AUTO = [["skz-auto", ""]];
const EFF = {
  "pulse-g": { css: "base,global", attrs: { effect: "pulse" } },
  "shim-g": { css: "base,global", attrs: { effect: "shimmer" } },
  "shim-svg": { css: "base,svg", attrs: { effect: "shimmer", engine: "svg" } },
  solid: { css: "base,global", attrs: { effect: "solid" } },
};
/** 一格 = 两个场景（underline / tofu） */
const cell = (id, eff, n, mark, flip, extra = {}) => {
  const e = EFF[eff];
  const mk = (mode) => {
    const toks = [e.css, ...(mode === "tofu" ? ["tofu"] : []), ...(mark === "ex" ? ["ex"] : []), ...(mark === "ign" ? ["ign"] : [])].join(",");
    const attrs = { ...e.attrs, text: mode, ...(mark === "ex" ? {} : { _attrs: AUTO }) };
    return { name: `${id}|${mode === "tofu" ? "tofu" : "ul"}|${eff}|${mark}|${n}${extra.cpu ? "|cpu" + extra.cpu : ""}`, css: toks, n, attrs, probe: false, ...extra };
  };
  const pair = [mk("underline"), mk("tofu")];
  return flip ? pair.reverse() : pair;
};
const canary = (t) => [
  { name: `CAN-${t}-fade500`, css: "base", n: 500, attrs: { effect: "fade", _attrs: AUTO }, env: true },
  { name: `CAN-${t}-shimmer2000-ul`, css: "base,global", n: 2000, attrs: { effect: "shimmer", text: "underline", _attrs: AUTO }, env: true },
];
const wrap = (tag, list) => [...canary(`${tag}1`), ...list, ...canary(`${tag}2`)];
let k = 0;
const cells = (list) => list.flatMap(([eff, n, mark, extra]) => cell(`c${k}`, eff, n, mark, k++ % 2 === 1, extra));
const OUT = {
  K: canary("K"),
  // A：规模 × 效果，skz-auto 推导
  A: wrap("A", cells([500, 2000, 4000].flatMap((n) => ["pulse-g", "shim-g", "shim-svg", "solid"].map((e) => [e, n, "auto"])))),
  // B：显式 skz-text，2000 卡
  B: wrap("B", cells(["pulse-g", "shim-g", "shim-svg", "solid"].map((e) => [e, 2000, "ex"]))),
  // C：4× CPU 降速，2000 卡 shimmer / pulse global，auto + 显式
  C: wrap("C", cells([["shim-g", 2000, "auto", { cpu: 4 }], ["pulse-g", 2000, "auto", { cpu: 4 }], ["shim-g", 2000, "ex", { cpu: 4 }], ["pulse-g", 2000, "ex", { cpu: 4 }]])),
  // D：开启 / 关闭耗时（暖），shimmer global
  D: wrap("D", cells([500, 2000, 4000].map((n) => ["shim-g", n, "auto", { noTrace: true, toggle: true, toggleN: 9 }]).concat([["shim-g", 2000, "ex", { noTrace: true, toggle: true, toggleN: 9 }]]))),
  // E：含行内 skz-ignore，2000 卡 pulse global
  E: wrap("E", cells([["pulse-g", 2000, "ign"]])),
};
for (const [key, list] of Object.entries(OUT)) { fs.writeFileSync(new URL(`scenarios/sc-${key}.json`, HERE), JSON.stringify(list)); console.log(key, list.length); }
