// 生成场景文件 sc-<组>.json。组与页面参数的对应见 NOTES.md。
// 用法：node gen-scenarios.mjs
import fs from "node:fs";
/** 组 -> trace.mjs 的 css 字段（直接拼进 URL，所以能带 &mode=） */
const GROUPS = { A: "auto&mode=auto", B: "scoped&mode=mark", C: "scoped&mode=autoroot", D: "explicit&mode=mark", E: "scoped&mode=mix",
  // 诊断组：B2 = split 版标记区；B3 = class 版标记区；C2 = split 版全自动；E2 = split 版混合
  B2: "split&mode=mark", B3: "class&mode=mark", C2: "split&mode=autoroot", E2: "split&mode=mix" };
/** 系列：L = 叶子文字模式（和 entries 实验一致，root 上 skz-text=leaf）；U = 默认下划线模式 */
const SERIES = { L: [["skz-text", "leaf"]], U: [] };
const N = 2000, TOGGLE_N = 7;
for (const [g, css] of Object.entries(GROUPS)) {
  const sc = [];
  for (const [s, base] of Object.entries(SERIES)) {
    for (const eff of ["fade", "pulse", "shimmer"]) {
      const attrs = eff === "fade" ? [...base] : [["skz-effect", eff], ...base];
      sc.push({ name: `${g} ${s} 纯CSS ${eff}`, css, n: N, attrs, toggle: true, toggleN: TOGGLE_N });
    }
    const text = s === "L" ? { text: "leaf" } : {};
    sc.push({ name: `${g} ${s} enable shimmer（防火墙）`, css, n: N, attrs: { effect: "shimmer", ...text }, toggle: true, toggleN: TOGGLE_N });
  }
  fs.writeFileSync(`sc-${g}.json`, JSON.stringify(sc, null, 1));
}
