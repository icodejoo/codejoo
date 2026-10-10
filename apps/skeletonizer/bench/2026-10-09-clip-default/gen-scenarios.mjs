// 生成场景：默认（clip）vs text:"underline" 成对测。node gen-scenarios.mjs
// 每批首尾各放金丝雀（同一场景测两次，看批内漂移）
import fs from "node:fs";
const OUT = new URL("./scenarios/", import.meta.url);
const SIZES = [500, 2000];
const sc = (id, desc, css, n, attrs, extra = {}) => ({ name: `${id} ${desc} @${n}`, css, n, attrs, toggle: true, toggleN: 7, snap: true, ...extra });
// 每个场景生成 clip（默认，不写 text）与 ul（text:"underline"）两行，相邻放置
const pair = (id, desc, css, n, opts, extra) => [
  sc(`${id}-clip`, `${desc} 默认clip`, css, n, opts, extra),
  sc(`${id}-ul`, `${desc} underline`, css, n, { ...opts, text: "underline" }, extra),
];
const both = (id, desc, css, opts, extra) => SIZES.flatMap((n) => pair(id, desc, css, n, opts, extra));
const FORM = "form";
const canary = (t) => [sc(`CAN-${t}a`, "fade 默认", "base", 2000, { effect: "fade" }), sc(`CAN-${t}b`, "shimmer global+enable 默认", "base,global", 500, { effect: "shimmer" })];
const G = [
  ...both("G1", "fade", "base", { effect: "fade" }),
  ...both("G2", "solid", "base", { effect: "solid" }),
  ...both("G3", "shimmer global+enable", "base,global", { effect: "shimmer" }),
  ...both("G4", "shimmer svg", "base,svg", { effect: "shimmer", engine: "svg" }),
  ...both("G5", "pulse global+enable", "base,global", { effect: "pulse" }),
  ...both("G6", "表单 shimmer global+enable", `base,global,${FORM}`, { effect: "shimmer" }),
  ...both("G7", "表单 shimmer svg", `base,svg,${FORM}`, { effect: "shimmer", engine: "svg" }),
  ...both("G8", "sweep(浅)", "base,sweep", { effect: "sweep" }),
  ...pair("G9", "shimmer global+enable fit", "base,global", 2000, { effect: "shimmer", fit: true }),
];
// 深色 sweep：跑的时候设 PERF_SCHEME=dark
const GD = both("GD", "sweep(深)", "base,sweep", { effect: "sweep" });
// 4x CPU 降速
const F = [
  ...pair("F1", "4x shimmer global+enable", "base,global", 2000, { effect: "shimmer" }, { cpu: 4 }),
  ...pair("F2", "4x shimmer svg", "base,svg", 2000, { effect: "shimmer", engine: "svg" }, { cpu: 4 }),
  ...pair("F3", "4x fade", "base", 2000, { effect: "fade" }, { cpu: 4 }),
  ...pair("F4", "4x solid", "base", 2000, { effect: "solid" }, { cpu: 4 }),
];
fs.mkdirSync(OUT, { recursive: true });
for (const [k, list] of Object.entries({ G, GD, F })) {
  fs.writeFileSync(new URL(`sc-${k}.json`, OUT), JSON.stringify([...canary(`${k}1`), ...list, ...canary(`${k}2`)]));
  console.log(k, list.length);
}
