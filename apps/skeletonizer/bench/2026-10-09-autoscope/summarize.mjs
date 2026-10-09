// 汇总 results/<轮>-<组>.log：每行一个场景 JSON。输出 markdown 表；多轮时对每个指标取中位数。
// 用法：node summarize.mjs r1 r2 ...
import fs from "node:fs";
const rounds = process.argv.slice(2);
const G = (process.env.GRP || "A B C D E").split(" ");
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
/** data[g][场景名去掉组前缀] = [每轮的对象] */
const data = {};
const errs = [];
for (const r of rounds) for (const g of G) {
  const f = `results/${r}-${g}.log`; if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(l); const key = o.name.slice(o.name.indexOf(" ") + 1);
    ((data[g] ??= {})[key] ??= []).push({ ...o, round: r });
  }
}
const keys = [...new Set(Object.values(data).flatMap((d) => Object.keys(d)))];
/** 防火墙失效的 enable 运行（样式重算 >= 15ms，正常为 2~8ms）：VALID=1 时在 enable 场景里剔除 */
const bad = (k, o) => k.includes("enable") && o.UpdateLayoutTree >= 15;
const pick = (g, k, m) => { const xs = (data[g]?.[k] || []).filter((o) => !(process.env.VALID && m !== "toggleMs" && bad(k, o))).map((o) => o[m]).filter((v) => v !== undefined); return xs.length ? med(xs) : NaN; };
const all = (g, k, m) => (data[g]?.[k] || []).map((o) => o[m]).join(" / ");
const fmt = (v, d = 1) => (Number.isNaN(v) ? "-" : v.toFixed(d));
for (const [m, title, d] of [["UpdateLayoutTree", "样式重算 ms/帧", 2], ["fps", "fps", 1], ["mainBusy", "mainBusy（仅参考）", 1], ["PrePaint", "PrePaint ms/帧", 2], ["Paint", "Paint ms/帧", 2], ["toggleMs", "开启耗时 ms", 1]]) {
  console.log(`\n### ${title}（${rounds.length} 轮中位数）\n\n| 场景 | ${G.join(" | ")} |\n|---|${G.map(() => "---").join("|")}|`);
  for (const k of keys) console.log(`| ${k} | ${G.map((g) => fmt(pick(g, k, m), d)).join(" | ")} |`);
}
if (process.env.VALID) {
  console.log("--- enable 场景防火墙失效次数（剔除的运行 / 总运行）---");
  for (const k of keys.filter((k) => k.includes("enable"))) console.log(`${k}: ` + G.map((g) => `${g} ${(data[g]?.[k] || []).filter((o) => bad(k, o)).length}/${(data[g]?.[k] || []).length}`).join("  "));
}
if (process.env.RAW) for (const k of keys) { console.log(`\n${k}`); for (const g of G) console.log(`  ${g}: recalc ${all(g, k, "UpdateLayoutTree")} | fps ${all(g, k, "fps")} | toggle ${all(g, k, "toggleMs")}`); }
