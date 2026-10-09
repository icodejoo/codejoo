// 颜色实验：对 colors.html 的 3 种场景（light/dark/custom）各截 N 张图，读每行最亮 / 最暗像素，对比精确高光 / 底色
import fs from "node:fs";
import { runLocked, sleep } from "./lock.mjs";
const HOST = "http://localhost:5188/demo/.tmp-a3/colors.html";
const ids = JSON.parse(fs.readFileSync("rows.json", "utf8"));
const SHOTS = +(process.argv[2] || 12);
const OUT = process.argv[3] || "colors-result.json";
const scenarios = [
  { name: "light", q: "theme=light", C: [0xd9, 0xdd, 0xe3], H: [0xec, 0xef, 0xf3] },
  { name: "dark", q: "theme=dark", C: [0x37, 0x41, 0x51], H: [0x4b, 0x55, 0x63] },
  { name: "custom", q: "theme=light&custom=1", C: [0xcf, 0xe3, 0xff], H: [0xe8, 0xf2, 0xff] },
];
// 页内读像素：给定 png base64 和各行 y，返回每行 [minLumRGB, maxLumRGB]（x 从 8 到宽-8）
const PIX = `window.readRows = (b64, ys) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0); const out = []; for (const y of ys) { const d = x.getImageData(8, y, im.width - 16, 1).data; let mn = null, mx = null, ml = 1e9, xl = -1; for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; if (l < ml) { ml = l; mn = [d[i], d[i + 1], d[i + 2]]; } if (l > xl) { xl = l; mx = [d[i], d[i + 1], d[i + 2], i / 4 + 8]; } } out.push([mn, mx]); } res(out); }; im.src = "data:image/png;base64," + b64; })`;
const lab = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; const [R, G, B] = [f(r), f(g), f(b)]; const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883; const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))]; };
const dE = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const result = {};
await runLocked(9343, "colors", async ({ send, ev }) => {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const sc of scenarios) {
    await send("Page.navigate", { url: `${HOST}?${sc.q}` });
    for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
    await sleep(600);
    await ev(PIX);
    const ys = await ev(`[...document.querySelectorAll("#root p")].map(p => { const r = p.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })`);
    const info = await ev(`(() => { const p = document.querySelector('#root p[data-v="1c-soft-light-0.55"]'); const s = getComputedStyle(p); return { bg: s.backgroundColor, blend: s.backgroundBlendMode, att: s.backgroundAttachment, size: s.backgroundSize, img: s.backgroundImage.slice(0, 30) }; })()`);
    console.error(sc.name, JSON.stringify(info));
    const best = ids.map(() => ({ max: null, min: null }));
    for (let k = 0; k < SHOTS; k++) {
      const shot = (await send("Page.captureScreenshot", { format: "png" })).result.data;
      if (k === 0) fs.writeFileSync(`shot-${sc.name}.png`, Buffer.from(shot, "base64"));
      const rows = await ev(`readRows(${JSON.stringify(shot)}, ${JSON.stringify(ys)})`);
      rows.forEach(([mn, mx], i) => {
        const b = best[i];
        if (!b.min || mn[0] + mn[1] + mn[2] < b.min[0] + b.min[1] + b.min[2]) b.min = mn;
        if (!b.max || mx[0] + mx[1] + mx[2] > b.max[0] + b.max[1] + b.max[2]) b.max = mx;
      });
      await sleep(110 + k * 23);
    }
    result[sc.name] = { C: sc.C, H: sc.H, rows: ids.map((id, i) => ({ id, base: best[i].min, peak: best[i].max.slice(0, 3), peakX: best[i].max[3], dPeak: best[i].max.slice(0, 3).map((v, j) => v - sc.H[j]), dEPeak: +dE(best[i].max.slice(0, 3), sc.H).toFixed(2), dBase: best[i].min.map((v, j) => v - sc.C[j]), dEBase: +dE(best[i].min, sc.C).toFixed(2) })) };
  }
});
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
for (const [n, s] of Object.entries(result)) {
  console.log(`== ${n}  C=${s.C} H=${s.H}`);
  for (const r of s.rows) console.log(r.id.padEnd(22), "peak", String(r.peak).padEnd(12), "dPeak", String(r.dPeak).padEnd(12), "dE", String(r.dEPeak).padEnd(6), "| base", String(r.base).padEnd(12), "dBase", String(r.dBase).padEnd(12), "dE", r.dEBase);
}
