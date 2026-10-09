// 显示 / 动画 / 同步检查：对每个 css 变体截 6 张图，读 8 行骨头的最亮像素 x 与亮度
// 用法：node check.mjs css1,css2 [effect] [theme]
import fs from "node:fs";
import { runLocked, sleep } from "./lock.mjs";
const list = process.argv[2].split(","), effect = process.argv[3] || "shimmer", theme = process.argv[4] || "light";
const PIX = `window.readRows = (b64, ys) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0); const out = []; for (const y of ys) { const d = x.getImageData(8, y, im.width - 16, 1).data; let ml = 1e9, xl = -1, xi = 0; for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; if (l < ml) ml = l; if (l > xl) { xl = l; xi = i / 4 + 8; } } out.push([xi, xl / 3, ml / 3]); } res(out); }; im.src = "data:image/png;base64," + b64; })`;
await runLocked(9343, "check", async ({ send, ev }) => {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const css of list) {
    await send("Page.navigate", { url: `http://localhost:5188/demo/.tmp-a3/sync.html?css=${css}&effect=${effect}&theme=${theme}` });
    for (let i = 0; i < 60 && !(await ev("window.ready === true").catch(() => false)); i++) await sleep(250);
    await sleep(800); await ev(PIX);
    const ys = await ev(`[...document.querySelectorAll("#root p")].map(p => { const r = p.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })`);
    const st = await ev(`(() => { const s = getComputedStyle(document.querySelector("#root p")); return s.backgroundImage.slice(0, 60); })()`);
    const shots = [];
    for (let k = 0; k < 6; k++) {
      const shot = (await send("Page.captureScreenshot", { format: "png" })).result.data;
      if (k === 0) fs.writeFileSync(`sync-${css}-${effect}.png`, Buffer.from(shot, "base64"));
      shots.push(await ev(`readRows(${JSON.stringify(shot)}, ${JSON.stringify(ys)})`));
      await sleep(170 + k * 41);
    }
    console.log(`## ${css} ${effect} ${theme}  bg=${st}`);
    shots.forEach((rows, k) => console.log(`  shot${k}: peakX=[${rows.map((r) => r[0])}] peakLum=[${rows.map((r) => r[1].toFixed(0))}] minLum=${Math.min(...rows.map((r) => r[2])).toFixed(0)}`));
  }
});
