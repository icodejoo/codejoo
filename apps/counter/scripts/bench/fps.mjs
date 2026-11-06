// 有头真机 fps：用合成器 DrawFrame / DroppedFrame 事件（与 DevTools FPS 表同源）对比 base 与 cur，并附主线程 CPU。
// 用法：BENCH_HEADED=1 node scripts/bench/fps.mjs '[["ring",100],["odo",100]]' [采样ms=5000] [轮数=3]
// 解读：动画类（ring / odo / 毫秒倒计时 / count-up）fps 越接近屏幕刷新率越流畅；整秒类（card / 整秒倒计时）本就每秒只出 1 帧，fps 越低越省电。
import { launch, sleep } from "./cdp.mjs";

const scenarios = JSON.parse(process.argv[2] ?? '[["ring",100]]');
const MS = Number(process.argv[3] ?? 5000);
const rounds = Number(process.argv[4] ?? 3);
const b = await launch(9477);
const gpu = (await b.browser("SystemInfo.getInfo")).result?.gpu?.devices?.[0];
console.log("GPU:", gpu ? `${gpu.vendorString} ${gpu.deviceString}` : "未知", process.env.BENCH_HEADED ? "(有头)" : "(无头)");

async function traceFrames(ms) {
  const events = [];
  b.on("Tracing.dataCollected", (p) => p.value && events.push(...p.value));
  const done = new Promise((res) => b.on("Tracing.tracingComplete", res));
  await b.cmd("Tracing.start", { transferMode: "ReportEvents", categories: "disabled-by-default-devtools.timeline.frame,benchmark,viz" });
  await sleep(ms);
  await b.cmd("Tracing.end");
  await done;
  b.off("Tracing.dataCollected");
  b.off("Tracing.tracingComplete");
  let drawn = 0;
  let dropped = 0;
  for (const e of events) {
    if (e.name === "DrawFrame") drawn++;
    else if (e.name === "DroppedFrame") dropped++;
  }
  return { drawn, dropped };
}

const med = (a, k) => a.map((o) => o[k]).sort((x, y) => x - y)[a.length >> 1];
const out = [];
for (const [s, n, o = 0] of scenarios) {
  const acc = { base: [], cur: [] };
  for (let r = 0; r < rounds; r++) {
    for (const v of r % 2 ? ["cur", "base"] : ["base", "cur"]) {
      await b.open({ v, s, n, o });
      await sleep(1500);
      const m0 = await b.metrics();
      const f = await traceFrames(MS);
      const m1 = await b.metrics();
      const sec = MS / 1000;
      acc[v].push({ fps: f.drawn / sec, drop: f.drawn + f.dropped ? (f.dropped / (f.drawn + f.dropped)) * 100 : 0, task: ((m1.TaskDuration - m0.TaskDuration) * 1000) / sec });
    }
  }
  for (const v of ["base", "cur"]) out.push({ 场景: `${s}×${String(n)}`, 构建: v, "合成 fps": +med(acc[v], "fps").toFixed(1), "掉帧 %": +med(acc[v], "drop").toFixed(1), "主线程 ms/s": +med(acc[v], "task").toFixed(1) });
}
console.table(out);
b.close();
process.exit(0);
