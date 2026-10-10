// 把 frames/<变体>/ 的 screencast 帧拼成"时间瀑布图"：每行 = 一个 1/60 秒时刻、该时刻屏幕上最新的一帧里第 1 张卡片的段落条（放大对比度；从光带进入条内起取 700ms）。
// 光带每动一次，瀑布里就出现一次错位；停留越久，同一形状的行越多。输出 frames/waterfall-<变体>.png 与 waterfall-all.png（lin / s36 / s18 自上而下）。
// 用法：node waterfall.mjs（需要 PATH 里有 ffmpeg）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "frames");
const TICK = 1000 / 60, SPAN = 700, ROW_H = 8; // 从光带进入条内的那一帧起取 700ms，每 16.7ms 一行，每行 8px 高
const analysis = JSON.parse(fs.readFileSync(path.join(DIR, "analysis.json"), "utf8")); // 先跑 analyze-frames.mjs
const LUT = "lutrgb=r='clip((val-208)*9,0,255)':g='clip((val-208)*9,0,255)':b='clip((val-208)*9,0,255)'";
const names = ["lin", "s36", "s18"];
for (const v of names) {
  const man = JSON.parse(fs.readFileSync(path.join(DIR, v, "manifest.json"), "utf8"));
  const list = [];
  const first = analysis[v].centroids.findIndex((c) => c != null), T0 = man[Math.max(0, first - 1)];
  for (let t = T0; t < T0 + SPAN; t += TICK) { let k = 0; while (k + 1 < man.length && man[k + 1] <= t) k++; list.push(`file '${path.join(DIR, v, `f${String(k).padStart(3, "0")}.jpg`).split(path.sep).join("/")}'\nduration 1`); }
  const txt = path.join(DIR, `${v}.concat.txt`); fs.writeFileSync(txt, list.join("\n") + "\n");
  const n = list.length;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", txt, "-vf", `crop=1200:8:0:77,${LUT},scale=1200:${ROW_H}:flags=neighbor,tile=1x${n}`, "-frames:v", "1", path.join(DIR, `waterfall-${v}.png`)]);
  fs.rmSync(txt);
}
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...names.flatMap((v) => ["-i", path.join(DIR, `waterfall-${v}.png`)]), "-filter_complex", "[0][1][2]vstack=inputs=3", path.join(DIR, "waterfall-all.png")]);
console.log("ok");
