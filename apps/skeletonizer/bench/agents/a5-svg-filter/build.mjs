// 把 filters.inc.html 嵌进 *.src.html 的 <!--FILTERS--> 位置，输出同名 .html（perf.html / visual.html）
import fs from "node:fs";
const inc = fs.readFileSync(new URL("./filters.inc.html", import.meta.url), "utf8");
for (const n of ["perf", "visual"]) {
  const src = new URL(`./${n}.src.html`, import.meta.url);
  if (!fs.existsSync(src)) continue;
  const out = new URL(`./${n}.html`, import.meta.url);
  const next = fs.readFileSync(src, "utf8").replace("<!--FILTERS-->", inc);
  // 内容没变就不写：基准期间重写 perf.html 会让 vite 整页重载，打断 trace（v1 踩过）
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== next) fs.writeFileSync(out, next);
}
console.log("built");
