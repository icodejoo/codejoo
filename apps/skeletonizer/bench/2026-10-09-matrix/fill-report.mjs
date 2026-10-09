// 把 results/summary-pivot.md 里各批的表填进报告占位符（{{A}} 等）。用法：node fill-report.mjs
import fs from "node:fs";
const piv = fs.readFileSync(new URL("./results/summary-pivot.md", import.meta.url), "utf8");
const parts = {}; let cur = null;
for (const l of piv.split("\n")) { const m = l.match(/^#### (\w)$/); if (m) { cur = m[1]; parts[cur] = []; continue; } if (l.startsWith("金丝雀")) { cur = null; continue; } if (cur && l.trim()) parts[cur].push(l); }
const f = new URL("../../docs/reports/2026-10-09-benchmark-matrix.md", import.meta.url);
let t = fs.readFileSync(f, "utf8");
for (const k of Object.keys(parts)) t = t.replace(`{{${k}}}`, parts[k].join("\n"));
fs.writeFileSync(f, t);
console.log(/\{\{/.test(t) ? "仍有占位符" : "ok");
