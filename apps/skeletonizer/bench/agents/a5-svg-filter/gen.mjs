// 生成滤镜 SVG：filters.inc.html（内联片段）+ filter-<变体>.svg（独立文件，便于单独查看）。
// 用法：node gen.mjs ；再由 build.mjs 把片段嵌进 perf.html / visual.html。
import fs from "node:fs";

/** 主题参数：ink 的 alpha 行与骨头色 */
const THEMES = {
  light: { row: "-0.6378 -2.1456 -0.2166 0 2.4", color: "#d9dde3" },
  dark: { row: "0.6378 2.1456 0.2166 0 -0.6", color: "#374151" },
};
/** 膨胀半径档位：id 后缀 -> radius 属性 */
const RADII = { "": "4 3", r22: "2 2", r64: "6 4" };

/** 生成一个滤镜。variant: A 只出骨头；B 骨头叠原背景；C 加高斯模糊再二值化（圆角） */
function filter(theme, variant, rKey) {
  const t = THEMES[theme];
  const id = ["x-ske-f", theme, variant === "A" ? "" : variant, rKey].filter(Boolean).join("-");
  const radius = RADII[rKey];
  const round =
    variant === "C"
      ? `
  <feGaussianBlur in="grown" stdDeviation="2" result="blur"/>
  <feComponentTransfer in="blur" result="grown2"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>`
      : "";
  const g = variant === "C" ? "grown2" : "grown";
  const tail =
    variant === "B"
      ? `
  <feFlood flood-color="${t.color}" result="c"/>
  <feComposite in="c" in2="${g}" operator="in" result="bone"/>
  <feComposite in="SourceGraphic" in2="${g}" operator="out" result="base"/>
  <feMerge><feMergeNode in="base"/><feMergeNode in="bone"/></feMerge>`
      : `
  <feFlood flood-color="${t.color}" result="c"/>
  <feComposite in="c" in2="${g}" operator="in"/>`;
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
  <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${t.row}" result="ink"/>
  <feComposite in="ink" in2="SourceAlpha" operator="in" result="inkA"/>
  <feComponentTransfer in="inkA" result="bin"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
  <feMorphology in="bin" operator="dilate" radius="${radius}" result="grown"/>${round}${tail}
</filter>`;
}

const combos = [["A", ""], ["A", "r22"], ["A", "r64"], ["B", ""], ["C", ""]];
let inc = "";
for (const theme of ["light", "dark"]) {
  for (const [v, r] of combos) {
    const f = filter(theme, v, r);
    inc += f + "\n";
    const name = `filter-${theme}-${v}${r ? "-" + r : ""}.svg`;
    fs.writeFileSync(new URL("./" + name, import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">\n${f}\n</svg>\n`);
  }
}
fs.writeFileSync(new URL("./filters.inc.html", import.meta.url), `<svg width="0" height="0" style="position:absolute" aria-hidden="true">\n${inc}</svg>`);
console.log("ok");
