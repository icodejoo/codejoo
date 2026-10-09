// 实验 4：生成 sprite.svg（4 个 <view>，区域间隔 300 单位）及各写法的 CSS 变体
import fs from "node:fs";
import { uri, curShimmer } from "./svgs.mjs";
const NS = "xmlns='http://www.w3.org/2000/svg'";
const pulse = (peak) => `<rect width='10' height='10' fill='#fff' opacity='0'><animate attributeName='opacity' values='0;${peak};0' dur='3s' calcMode='spline' keySplines='.42 0 .58 1;.42 0 .58 1' repeatCount='indefinite'/></rect>`;
const defs = (id, a) => `<linearGradient id='${id}'><stop stop-color='#fff' stop-opacity='0'/><stop offset='.5' stop-color='#fff' stop-opacity='${a}'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>`;
const shim = (ox, g) => `<rect x='${ox}' width='60' height='100' fill='url(#${g})'><animateTransform attributeName='transform' type='translate' from='-60 0' to='110 0' dur='1.5s' repeatCount='indefinite'/></rect>`;
const pul = (ox, peak) => `<g transform='translate(${ox})'><svg width='100' height='100' viewBox='0 0 10 10' preserveAspectRatio='none' overflow='hidden'>${pulse(peak)}</svg></g>`;
// 区域 k 的原点 ox=k*300；shimmer 的 rect 位于区域内，animateTransform 平移 -60→110，不会碰到邻区（间隔 300）
const sprite = `<svg ${NS} width='1200' height='100'><defs>${defs("gl", 0.55)}${defs("gd", 0.1)}</defs>
<view id='shimmer-light' viewBox='0 0 100 100' preserveAspectRatio='none'/>
<view id='shimmer-dark' viewBox='300 0 100 100' preserveAspectRatio='none'/>
<view id='pulse-light' viewBox='600 0 100 100' preserveAspectRatio='none'/>
<view id='pulse-dark' viewBox='900 0 100 100' preserveAspectRatio='none'/>
<g>${shim(0, "gl")}</g><g transform='translate(300)'>${shim(0, "gd")}</g>
${pul(600, 0.55)}${pul(900, 0.1)}
</svg>`;
fs.writeFileSync("sprite.svg", sprite);
const compact = sprite.replace(/\n/g, "");
fs.writeFileSync("sprite.min.svg", compact);
console.log("sprite bytes", Buffer.byteLength(sprite));
