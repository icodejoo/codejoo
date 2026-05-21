import type { Counter, IPlugin } from "./types";

const plugins: string[] = [];
// 请求动画帧的ID
let raf = -1;
// 订阅者回调函数
let subscribers: ((elapsed: number, dt: number) => void)[] = [];

function start() {
  if (raf !== -1) return;
  tick(0);
  raf = requestAnimationFrame(tick);
}

function stop() {
  if (raf === -1) return;
  cancelAnimationFrame(raf);
  raf = -1;
}

function tick(dt: number) {
  subscribers.forEach((subscriber) => subscriber(dt, dt));
}

function use(plugin: IPlugin) {
  plugins.push(plugin.name);
  subscribers.push(plugin.install);
  if (plugin.api !== undefined) {
    (GT as unknown as Record<string, unknown>)[plugin.name] = plugin.api;
  }
}

export const GT = { start, stop, tick, use } as Counter;

export default GT;
