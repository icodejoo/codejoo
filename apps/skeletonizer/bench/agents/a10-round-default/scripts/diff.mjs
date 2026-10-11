// 逐像素对比两张 PNG：node diff.mjs a.png b.png
import fs from "node:fs";
import { decode } from "./png.mjs";
const [a, b] = process.argv.slice(2).map((f) => decode(fs.readFileSync(f)));
if (a.w !== b.w || a.h !== b.h) { console.log("尺寸不同", a.w, a.h, b.w, b.h); process.exit(1); }
let n = 0, max = 0;
for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); if (d) { n++; if (d > max) max = d; } }
console.log(`${process.argv[2]} vs ${process.argv[3]}: 不同字节 ${n}, 最大差 ${max}`);
