import type { Counter, IPlugin } from "./types";

const plugins: string[] = [];
// 请求动画帧的ID
let raf = -1;
// 订阅者回调函数
let subscribers: ((elapsed: number, dt: number) => void)[] = [];
let $elapsed = 0;
let dt = 0;

function start() {
  if (raf !== -1) return;
  // 以首帧时间戳作为基准，避免第一帧 dt 过大
  raf = requestAnimationFrame((elapsed) => {
    $elapsed = elapsed;
    raf = requestAnimationFrame(loop);
  });
}

function stop() {
  if (raf === -1) return;
  cancelAnimationFrame(raf);
  raf = -1;
}

/** RAF 自循环：每帧推进后再排下一帧，否则动画只会跑一帧就停 */
function loop(elapsed: number) {
  tick(elapsed);
  raf = requestAnimationFrame(loop);
}

function tick(elapsed: number) {
  dt = elapsed - $elapsed
  $elapsed = elapsed;
  subscribers.forEach((subscriber) => subscriber(elapsed, dt));
}

function use(plugin: IPlugin) {
  plugins.push(plugin.name);
  subscribers.push(plugin.install);
  if (plugin.api !== undefined) {
    (counter as unknown as Record<string, unknown>)[plugin.name] = plugin.api;
  }
}

export const counter = { start, stop, tick, use } as Counter;

export default counter;
