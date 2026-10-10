// 换行贴合度：真实字体 vs 方块字体（窄方块 0.50/0.52/0.55），多个容器宽，比行数与最后一行占比
import { launch } from "./lib.mjs"; import fs from "node:fs";
const c = await launch({ headless: true });
await c.goto("http://localhost:5198/bench/agents/a8-tofu-font/wrap.html", "window.ready===true");
const all = {};
for (const fam of ['system-ui, "Microsoft YaHei"', '"Segoe UI"', "Arial", '"Times New Roman"']) {
  const rows = await c.ev(`run(${JSON.stringify(fam)})`); all[fam] = rows;
  const hit = (n) => rows.filter((r) => r[n] === r.real).length;
  console.log(fam, "总", rows.length, "行数相同：N500", hit("N500"), "N520", hit("N520"), "N550", hit("N550"));
  console.log(" 行数差(方块-真实)分布 N550:", JSON.stringify(rows.reduce((a, r) => { const d = r.N550 - r.real; a[d] = (a[d] || 0) + 1; return a; }, {})), "N520:", JSON.stringify(rows.reduce((a, r) => { const d = r.N520 - r.real; a[d] = (a[d] || 0) + 1; return a; }, {})));
}
fs.writeFileSync("data/wrap.json", JSON.stringify(all, null, 1));
await c.close();
