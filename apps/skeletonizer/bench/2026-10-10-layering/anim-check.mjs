// 动画对齐抽查：underline + shimmer 根上有两个动画（shimmer-root、pulse-root），看它们的开始时间 / 时间函数 / 方向是否一致。
// 用法：PORT_CDP=9688 node anim-check.mjs <端口 5195|5196|5206...>
import { launch, sleep } from "./lib.mjs";
const ports = process.argv.slice(2);
const c = await launch({ headless: false, w: 1280, h: 900 });
await c.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
const out = {};
try {
  for (const port of ports) for (const text of ["underline", undefined]) {
    await c.goto(`http://localhost:${port}/bench/2026-10-10-layering/perf.html?css=base,global,tofu`, "window.ready===true");
    await c.ev(`setup(2000, ${JSON.stringify({ effect: "shimmer", text })})`);
    await sleep(800);
    out[`${port} ${text ?? "clip"}`] = await c.ev(`(()=>{
      const root=document.getElementById("root");
      return root.getAnimations().map(a=>{const t=a.effect.getTiming(); return {name:a.animationName, start:+a.startTime.toFixed(1), cur:+a.currentTime.toFixed(1), dur:t.duration, dir:t.direction, easing:t.easing, iter:a.effect.getComputedTiming().currentIteration};});
    })()`);
  }
} finally { await c.close(); }
console.log(JSON.stringify(out, null, 1));
