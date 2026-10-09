import fs from "node:fs";
import zlib from "node:zlib";
import { uri } from "./svgs.mjs";
const base = fs.readFileSync("base.css", "utf8");
const sprite = fs.readFileSync("sprite.min.svg", "utf8");
const names = ["shimmer-light", "pulse-light", "shimmer-dark", "pulse-dark", "shimmer-dark", "pulse-dark"];
const vb = { "shimmer-light": "0,0,100,100", "shimmer-dark": "300,0,100,100", "pulse-light": "600,0,100,100", "pulse-dark": "900,0,100,100" };
const variants = {
  "e4-sprite": (n) => `url("sprite.svg#${n}")`,
  "e4-svgview": (n) => `url("sprite.svg#svgView(viewBox(${vb[n]}))")`,
  "e4-svgview-par": (n) => `url("sprite.svg#svgView(viewBox(${vb[n]});preserveAspectRatio(none))")`,
  "e4-dataview": (n) => uri(sprite).replace(/"\)$/, `#${n}")`),
  "e4-b64": (n) => `url("data:image/svg+xml;base64,${Buffer.from(sprite).toString("base64")}#${n}")`,
  "e4-dataview-short": (n) => uri(sprite, "short").replace(/"\)$/, `#${n}")`),
};
const re = /(--x-ske-svg-(?:shimmer|pulse): )url\("data:[^"]*"\)/g;
const stat = {};
const gz = (s) => zlib.gzipSync(s, { level: 9 }).length;
stat["base"] = { css: Buffer.byteLength(base), gz: gz(base) };
for (const [v, f] of Object.entries(variants)) {
  let i = 0;
  const out = base.replace(re, (_, p) => `${p}${f(names[i++])}`);
  if (i !== 6) throw new Error("replace count " + i);
  fs.writeFileSync(`${v}.css`, out);
  stat[v] = { css: Buffer.byteLength(out), gz: gz(out) };
}
console.log(JSON.stringify(stat, null, 1));
