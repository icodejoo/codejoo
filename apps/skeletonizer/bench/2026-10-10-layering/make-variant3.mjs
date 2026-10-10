// 选择器匹配顺序实验：x6 = 把 color 驱动挂载的 :where(...) 写在复合选择器最前面（Blink 在复合选择器内从右往左匹配，这样便宜的 [skz] / [skz-effect] 先判，非根元素立刻失败）。
// 用法：node make-variant3.mjs <改后 dist 目录> <输出目录前缀>   → 产出 <前缀>x6
import fs from "node:fs";
import path from "node:path";
const [SRC, PREFIX] = process.argv.slice(2);
const M = ":where([skz-text]:not([skz-text=clip]):not([skz-text=leaf]))";
const PAIRS = [
  [`[skz]${M}{`, `${M}[skz]{`],
  [`[skz]:is([skz-effect=pulse],[skz-effect=shimmer])${M}{`, `${M}:is([skz-effect=pulse],[skz-effect=shimmer])[skz]{`],
  [`[skz][skz-effect=shimmer]${M}{`, `${M}[skz][skz-effect=shimmer]{`],
  [`[skz]:is([skz-effect=pulse],[skz-effect=shimmer])${M} [skz-fw]{`, `${M}:is([skz-effect=pulse],[skz-effect=shimmer])[skz] [skz-fw]{`],
];
const out = PREFIX + "x6";
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(SRC, out, { recursive: true });
const hit = {};
for (const f of ["base.css", "global.css", "all.css"]) {
  const p = path.join(out, f);
  if (!fs.existsSync(p)) continue;
  let css = fs.readFileSync(p, "utf8");
  for (const [a, b] of PAIRS) { hit[`${f} ${a.slice(0, 40)}`] = css.split(a).length - 1; css = css.split(a).join(b); }
  fs.writeFileSync(p, css);
}
console.log(JSON.stringify(hit, null, 1));
