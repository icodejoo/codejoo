// 实验 5 颜色/时长/成本：colors5.html 在 light/dark/custom/dur3 下各截图
import fs from "node:fs";
import { runLocked, sleep } from "./lock.mjs";
const HOST = "http://localhost:5188/demo/.tmp-a3/colors5.html";
const ids = JSON.parse(fs.readFileSync("rows5.json", "utf8"));
const SHOTS = +(process.argv[2] || 12);
const scenarios = [
  { name: "light", q: "theme=light", C: [0xd9, 0xdd, 0xe3], H: [0xec, 0xef, 0xf3] },
  { name: "dark", q: "theme=dark", C: [0x37, 0x41, 0x51], H: [0x4b, 0x55, 0x63] },
  { name: "custom", q: "theme=light&custom=1", C: [0xcf, 0xe3, 0xff], H: [0xe8, 0xf2, 0xff] },
  { name: "dur3", q: "theme=light&dur=3s", C: [0xd9, 0xdd, 0xe3], H: [0xec, 0xef, 0xf3], speed: true },
  { name: "dur300ms", q: "theme=light&dur=750ms", C: [0xd9, 0xdd, 0xe3], H: [0xec, 0xef, 0xf3], speed: true },
  { name: "dur1.5", q: "theme=light", C: [0xd9, 0xdd, 0xe3], H: [0xec, 0xef, 0xf3], speed: true },
];
const PIX = `window.readRows = (b64, ys) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0); const out = []; for (const y of ys) { const d = x.getImageData(8, y, im.width - 16, 1).data; let mn = null, mx = null, ml = 1e9, xl = -1; for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; if (l < ml) { ml = l; mn = [d[i], d[i + 1], d[i + 2]]; } if (l > xl) { xl = l; mx = [d[i], d[i + 1], d[i + 2], i / 4 + 8]; } } out.push([mn, mx]); } res(out); }; im.src = "data:image/png;base64," + b64; })`;
const lab = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; const [R, G, B] = [f(r), f(g), f(b)]; const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883; const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))]; };
const dE = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const result = {};
await runLocked(9343, "colors5", async ({ send, ev }) => {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const sc of scenarios) {
    await send("Page.navigate", { url: `${HOST}?${sc.q}` });
    for (let i = 0; i < 80 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
    await ev(PIX);
    const ys = await ev(`[...document.querySelectorAll("#root p")].map(p => { const r = p.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })`);
    const cost = await ev("window.cost");
    const best = ids.map(() => ({ max: null, min: null })), xs = ids.map(() => []);
    for (let k = 0; k < SHOTS; k++) {
      const ta = Date.now();
      const shot = (await send("Page.captureScreenshot", { format: "png" })).result.data;
      const tb = Date.now();
      if (k === 0) fs.writeFileSync(`shot5-${sc.name}.png`, Buffer.from(shot, "base64"));
      const rows = await ev(`readRows(${JSON.stringify(shot)}, ${JSON.stringify(ys)})`);
      rows.forEach(([mn, mx], i) => {
        const b = best[i];
        if (!b.min || mn[0] + mn[1] + mn[2] < b.min[0] + b.min[1] + b.min[2]) b.min = mn;
        if (!b.max || mx[0] + mx[1] + mx[2] > b.max[0] + b.max[1] + b.max[2]) b.max = mx;
        xs[i].push([(ta + tb) / 2, mx[3], mx[0] + mx[1] + mx[2]]);
      });
      await sleep(60);
    }
    const speed = {};
    if (sc.speed) for (const id of ["blob", "prod-light"]) { const i = ids.indexOf(id); const v = []; for (let k = 1; k < xs[i].length; k++) { const dt = (xs[i][k][0] - xs[i][k - 1][0]) / 1000, dx = xs[i][k][1] - xs[i][k - 1][1]; if (dx > 0 && dt < 0.5 && dt > 0.02) v.push(dx / dt); } speed[id] = { medianPxPerS: Math.round(med(v) || 0), n: v.length }; }
    result[sc.name] = { cost, speed, rows: ids.map((id, i) => ({ id, base: best[i].min, peak: best[i].max.slice(0, 3), dPeak: best[i].max.slice(0, 3).map((v, j) => v - sc.H[j]), dEPeak: +dE(best[i].max.slice(0, 3), sc.H).toFixed(2), dBase: best[i].min.map((v, j) => v - sc.C[j]), dEBase: +dE(best[i].min, sc.C).toFixed(2), xtrace: sc.speed || id === "blobfrag" ? xs[i].map((x) => x[1]).join(",") : undefined })) };
  }
});
fs.writeFileSync("colors5-result.json", JSON.stringify(result, null, 1));
for (const [n, s] of Object.entries(result)) {
  console.log(`== ${n} cost=${JSON.stringify(s.cost)} speed=${JSON.stringify(s.speed)}`);
  for (const r of s.rows) console.log(r.id.padEnd(12), "peak", String(r.peak).padEnd(12), "dPeak", String(r.dPeak).padEnd(12), "dE", String(r.dEPeak).padEnd(6), "| base", String(r.base).padEnd(12), "dBase", String(r.dBase).padEnd(12), "dE", r.dEBase, r.xtrace ? "x=" + r.xtrace : "");
}
