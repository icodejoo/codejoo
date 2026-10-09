// 实验 4：CSS 体积（sass compressed 产物上替换 6 处 SVG 声明；另给出外部 sprite.svg 本身体积）
import fs from "node:fs";
import zlib from "node:zlib";
import { uri } from "./svgs.mjs";
const base = fs.readFileSync("base.min.css", "utf8");
const sprite = fs.readFileSync("sprite.min.svg", "utf8");
const names = ["shimmer-light", "pulse-light", "shimmer-dark", "pulse-dark", "shimmer-dark", "pulse-dark"];
const vb = { "shimmer-light": "0,0,100,100", "shimmer-dark": "300,0,100,100", "pulse-light": "600,0,100,100", "pulse-dark": "900,0,100,100" };
const re = /(--x-ske-svg-(?:shimmer|pulse): *)url\("data:[^"]*"\)/g;
const F = {
  "现状 data URI": null,
  "4.1 外部 sprite.svg#view": (n) => `url("sprite.svg#${n}")`,
  "4.2 外部 sprite.svg#svgView": (n) => `url("sprite.svg#svgView(viewBox(${vb[n]}))")`,
  "4.2b 外部 svgView+pAR": (n) => `url("sprite.svg#svgView(viewBox(${vb[n]});preserveAspectRatio(none))")`,
  "4.3/4.5 data URI 精灵(<>#编码)+#片段": (n) => uri(sprite).replace(/"\)$/, `#${n}")`),
  "4.3 data URI 精灵(只转#)+#片段": (n) => uri(sprite, "short").replace(/"\)$/, `#${n}")`),
  "4.4 base64 精灵+#片段": (n) => `url("data:image/svg+xml;base64,${Buffer.from(sprite).toString("base64")}#${n}")`,
};
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length, br = (s) => zlib.brotliCompressSync(s).length;
const out = {};
for (const [k, f] of Object.entries(F)) { let i = 0; const css = f ? base.replace(re, (_, p) => `${p}${f(names[i++])}`) : base; out[k] = { bytes: Buffer.byteLength(css), gz: gz(css), br: br(css) }; }
out["sprite.svg 外部文件本身"] = { bytes: Buffer.byteLength(sprite), gz: gz(sprite), br: br(sprite) };
console.log(JSON.stringify(out, null, 1));
