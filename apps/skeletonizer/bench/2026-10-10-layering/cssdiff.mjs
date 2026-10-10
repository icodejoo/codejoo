// 逐规则对比两份 CSS：去注释、拆成 (上下文, 单个选择器, 单条声明) 三元组的集合，列出只在一边出现的项。
// 合并 / 拆分规则（a,b{x} 与 a{x} b{x}）、声明顺序不同都不会产生差异；规则的先后顺序（层叠）另由计算样式对比覆盖。
// 用法：node cssdiff.mjs <before.css> <after.css> [--json]
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("E:/workspaces/codejoo/node_modules/.pnpm/postcss@8.5.16/node_modules/");
const postcss = require("postcss");
const normSel = (s) => s.replace(/\s+/g, " ").replace(/\s*([,>+~])\s*/g, "$1").trim();
const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*([,>+~()])\s*/g, "$1").replace(/;$/, "").trim();
/** 把一份 CSS 展开成三元组集合（key -> 出现次数） */
export function triples(css) {
  const out = new Map();
  const root = postcss.parse(css);
  const walk = (node, ctx) => {
    node.each((n) => {
      if (n.type === "atrule") {
        if (n.nodes) walk(n, ctx + `@${n.name} ${norm(n.params)} > `);
        else out.set(`${ctx}@${n.name} ${norm(n.params)}`, 1);
      } else if (n.type === "rule") {
        const sels = n.selectors.map(normSel);
        n.each((d) => {
          if (d.type !== "decl") return;
          for (const s of sels) { const k = `${ctx}${s} { ${d.prop.toLowerCase()}: ${norm(d.value)}${d.important ? " !important" : ""} }`; out.set(k, (out.get(k) || 0) + 1); }
        });
      } else if (n.type === "decl" && node.type === "atrule") {
        // @property / @font-face 内部的声明
        const k = `${ctx}{ ${n.prop}: ${norm(n.value)} }`; out.set(k, (out.get(k) || 0) + 1);
      }
    });
  };
  walk(root, "");
  return out;
}
if (process.argv[1] && process.argv[1].endsWith("cssdiff.mjs")) {
  const [a, b] = process.argv.slice(2);
  const A = triples(fs.readFileSync(a, "utf8")), B = triples(fs.readFileSync(b, "utf8"));
  const onlyA = [...A.keys()].filter((k) => !B.has(k)), onlyB = [...B.keys()].filter((k) => !A.has(k));
  if (process.argv.includes("--json")) console.log(JSON.stringify({ removed: onlyA, added: onlyB }, null, 1));
  else { console.log(`== 改前 ${A.size} 项，改后 ${B.size} 项；只在改前 ${onlyA.length}，只在改后 ${onlyB.length}`); for (const k of onlyA) console.log("- " + k); for (const k of onlyB) console.log("+ " + k); }
}
