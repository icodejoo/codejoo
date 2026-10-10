// 选择器匹配顺序实验：由"改后 dist"生成 x4 / x5 两个变体（只改 color 驱动挂载选择器的写法）。
//   x4  :where(:not([skz-text=clip]):not([skz-text=leaf])[skz-text])      把 [skz-text] 写在最后
//   x5  :where([skz-text]:not([skz-text=clip],[skz-text=leaf]))          两个 :not 合成一个带列表的 :not
// 用法：node make-variant2.mjs <改后 dist 目录> <输出目录前缀>
import fs from "node:fs";
import path from "node:path";
const [SRC, PREFIX] = process.argv.slice(2);
const MOUNT = ":where([skz-text]:not([skz-text=clip]):not([skz-text=leaf]))";
const VARIANTS = { x4: ":where(:not([skz-text=clip]):not([skz-text=leaf])[skz-text])", x5: ":where([skz-text]:not([skz-text=clip],[skz-text=leaf]))" };
const hit = {};
for (const [name, mount] of Object.entries(VARIANTS)) {
  const out = PREFIX + name;
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(SRC, out, { recursive: true });
  for (const f of ["base.css", "global.css", "all.css"]) {
    const p = path.join(out, f);
    if (!fs.existsSync(p)) continue;
    const css = fs.readFileSync(p, "utf8");
    hit[`${name}/${f}`] = css.split(MOUNT).length - 1;
    fs.writeFileSync(p, css.split(MOUNT).join(mount));
  }
}
console.log(JSON.stringify(hit));
