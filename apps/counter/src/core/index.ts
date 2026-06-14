import type { Counter, IPlugin } from "./types";

// 已注册的插件名，用于去重
const installed = new Set<string>();
// 请求动画帧的ID
let raf = -1;
// 上一帧的 RAF 时间戳，-1 表示尚未跑过帧（dt 记 0，避免把页面已存活时长算进首帧）
let last = -1;
// 订阅者回调函数
const subscribers: IPlugin["install"][] = [];
// 各插件的释放钩子（counter.destroy() 时调用）
const disposers: (() => void)[] = [];

function loop(now: number) {
  const dt = last < 0 ? 0 : now - last;
  last = now;
  let busy = false;
  for (let i = 0; i < subscribers.length; i++) {
    if (subscribers[i](now, dt) !== false) busy = true;
  }
  // 所有插件都空闲时自动停止，新任务加入时由插件调用 start() 重新启动
  if (busy) {
    raf = requestAnimationFrame(loop);
  } else {
    raf = -1;
    last = -1;
  }
}

export function start() {
  if (raf !== -1) return;
  last = -1;
  raf = requestAnimationFrame(loop);
}

export function stop() {
  if (raf === -1) return;
  cancelAnimationFrame(raf);
  raf = -1;
  last = -1;
}

export function use(plugin: IPlugin) {
  if (installed.has(plugin.name)) return;
  installed.add(plugin.name);
  subscribers.push(plugin.install);
  if (plugin.dispose) disposers.push(plugin.dispose);
  if (plugin.api !== undefined) {
    (GT as unknown as Record<string, unknown>)[plugin.name] = plugin.api;
  }
}

/** 停止 RAF、释放所有插件资源、卸载已挂载 api；之后再 countup/countdown 会自动重新注册 */
export function destroy() {
  stop();
  for (let i = 0; i < disposers.length; i++) disposers[i]();
  disposers.length = 0;
  subscribers.length = 0;
  installed.forEach((name) => delete (GT as unknown as Record<string, unknown>)[name]);
  installed.clear();
}

export const GT = { start, stop, use, destroy } as Counter;

export default GT;
