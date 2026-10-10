import { launch } from "./lib.mjs";
const [name, qs = "", scale = "3"] = process.argv.slice(2);
const b = await launch({ headless: true, lock: false });
try { await b.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 520, deviceScaleFactor: 1, mobile: false });
  await b.goto(`http://localhost:5191/bench/agents/a7-clip-underline/descender.html?${qs}`);
  await b.shot(`E:/workspaces/codejoo/apps/skeletonizer/bench/agents/a7-clip-underline/shots/${name}.png`, { x: 0, y: 0, width: 1100, height: 330 }, +scale); } finally { await b.close(); }
