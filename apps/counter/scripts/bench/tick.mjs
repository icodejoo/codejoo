// 纯 tick 吞吐（不含浏览器合成）：100 / 1000 / 10000 个任务，base 与 cur 交错 5 轮取中位数。
// 用法：node scripts/bench/tick.mjs
import { launch } from "./cdp.mjs";

const b = await launch(9455);
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const out = [];
for (const [kind, n] of [
  ["cd", 100],
  ["cd", 1000],
  ["cd", 10000],
  ["cu", 100],
  ["cu", 1000],
  ["cu", 10000],
]) {
  const acc = { base: [], cur: [] };
  for (let r = 0; r < 5; r++) {
    for (const v of r % 2 ? ["cur", "base"] : ["base", "cur"]) {
      await b.open({ v, s: "none", n });
      acc[v].push(await b.ev(`window.__runTick(${JSON.stringify(kind)})`));
    }
  }
  for (const v of ["base", "cur"]) out.push({ 类型: kind === "cd" ? "countdown(ms)" : "countup", 任务数: n, 构建: v, "ms/tick": +med(acc[v]).toFixed(4), "µs/任务": +((med(acc[v]) * 1000) / n).toFixed(3) });
}
console.table(out);
b.close();
process.exit(0);
