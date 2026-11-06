// 后台标签页下 count-down 的 onDone 准时性：页面进入后台后，实际触发时刻相对目标时长的偏差。
// 用法：node scripts/bench/hidden.mjs <base|cur> <muteHidden 1|0> <时长ms> [端口]
// 注意：Chrome 对隐藏超过 5 分钟的页面做强节流，验证它请用 >= 390000 的时长。
import { launch, sleep } from "./cdp.mjs";

const [v = "cur", mute = "1", dStr = "4000", portStr = "9466"] = process.argv.slice(2);
const D = Number(dStr);
const b = await launch(Number(portStr));
await b.open({ v, s: "done", n: 1, d: D, m: mute });
const tab = await b.browser("Target.createTarget", { url: "about:blank" });
await b.browser("Target.activateTarget", { targetId: tab.result.targetId }); // 新标签置前，原页面进入后台
const t0 = Date.now();
await sleep(500);
const hidden = await b.ev("document.hidden");
let done = null;
while (Date.now() - t0 < D + 150000) {
  done = await b.ev("window.__done[0] ?? null");
  if (done !== null) break;
  await sleep(2000);
}
console.log(JSON.stringify({ 构建: v, muteHidden: mute !== "0", 页面隐藏: hidden, 目标ms: D, 实际onDone_ms: done === null ? "未触发" : Math.round(done), 迟到ms: done === null ? null : Math.round(done - D) }));
b.close();
process.exit(0);
