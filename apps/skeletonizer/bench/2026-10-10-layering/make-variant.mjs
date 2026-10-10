// 选择器匹配开销实验：由"改后 dist"生成 x1 / x2 / x3 三个变体（改写压缩后的 CSS 文本，不动 src）。
//   x1  clip 填充规则从 :is(根A, 根B) :is(标签…)… 改成两条独立复合选择器的选择器列表（根A 标签…, 根B 标签…）
//   x2  color 驱动的挂载选择器从"有 skz-text 且不是 clip / leaf"的排除式改回显式枚举 :where([skz-text=underline],[skz-text=tofu])
//   x3  x1 + x2
// 用法：node make-variant.mjs <改后 dist 目录> <输出目录前缀>   → 产出 <前缀>x1 / x2 / x3
import fs from "node:fs";
import path from "node:path";
const [SRC, PREFIX] = process.argv.slice(2);
const ROOTS = ":is([skz]:not([skz-text]),[skz][skz-text=clip]) ";
const MOUNT = ":where([skz-text]:not([skz-text=clip]):not([skz-text=leaf]))";
const OLD_MOUNT = ":where([skz-text=underline],[skz-text=tofu])";
const hit = {};
const apply = (css, kind, file) => {
  if (kind.includes("1")) {
    // 找到 clip 填充规则：以 ROOTS 开头、到下一个 { 为止
    let i = css.indexOf(ROOTS);
    while (i >= 0) {
      const j = css.indexOf("{", i);
      const rest = css.slice(i + ROOTS.length, j);
      css = css.slice(0, i) + `[skz]:not([skz-text]) ${rest},[skz][skz-text=clip] ${rest}` + css.slice(j);
      hit[`${file} x1`] = (hit[`${file} x1`] || 0) + 1;
      i = css.indexOf(ROOTS, i + 10);
    }
  }
  if (kind.includes("2")) {
    const n = css.split(MOUNT).length - 1;
    hit[`${file} x2`] = n;
    css = css.split(MOUNT).join(OLD_MOUNT);
  }
  return css;
};
for (const [name, kind] of [["x1", "1"], ["x2", "2"], ["x3", "12"]]) {
  const out = PREFIX + name;
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(SRC, out, { recursive: true });
  for (const f of ["base.css", "global.css", "all.css"]) {
    const p = path.join(out, f);
    if (fs.existsSync(p)) fs.writeFileSync(p, apply(fs.readFileSync(p, "utf8"), kind, `${name}/${f}`));
  }
}
console.log(JSON.stringify(hit));
