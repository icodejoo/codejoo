// 生成 tofu.css（字体 data URI + 规则）。用法：node mkcss.mjs [字体文件 默认 fonts/v90-both.woff2] [输出 默认 ../tofu.css]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const D = path.dirname(fileURLToPath(import.meta.url)), A = path.join(D, "..");
const font = process.argv[2] || path.join(A, "fonts/v90-both.woff2");
const b64 = fs.readFileSync(font).toString("base64");
const TAGS = "p,span,h1,h2,h3,h4,h5,h6,a,li,label,td,th,strong,b,em,small,dt,dd,blockquote,figcaption";
const face = (src) => `/* a8 原型：全方块字体（tofu）。叠在 dist/base.css(+global/svg) 之后，根上写 skz-text="tofu" 生效。 */
@font-face{font-family:"Skz Tofu";font-display:block;font-style:normal;font-weight:100 900;src:${src}}\n`;
const GUARD = ":not([skz-ignore]):not([skz-bone]):not([skz-leaf]):not([skz-leaf] *):not([skz-ignore] *)";
const rules = (sel) => `
/* 1) 根上撤掉 clip / underline 的文字填充（背景色退场；装饰线本身在文字元素上关掉） */
[skz][skz-text="tofu"]:not([skz-ignore]){--skz-tbg:transparent;--skz-timg:none;--skz-tradius:0px}
/* 2) 文字元素：方块字体 + 纯色（--skz-ul-fill：pulse/shimmer 由根驱动，svg 引擎下是静态 --skz-color） */
${sel}{
  font-family:"Skz Tofu"!important;
  color:var(--skz-ul-fill,var(--skz-color))!important;
  -webkit-text-fill-color:currentColor!important;
  text-decoration:none!important;
  background-image:none!important;
  -webkit-background-clip:border-box!important;background-clip:border-box!important;
  letter-spacing:0!important;word-spacing:0!important;
  font-kerning:none!important;font-variant-ligatures:none!important;font-synthesis:none!important;
  font-feature-settings:normal!important;text-rendering:optimizeSpeed!important;
  -webkit-text-stroke:0!important;text-shadow:none!important;
}
`;
const SA = `[skz][skz-text="tofu"] :is(${TAGS})${GUARD}`;
// ALL 变体：所有非忽略后代（除表单/媒体控件）都套字体，裸 div 文字也变方块
const ALL = `[skz][skz-text="tofu"] :not(img,video,canvas,picture,iframe,svg,svg *,input,textarea,select,i:empty,[class*="icon"]:empty)${GUARD}`;

const out = (n, s) => fs.writeFileSync(path.join(A, n), s);
const uri = `url(data:font/woff2;base64,${b64}) format("woff2")`;
out("tofu.css", face(uri) + rules(SA));
out("tofuall.css", face(uri) + rules(ALL));
// 失败降级测试：字体 URL 故意写坏
out("tofu-broken.css", face(`url(/nope/missing.woff2) format("woff2")`) + rules(SA));
console.log("tofu.css", fs.statSync(path.join(A, "tofu.css")).size, "bytes; font b64", b64.length);
