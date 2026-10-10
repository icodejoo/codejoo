// 从 screencast 帧里直接量光带位置：取第 1 张卡片段落条中间一行像素（y=81，x 70~780），
// 光带是比底色更亮的一块，用"超出底色的亮度质心"作为光带中心的 x（px）。
// 输出 frames/analysis.json 与终端汇总：每个变体 画面实际变化次数 / 秒、相邻不同画面的光带中心位移（px）、停留时长（ms）。
// 用法：node analyze-frames.mjs [变体目录名…]（默认 lin s36 s18；svg-* 的结果写 analysis-svg.json；需要 PATH 里有 ffmpeg）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "frames");
const W = 1200, X0 = 70, X1 = 780, Y = 81;
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = {};
const NAMES = process.argv.slice(2).length ? process.argv.slice(2) : ["lin", "s36", "s18"];
const RESULT = path.join(DIR, NAMES[0].startsWith("svg") ? "analysis-svg.json" : "analysis.json");
for (const v of NAMES) {
  const man = JSON.parse(fs.readFileSync(path.join(DIR, v, "manifest.json"), "utf8"));
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path.join(DIR, v, "f%03d.jpg"), "-vf", `format=gray,crop=${W}:1:0:${Y}`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const n = raw.length / W;
  const cen = [];
  for (let i = 0; i < n; i++) {
    const row = raw.subarray(i * W, (i + 1) * W).subarray(X0, X1);
    const base = med([...row.subarray(0, 120)]); // 光带还没到的左段当底色
    let s = 0, sx = 0, mx = 0;
    for (let x = 0; x < row.length; x++) { const e = Math.max(0, row[x] - base - 2); s += e; sx += e * x; mx = Math.max(mx, e); }
    cen.push(s > 200 && mx > 6 ? +(X0 + sx / s).toFixed(1) : null); // 光带不在条内时记 null
  }
  // 只看"光带在条内"的相邻帧：位置不同才算一次画面变化
  const steps = [], holds = []; let lastChangeT = null, changes = 0;
  for (let i = 1; i < n; i++) {
    if (cen[i] == null || cen[i - 1] == null) continue;
    const d = cen[i] - cen[i - 1];
    if (Math.abs(d) >= 1.5) { steps.push(+d.toFixed(1)); changes++; if (lastChangeT != null) holds.push(+(man[i] - lastChangeT).toFixed(1)); lastChangeT = man[i]; }
  }
  const inBar = cen.filter((c) => c != null).length;
  out[v] = { frames: n, framesWithBandInBar: inBar, changes, medianStepPx: steps.length ? med(steps) : null, medianHoldMs: holds.length ? med(holds) : null, steps: steps.slice(0, 40), holds: holds.slice(0, 40), centroids: cen };
  console.log(v, JSON.stringify({ ...out[v], steps: undefined, holds: undefined, centroids: undefined }));
}
fs.writeFileSync(RESULT, JSON.stringify(out));
