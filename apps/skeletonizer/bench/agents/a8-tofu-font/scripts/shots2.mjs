// 卡片截图：深/浅色 x DPR（1 / 1.25 / 2），裁第一张卡片并放大
import { launch, sleep } from "./lib.mjs";
const BASE = "http://localhost:5198/bench/agents/a8-tofu-font/";
const c = await launch({ headless: false });
for (const scheme of ["light", "dark"]) for (const dpr of [1, 1.25, 2]) {
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: dpr, mobile: false });
  await c.goto(BASE + "demo.html?css=base,global,tofu", "window.ready===true");
  await c.ev(`apply({effect:"solid",text:"tofu"})`); await sleep(500);
  await c.shot(`shots/card-${scheme}-dpr${dpr}.png`, { x: 16, y: 56, width: 345, height: 250 }, dpr === 2 ? 1 : 2);
}
await c.close();
