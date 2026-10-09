// 生成性能变体 CSS（base.css + 追加覆盖规则）与场景文件 sc-all.json
import fs from "node:fs";
import * as S from "./svgs.mjs";
const base = fs.readFileSync("base.css", "utf8");
const SEL = `[x-ske][x-ske-engine="svg"][x-ske-effect="shimmer"]`;
const hl = "var(--x-ske-highlight)";
const V = {}; // name -> decl string
const white = (name, svg, blend = "soft-light", extra = "") => (V[name] = `--x-ske-bg-img:${S.uri(svg, "short")};--x-ske-bg-blend:${blend};${extra}`);
// 实验 1
V["p-1b-normal"] = `--x-ske-fill:${hl};--x-ske-bg-img:${S.uri(S.dip(0.074), "short")};--x-ske-bg-blend:normal`;
V["p-1b-multiply"] = `--x-ske-fill:${hl};--x-ske-bg-img:${S.uri(S.dip(0.074), "short")};--x-ske-bg-blend:multiply`;
V["p-1b-luminosity"] = `--x-ske-fill:${hl};--x-ske-bg-img:${S.uri(S.dip(0.074), "short")};--x-ske-bg-blend:luminosity`;
for (const bm of ["soft-light", "overlay", "screen"]) white(`p-1c-${bm}`, S.band2a(0.5), bm);
white("p-1c-normal", S.band2a(0.5), "normal");
// 实验 2（配色统一用 soft-light）
white("p-2a", S.band2a(0.5));
white("p-2b1", S.band2b1(0.5));
white("p-2b2", S.band2b2(0.5));
white("p-2c", S.band2c(0.5));
white("p-2e", S.band2e(0.5));
white("p-2d", S.band2d(0.5));
white("p-2a-scroll", S.band2a(0.5), "soft-light", "--x-ske-bg-att:scroll;--x-ske-bg-size:100% 100%;");
fs.writeFileSync("variants.json", JSON.stringify(Object.fromEntries(Object.entries(V).map(([k, v]) => [k, v.length]))));
for (const [k, d] of Object.entries(V)) fs.writeFileSync(`${k}.css`, `${base}\n${SEL}{${d}}\n`);
const A = [["x-ske-effect", "shimmer"], ["x-ske-text", "leaf"], ["x-ske-engine", "svg"]];
const sc = (name, css, extra = {}) => ({ name, css, n: 2000, attrs: A, ...extra });
const list = [
  { name: "ref css-driven shimmer leaf", css: "prod", n: 2000, attrs: [["x-ske-effect", "shimmer"], ["x-ske-text", "leaf"]] },
  sc("base(current data URI)", "base"),
  sc("prod(dist) ", "prod"),
  ...Object.keys(V).map((k) => sc(k, k)),
  ...["e4-sprite", "e4-svgview", "e4-svgview-par", "e4-dataview", "e4-dataview-short", "e4-b64"].map((k) => sc(k, k)),
  sc("e5-blob", "base", { js: ["blob", 0] }),
  sc("base(current data URI) again", "base"),
];
fs.writeFileSync("sc-all.json", JSON.stringify(list, null, 1));
console.log(list.length, "scenarios");
