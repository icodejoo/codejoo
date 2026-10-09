// 构建 demo 静态站：先 vite 打包 demo/index.html，再把样式分片从 scss 编成 css 放进 demo-dist/styles/
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stylesSrc = path.join(root, "src/styles");
const stylesOut = path.join(root, "demo-dist/styles");

/** 从 demo/main.js 里读 CSS_FILES，保证和页面实际加载的分片一致，不再手抄一份 */
function readCssFiles() {
  const html = fs.readFileSync(path.join(root, "demo/main.js"), "utf8");
  const m = html.match(/const CSS_FILES = \[([^\]]*)\]/);
  if (!m) throw new Error("demo/main.js 里没找到 CSS_FILES");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

console.log("[build-demo] vite build");
// 走 vite-plus 的 vp（本包已有依赖），避免 npx 临时下载
const bin = path.join(root, "node_modules/.bin", process.platform === "win32" ? "vp.CMD" : "vp");
execSync(`"${fs.existsSync(bin) ? bin : "vp"}" build -c vite.demo.config.ts`, { cwd: root, stdio: "inherit" });

console.log("[build-demo] scss -> css");
fs.mkdirSync(stylesOut, { recursive: true });
for (const f of readCssFiles()) {
  const { css } = sass.compile(path.join(stylesSrc, `${f}.scss`), { sourceMap: false });
  fs.writeFileSync(path.join(stylesOut, `${f}.css`), css);
  console.log(`  ${f}.css (${css.length} B)`);
}
console.log("[build-demo] done");
