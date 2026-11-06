// 页面时钟与可见性：为相对时长提供不受系统改时影响的单调钟，并跟踪页面是否被隐藏。

/** 隐藏期间墙钟比单调钟多走超过该值（ms）才视为"系统休眠"并补偿，更小的差值当采样误差 */
const SUSPEND_MIN = 1000;

// 休眠补偿累计量（ms）：浏览器在系统睡眠期间单调钟可能停走，恢复可见时把差值补回
let offset = 0;
// 页面当前是否隐藏（由 visibilitychange 维护）
let hidden = false;
// 进入隐藏时的墙钟 / 单调钟快照，0 表示当前未处于隐藏
let hiddenWall = 0;
let hiddenMono = 0;
let bound = false;
const listeners: ((hidden: boolean) => void)[] = [];

/** 首次使用时挂接 visibilitychange（SSR 无 document 则跳过） */
function bind() {
  if (bound || typeof document === "undefined") return;
  bound = true;
  hidden = document.hidden;
  document.addEventListener("visibilitychange", () => {
    const next = document.hidden;
    if (next === hidden) return;
    hidden = next;
    if (next) {
      hiddenWall = Date.now();
      hiddenMono = performance.now();
    } else if (hiddenWall) {
      // 隐藏期间墙钟多走的部分 = 系统休眠时长（前台改系统时间不在此补偿）
      const gap = Date.now() - hiddenWall - (performance.now() - hiddenMono);
      if (gap > SUSPEND_MIN) offset += gap;
      hiddenWall = 0;
    }
    for (let i = 0; i < listeners.length; i++) listeners[i](next);
  });
}

/** 单调钟（ms）：不受系统改时影响，已含休眠补偿；仅用于求时间差，数值本身无绝对含义 */
export function monoNow(): number {
  bind();
  return performance.now() + offset;
}

/** 页面当前是否隐藏（切到后台标签页 / 最小化 / 锁屏） */
export function isHidden(): boolean {
  bind();
  return hidden;
}

/** 订阅页面可见性变化，回调参数为变化后的 hidden */
export function onVisibility(fn: (hidden: boolean) => void): void {
  bind();
  listeners.push(fn);
}
