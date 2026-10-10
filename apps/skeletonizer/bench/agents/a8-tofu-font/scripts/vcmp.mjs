import { launch, sleep } from "./lib.mjs";
const c = await launch({ headless: false });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 320, deviceScaleFactor: 2, mobile: false });
await c.goto("http://localhost:5198/bench/agents/a8-tofu-font/vcmp.html", "window.ready===true"); await sleep(500);
await c.shot("shots/vcmp-dpr2.png");
console.log(await c.ev(`JSON.stringify({realNormalH:rn.getBoundingClientRect().height, tofuNormalH:tn.getBoundingClientRect().height, fonts:[...document.fonts].map(f=>f.family+":"+f.status)})`));
await c.close();
