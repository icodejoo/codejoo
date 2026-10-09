// 实验 3：CSS 体积对比（sass compressed 产物上增删 SVG 声明；仅作量级对比）
import fs from "node:fs";
import zlib from "node:zlib";
import * as S from "./svgs.mjs";
const base = fs.readFileSync("base.min.css", "utf8");
const stripped = base.replace(/\s*--x-ske-svg-(?:shimmer|pulse): *url\("data:[^"]*"\);?/g, "");
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length, br = (s) => zlib.brotliCompressSync(s).length;
const pulse = (a, dur) => `<svg ${S.NS} viewBox='0 0 10 10' preserveAspectRatio='none'><rect width='10' height='10' fill='#fff' opacity='0'><animate attributeName='opacity' values='0;${a};0' dur='${dur}' calcMode='spline' keySplines='.42 0 .58 1;.42 0 .58 1' repeatCount='indefinite'/></rect></svg>`;
const u = (svg) => S.uri(svg, "safe");
const DARK = (body, sel = "[x-ske]") => `@media (prefers-color-scheme:dark){:root:not([data-x-ske-theme=light]) ${sel}{${body}}}:root[data-x-ske-theme=dark] ${sel}{${body}}`;
const out = {};
const rep = (name, css) => { out[name] = { bytes: Buffer.byteLength(css), gz: gz(css), br: br(css) }; };
rep("A0 去掉所有 SVG 声明（参考下限）", stripped);
// A 现状：浅/深 × shimmer/pulse，深色写两遍
rep("A 现状 4 张（浅+深，深色出现两次）", stripped + `[x-ske]{--x-ske-svg-shimmer:${u(S.curShimmer(0.55))};--x-ske-svg-pulse:${u(pulse(0.55, "3s"))}}` + DARK(`--x-ske-svg-shimmer:${u(S.curShimmer(0.1))};--x-ske-svg-pulse:${u(pulse(0.1, "3s"))}`));
// B 通用 2 张（1.5s），无主题分支
const sh = (d) => u(S.band2g(d)), pu = (d) => u(pulse(0.5, d));
rep("B 通用 2 张（只有 1.5s）", stripped + `[x-ske]{--x-ske-svg-shimmer:${sh("1.5s")};--x-ske-svg-pulse:${pu("3s")}}`);
// C 通用 × 3 档时长（1s/1.5s/2s）：默认 1.5s，其余按根属性 x-ske-speed 切换
const speeds = [["fast", "1s", "2s"], ["slow", "2s", "4s"]];
rep("C 通用 × 3 档时长（6 张）", stripped + `[x-ske]{--x-ske-svg-shimmer:${sh("1.5s")};--x-ske-svg-pulse:${pu("3s")}}` + speeds.map(([k, d, p]) => `[x-ske][x-ske-speed=${k}]{--x-ske-svg-shimmer:${sh(d)};--x-ske-svg-pulse:${pu(p)}}`).join(""));
// D 主题化 × 3 档（12 张，深色各写两遍）
const th = (a, d, p) => [`--x-ske-svg-shimmer:${u(S.band2a(a, d))};--x-ske-svg-pulse:${u(pulse(a, p))}`];
let d = stripped;
for (const [sel, dd, pp] of [["[x-ske]", "1.5s", "3s"], ["[x-ske][x-ske-speed=fast]", "1s", "2s"], ["[x-ske][x-ske-speed=slow]", "2s", "4s"]]) d += `${sel}{${th(0.55, dd, pp)}}` + DARK(th(0.1, dd, pp), sel);
rep("D 主题化 × 3 档时长（12 张，深色两次）", d);
// E 单 SVG 内含 3 档时长，用 #片段 选（只算体积；需 <view>/:target 才能选中，Chrome 对 data URI 片段支持见实验 4）
console.log(JSON.stringify(out, null, 1));
