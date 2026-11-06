import type { Counter, IPlugin } from "./types";
import { isHidden, onVisibility } from "./clock";

// 已注册的插件名，用于去重
const installed = new Set<string>();
// 待执行的 rAF ID，-1 表示没有
let raf = -1;
// 休眠 / 隐藏态驱动用的定时器，undefined 表示没有
let timer: ReturnType<typeof setTimeout> | undefined;
// 上一帧的时间戳，-1 表示尚未跑过帧（dt 记 0，避免把页面已存活时长算进首帧）
let last = -1;
// 循环是否存活（已排程或正在运行）；空闲自动停止或 stop() 后为 false
let alive = false;
// 循环代次：stop() / 重启会递增，订阅者回调里 stop / 重启过的旧循环据此自行退出，避免双循环
let epoch = 0;
// 是否处于 loop 的订阅者遍历中
let inLoop = false;
// 遍历期间是否有人调用过 start()（如 onDone 里新建任务）
let kicked = false;
// 订阅者回调函数
const subscribers: IPlugin["install"][] = [];
// 各插件的释放钩子（counter.destroy() 时调用）
const disposers: (() => void)[] = [];

// 页面隐藏时 rAF 会停摆，改用定时器驱动；仍需逐帧的任务按该间隔（ms）轮询（浏览器对隐藏页定时器本就限到约 1s）
const HIDDEN_POLL = 1000;

/** 排下一次执行：delay<0 表示下一帧（页面隐藏时退化为轮询定时器），否则 delay 毫秒后 */
function arm(delay: number) {
  if (delay < 0 && !isHidden()) {
    raf = requestAnimationFrame(loop);
    return;
  }
  timer = setTimeout(fire, delay < 0 ? HIDDEN_POLL : delay);
}

/** 定时器到点：可见页补排一帧对齐 vsync，隐藏页直接执行（rAF 不会触发） */
function fire() {
  timer = undefined;
  last = -1;
  if (isHidden()) loop(performance.now());
  else raf = requestAnimationFrame(loop);
}

/** 立即重排：隐藏页用 0ms 定时器，可见页用下一帧 */
function kick() {
  arm(isHidden() ? 0 : -1);
}

/** 取消休眠定时器并立即重排（隐藏页用 0ms 定时器，可见页用下一帧） */
function rearm() {
  clearTimeout(timer);
  timer = undefined;
  last = -1;
  kick();
}

function loop(now: number) {
  raf = -1;
  const dt = last < 0 ? 0 : now - last;
  last = now;
  const self = epoch;
  let busy = false;
  let wake = Infinity; // 各插件要求的最早唤醒延迟(ms)
  inLoop = true;
  kicked = false;
  for (let i = 0; i < subscribers.length; i++) {
    try {
      const r = subscribers[i](now, dt);
      if (r === false) continue;
      if (typeof r === "number") {
        if (r < wake) wake = r;
      } else busy = true;
    } catch (err) {
      // 单个插件抛错不应拖垮整个共享 ticker，其余插件仍需正常推进
      console.error("[GT]: plugin install() threw, skipping this frame for it", err);
    }
  }
  inLoop = false;
  // 回调里已 stop / destroy / 重启过：以其状态为准，不再续排，避免 stop 失效或出现双循环
  if (epoch !== self) return;
  if (busy) {
    arm(-1);
  } else if (kicked) {
    // 遍历中新增了任务，但先跑的插件可能已报空闲，必须再跑一轮让它被接管
    kick();
  } else if (wake < Infinity) {
    // 只剩"到点才需处理"的任务：不逐帧空转，睡到最早的唤醒时刻
    last = -1;
    arm(wake);
  } else {
    // 所有插件都空闲时自动停止，新任务加入时由插件调用 start() 重新启动
    alive = false;
    last = -1;
  }
}

export function start() {
  if (alive) {
    if (inLoop) kicked = true;
    else if (timer !== undefined) rearm(); // 打断休眠
    return;
  }
  alive = true;
  epoch++;
  last = -1;
  kick();
}

/** 内部：若循环正在休眠则提前唤醒重新评估（移除任务后让空闲循环及时收尾），不会启动已停止的循环 */
export function nudge() {
  if (alive && !inLoop && timer !== undefined) rearm();
}

export function stop() {
  epoch++;
  alive = false;
  clearTimeout(timer);
  timer = undefined;
  if (raf !== -1) {
    cancelAnimationFrame(raf);
    raf = -1;
  }
  last = -1;
}

// 页面可见性变化时切换驱动方式：隐藏→撤掉 rAF 改用定时器（保证到期回调不被后台停摆拖延）；可见→回到 rAF
onVisibility((hidden) => {
  if (!alive || inLoop) return;
  if (hidden) {
    if (raf === -1) return;
    cancelAnimationFrame(raf);
    raf = -1;
    arm(0);
  } else {
    nudge(); // 回到可见：休眠 / 轮询中的定时器改回 rAF
  }
});

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
