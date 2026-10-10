// 第 4 项实验用：由"改后 dist"生成"派生变量只在骨头上计算"的实验版 dist（改写压缩后的 CSS 文本，不动 src）。
// 设想：根上只放原始变量（--skz-pulse-c 颜色、--skz-shimmer-p 光带位置），骨头自己由原始变量算出颜色 / 位置，防火墙只钉这两个原始变量。
// 改写规则（global 引擎、clip / underline / tofu 路径；svg 引擎不在这次实验里，不改它的规则）：
//   1. 根上不再声明派生变量：--skz-fill / --skz-bg-pos / --skz-ul-fill（含 iOS 分支、防火墙里的重声明）；
//   2. 骨头读 var(--skz-fill,var(--skz-color)) 的地方改读 var(--skz-pulse-c)；读 var(--skz-bg-pos,0 0) 的地方改成 calc(var(--skz-shimmer-p) * 1vw) 0；
//      装饰线 / 方块字读 var(--skz-ul-fill,var(--skz-color)) 的地方改读 var(--skz-pulse-c)；
//   3. 根上静态声明 --skz-pulse-c: var(--skz-color)（没有 pulse 动画时骨头读到的就是主题色；pulse 动画会覆盖它）。
// 已知代价（只做性能实验，不落地的话不必处理）：后代自己改了 --skz-color 不再生效（骨头读的是根上展开后的 --skz-pulse-c）；svg 引擎的静态覆盖失效。
// 用法：node make-derive.mjs <改后 dist 目录> <输出目录>
import fs from "node:fs";
import path from "node:path";

const [SRC, OUT] = process.argv.slice(2);
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

/** 压缩 CSS 里的字面片段替换（全部替换），并统计命中次数，没命中就报错，避免产物变了而实验悄悄失效 */
const stats = {};
const swap = (css, from, to, file) => {
  const n = css.split(from).length - 1;
  stats[`${file}: ${from}`] = n;
  return css.split(from).join(to);
};

for (const file of ["base.css", "global.css", "tofu.css", "all.css", "core.css", "explicit.css"]) {
  const p = path.join(OUT, file);
  if (!fs.existsSync(p)) continue;
  let css = fs.readFileSync(p, "utf8");
  // 1. 根上的派生声明去掉
  css = swap(css, "--skz-fill:var(--skz-pulse-c);", "", file);
  css = swap(css, "--skz-fill:var(--skz-pulse-c)}", "}", file);
  css = swap(css, "--skz-bg-pos:calc(var(--skz-shimmer-p) * 1vw) 0;", "", file);
  css = swap(css, "--skz-bg-pos:calc(var(--skz-shimmer-p) * 1vw) 0}", "}", file);
  css = swap(css, "--skz-ul-fill:var(--skz-pulse-c);", "", file);
  css = swap(css, "--skz-ul-fill:var(--skz-pulse-c)}", "}", file);
  // 2. 骨头由原始变量算
  css = swap(css, "var(--skz-fill,var(--skz-color))", "var(--skz-pulse-c)", file);
  css = swap(css, "var(--skz-bg-pos,0 0)", "calc(var(--skz-shimmer-p) * 1vw) 0", file);
  css = swap(css, "var(--skz-ul-fill,var(--skz-color))", "var(--skz-pulse-c)", file);
  // 3. 根上静态声明 --skz-pulse-c（放在主题变量之后：加在文件最前面也行，--skz-color 是继承来的 / 同一元素上的声明，读取时才解析）
  if (file !== "global.css") css = "[skz]{--skz-pulse-c:var(--skz-color)}" + css;
  fs.writeFileSync(p, css);
}
console.log(JSON.stringify(stats, null, 1));
