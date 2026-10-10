// 字体加载闪现：screencast 逐帧统计红色像素（--skz-color 设成红色；真实文字若闪现会是"细碎的红"，方块是"成片的红"）
import { launch, sleep } from "./lib.mjs"; import { decode } from "./png.mjs"; import fs from "node:fs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
await c.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 400, deviceScaleFactor: 1, mobile: false });
const res = {};
for (const name of ["tofu", "tofu-slow", "tofu-broken"]) {
  await c.send("Network.enable"); await c.send("Network.setCacheDisabled", { cacheDisabled: true });
  c.events.length = 0;
  await c.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await c.send("Page.navigate", { url: BASE + `flash-${name}.html` });
  const frames = []; const t0 = Date.now();
  while (Date.now() - t0 < (name === "tofu-slow" ? 3500 : 1800)) {
    for (const e of c.events.splice(0)) if (e.method === "Page.screencastFrame") { frames.push({ t: Date.now() - t0, data: e.params.data }); c.send("Page.screencastFrameAck", { sessionId: e.params.sessionId }); }
    await sleep(15);
  }
  await c.send("Page.stopScreencast");
  const stats = frames.map((f, i) => { const img = decode(Buffer.from(f.data, "base64")); let red = 0; for (let k = 0; k < img.data.length; k += img.bpp) if (img.data[k] > 200 && img.data[k + 1] < 80 && img.data[k + 2] < 80) red++; if (i === frames.length - 1 || i === 0) fs.writeFileSync(`shots/flash-${name}-${i === 0 ? "first" : "last"}.png`, Buffer.from(f.data, "base64")); return { t: f.t, red }; });
  const log = await c.ev("JSON.stringify(window.log)").catch(() => null);
  res[name] = { frames: stats.length, stats, log };
  console.log(name, "frames", stats.length, JSON.stringify(stats.map((s) => `${s.t}ms:${s.red}`).join(" ")).slice(0, 600), log);
}
fs.writeFileSync("data/flash.json", JSON.stringify(res, null, 1));
await c.close();
