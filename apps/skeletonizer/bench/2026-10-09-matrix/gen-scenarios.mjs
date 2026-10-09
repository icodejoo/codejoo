// 生成全部场景文件到 scenarios/：node gen-scenarios.mjs
// 场景字段见 bench/kit/README.md；css 是 perf.html 的令牌（见 perf.html 顶部注释），attrs 数组 = 纯 CSS，对象 = 真实 enable()
import fs from "node:fs";
const OUT = new URL("./scenarios/", import.meta.url);
const SIZES = [500, 2000];
const sc = (id, desc, css, n, attrs, extra = {}) => ({ name: `${id} ${desc} @${n}`, css, n, attrs, toggle: true, toggleN: 7, snap: true, ...extra });
const both = (id, desc, css, attrs, extra) => SIZES.map((n) => sc(id, desc, css, n, attrs, extra));
const FX = ["pulse", "shimmer"];
const css = (e, more = []) => [["skz-effect", e], ...more];

// 每批前后各放一个金丝雀（同一场景测两次，衡量批内漂移）
const canary = (tag) => [sc(`CAN-${tag}a`, "fade enable", "base", 2000, { effect: "fade" }), sc(`CAN-${tag}b`, "shimmer 纯CSS", "base,globalcss", 500, css("shimmer"))];

const A = [
  ...both("A1", "fade", "base", { effect: "fade" }),
  ...both("A2", "solid", "base", { effect: "solid" }),
  ...both("A3", "sweep", "base,sweep", { effect: "sweep" }),
  ...FX.flatMap((e) => both(`A4${e[0]}`, `${e} global 纯CSS无JS`, "base,globalcss", css(e))),
  ...FX.flatMap((e) => both(`A5${e[0]}`, `${e} global+enable`, "base,global", { effect: e })),
  ...FX.flatMap((e) => both(`A6${e[0]}`, `${e} svg`, "base,svg", { effect: e, engine: "svg" })),
];
const B = [
  ...both("B0", "shimmer base+enable(global)", "base,global", { effect: "shimmer" }),
  ...both("B1", "shimmer explicit+enable(global)", "explicit,global", { effect: "shimmer" }),
  ...both("B2", "shimmer base 纯CSS", "base,globalcss", css("shimmer")),
  ...both("B3", "shimmer explicit 纯CSS", "explicit,globalcss", css("shimmer")),
  ...both("B4", "shimmer base svg", "base,svg", { effect: "shimmer", engine: "svg" }),
  ...both("B5", "shimmer explicit svg", "explicit,svg", { effect: "shimmer", engine: "svg" }),
];
const C = [
  ...both("C0", "shimmer underline global+enable", "base,global", { effect: "shimmer" }),
  ...both("C1", "shimmer leaf global+enable", "base,global", { effect: "shimmer", text: "leaf" }),
  ...both("C2", "shimmer leaf 纯CSS", "base,globalcss", css("shimmer", [["skz-text", "leaf"]])),
  ...both("C3", "shimmer leaf svg", "base,svg", { effect: "shimmer", text: "leaf", engine: "svg" }),
];
const FORM = "form";
const D = [
  ...both("D0", "表单 shimmer 纯CSS", `base,globalcss,${FORM}`, css("shimmer")),
  ...both("D1", "表单 shimmer global+enable 默认", `base,global,${FORM}`, { effect: "shimmer" }),
  ...both("D2", "表单 shimmer global+fps:auto", `base,global,${FORM}`, { effect: "shimmer", fps: "auto" }),
  ...both("D3", "表单 shimmer global+fps:24", `base,global,${FORM}`, { effect: "shimmer", fps: 24 }),
  ...both("D4", "表单 shimmer svg", `base,svg,${FORM}`, { effect: "shimmer", engine: "svg" }),
  ...both("D5", "表单 shimmer fps:auto 强制计时器(noio)", `base,global,${FORM},noio`, { effect: "shimmer", fps: "auto" }),
  ...both("D6", "表单 shimmer fps:24 强制计时器(noio)", `base,global,${FORM},noio`, { effect: "shimmer", fps: 24 }),
];
const E = [
  sc("E0", "shimmer global+enable", "base,global", 2000, { effect: "shimmer" }),
  sc("E1", "shimmer global+enable fit:true", "base,global", 2000, { effect: "shimmer", fit: true }),
  ...both("E2", "shimmer global+enable skz-cv", "base,global", { effect: "shimmer", _attrs: [["skz-cv", ""]] }),
  ...both("E3", "shimmer 纯CSS skz-cv", "base,globalcss", css("shimmer", [["skz-cv", ""]])),
  ...both("E4", "shimmer 纯CSS steps(36)", "base,globalcss", css("shimmer", [["--skz-shimmer-timing", "steps(36)"]])),
  ...both("E5", "shimmer 纯CSS(对照)", "base,globalcss", css("shimmer")),
  ...both("E6", "sweep 混合模式(对照)", "base,sweep", { effect: "sweep" }),
  ...both("E7", "sweep 容器色 skz-sweep=bg", "base,sweep", { effect: "sweep", _attrs: [["skz-sweep", "bg"]] }),
  ...both("E8", "sweep + fit:true（根被限高，光带可见）", "base,sweep", { effect: "sweep", fit: true }),
  sc("E9", "sweep（根高 <20000px，光带可见）", "base,sweep", 100, { effect: "sweep" }),
];
const S = [
  ["S1", "fade", "base", { effect: "fade", _scroll: true }],
  ["S2", "sweep", "base,sweep", { effect: "sweep", _scroll: true }],
  ["S3", "shimmer 纯CSS", "base,globalcss", [...css("shimmer"), ["_scroll", ""]]],
  ["S4", "shimmer global+enable", "base,global", { effect: "shimmer", _scroll: true }],
  ["S5", "shimmer svg", "base,svg", { effect: "shimmer", engine: "svg", _scroll: true }],
  ["S6", "shimmer explicit+enable", "explicit,global", { effect: "shimmer", _scroll: true }],
  ["S7", "shimmer global+enable fit:true", "base,global", { effect: "shimmer", fit: true, _scroll: true }],
  ["S8", "表单 shimmer global+enable 默认", `base,global,${FORM}`, { effect: "shimmer", _scroll: true }],
  ["S9", "表单 shimmer svg", `base,svg,${FORM}`, { effect: "shimmer", engine: "svg", _scroll: true }],
].map(([id, d, c, a]) => sc(id, `滚动 ${d}`, c, 2000, a, { toggle: false }));
const F = [
  sc("F1", "4x fade", "base", 2000, { effect: "fade" }, { cpu: 4 }),
  sc("F2", "4x sweep", "base,sweep", 2000, { effect: "sweep" }, { cpu: 4 }),
  sc("F3", "4x shimmer global+enable", "base,global", 2000, { effect: "shimmer" }, { cpu: 4 }),
  sc("F4", "4x shimmer svg", "base,svg", 2000, { effect: "shimmer", engine: "svg" }, { cpu: 4 }),
  sc("F5", "4x 表单 shimmer fps:auto", `base,global,${FORM}`, 2000, { effect: "shimmer", fps: "auto" }, { cpu: 4 }),
  sc("F5b", "4x 表单 shimmer fps:auto 强制计时器(noio)", `base,global,${FORM},noio`, 2000, { effect: "shimmer", fps: "auto" }, { cpu: 4 }),
  sc("F6", "4x shimmer global+enable fit:true", "base,global", 2000, { effect: "shimmer", fit: true }, { cpu: 4 }),
  sc("F7", "4x shimmer 纯CSS", "base,globalcss", 2000, css("shimmer"), { cpu: 4 }),
  sc("F8", "4x 表单 shimmer svg", `base,svg,${FORM}`, 2000, { effect: "shimmer", engine: "svg" }, { cpu: 4 }),
  sc("F9", "4x 表单 shimmer 默认(防火墙无效)", `base,global,${FORM}`, 2000, { effect: "shimmer" }, { cpu: 4 }),
  sc("F10", "4x shimmer global+enable", "base,global", 500, { effect: "shimmer" }, { cpu: 4 }),
  sc("F11", "4x shimmer svg", "base,svg", 500, { effect: "shimmer", engine: "svg" }, { cpu: 4 }),
];
const batches = { A, B, C, D, E, S, F };
fs.mkdirSync(OUT, { recursive: true });
for (const [k, list] of Object.entries(batches)) {
  const fwd = [...canary(`${k}1`), ...list, ...canary(`${k}2`)];
  // 反向一遍（交替顺序）：金丝雀仍在首尾
  const rev = [...canary(`${k}1`), ...[...list].reverse(), ...canary(`${k}2`)];
  fs.writeFileSync(new URL(`sc-${k}.json`, OUT), JSON.stringify(fwd));
  fs.writeFileSync(new URL(`sc-${k}-rev.json`, OUT), JSON.stringify(rev));
  console.log(k, list.length, "场景");
}
