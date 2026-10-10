// 放大截图卡片区域（下探字形小点检查 + 光带经过文字的画面）。每个组合连拍 8 帧，存光带最亮那帧
import { launch, sleep } from "./lib.mjs";
import { decode, lum } from "./png.mjs";
import fs from "node:fs";
const OUT = "E:/workspaces/codejoo/apps/skeletonizer/bench/agents/a7-clip-underline/shots/";
const b = await launch({ headless: false });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const [mode, engine, theme] of [["base", "global", "dark"], ["clipall", "global", "dark"], ["clipall", "svg", "dark"], ["clipall", "global", "light"], ["clipall", "svg", "light"], ["base", "global", "light"]]) {
    await b.goto(`http://localhost:5191/bench/agents/a7-clip-underline/verify.html?mode=${mode}&engine=${engine}&effect=shimmer&theme=${theme}`, "window.ready===true");
    let best = null, bestV = -1;
    for (let i = 0; i < 10; i++) { const r = await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 460, height: 232, scale: 2 } }); const buf = Buffer.from(r.result.data, "base64"); const img = decode(buf); let mx = 0, mn = 255; for (let y = 140; y < 220; y += 2) for (let x = 150; x < 880; x += 2) { const l = lum(img, x, y); mx = Math.max(mx, l); mn = Math.min(mn, l); } const v = mx - mn; if (v > bestV) { bestV = v; best = buf; } await sleep(170); }
    fs.writeFileSync(`${OUT}zoom-${mode}-${engine}-${theme}.png`, best);
  }
} finally { await b.close(); }
