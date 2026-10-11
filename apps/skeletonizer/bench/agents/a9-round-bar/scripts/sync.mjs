// 光带同步：冻结动画到若干时刻，对比 clip 与 A 在同一视口 x 处的亮度（同一张 fixed 渐变，同 x 应同亮度）。
import { launch, sleep } from "./lib.mjs";
import { decode, lum } from "./png.mjs";
import fs from "node:fs";
const OUT = "D:/workspaces/codejoo/apps/skeletonizer/bench/agents/a9-round-bar/";
const b = await launch({ headless: true });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 800, deviceScaleFactor: 1, mobile: false });
  await b.goto("http://localhost:5919/bench/agents/a9-round-bar/sync.html", "window.ready===true");
  for (const ms of [300, 700, 1000, 1300]) {
    await b.ev(`freeze(${ms})`); await sleep(200);
    const png = decode(await b.shot(`${OUT}shots/sync-${ms}.png`, { x: 0, y: 0, width: 1300, height: 800 }, 1));
    // 每个根每条灰条（行）：取条中心 y，沿 x 采样亮度
    const rows = await b.ev(`[...document.querySelectorAll(".r")].map(r=>[...r.querySelectorAll("[skz-text]")].flatMap(s=>[...s.getClientRects()].map(c=>({x:c.x,y:c.y,w:c.width,h:c.height}))))`);
    const prof = rows.map((rs) => rs.map((c) => { const y = Math.round(c.y + c.h / 2); const o = {}; for (let x = Math.ceil(c.x + 4); x < c.x + c.w - 4; x += 4) o[x] = Math.round(lum(png, x, y)); return o; }));
    // 对比：A 的每条与 clip 的每条在共同 x 上的最大亮度差
    const cmp = (a, c) => { let d = 0, n = 0; for (const pa of a) for (const pc of c) for (const x in pa) if (x in pc) { d = Math.max(d, Math.abs(pa[x] - pc[x])); n++; } return { maxDiff: d, samples: n }; };
    let lo = 255, hi = 0; for (const p of prof[0]) for (const v of Object.values(p)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const self = cmp(prof[0].slice(0,1), prof[0].slice(1,2)); console.log(`t=${ms}ms clip内部行0 vs 行1 ${JSON.stringify(self)} clip亮度范围[${lo},${hi}] clip行数=${prof[0].length} A行数=${prof[1].length}`, "A全部 vs clip", JSON.stringify(cmp(prof[1], prof[0])), "A混合 vs clip", JSON.stringify(cmp(prof[2], prof[0])));
  }
} finally { await b.close(); }
