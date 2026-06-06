import type { IPlugin } from "../core/types";
import { $ } from "../helper";
import { defaultObserver, observe, unobserve } from "../core/observer";
import { buildCountupFmt, ease, fps2ms } from "./helper";
import type { ICountupBaseOptions, ICountupTask, ICountupFullOptions } from "./type";


let $elapsed = 0;
let id = 0;
let queue: ICountupTask[] = []
/** id -> 在 queue 中的下标，仅记录“活动中”的任务 */
const indexMap = new Map<number, number>()
/** id -> 任务对象，记录所有存活任务（完成后仍保留，以便 update 重新入队） */
const taskMap = new Map<number, ICountupTask>()

/**
 * 把任务移出活动队列（swap-remove），但**不**触发 onDestory。
 * 任务对象仍保留在 taskMap 中，可被 update 重新激活。
 */
function dequeue(i: number) {
  const last = queue.length - 1;
  const cur = queue[i];
  if (i !== last) {
    const moved = queue[last];
    queue[i] = moved;
    moved._index = i;
    indexMap.set(moved.id, i);
  }
  indexMap.delete(cur.id);
  queue.pop();
}

/**
 * 把任务加入活动队列并（重新）开始动画。
 * 用于普通任务初始化、lazy 任务进入视口、update 复活已完成任务。
 * 从当前显示值续滚以避免跳变。
 */
function enqueue(task: ICountupTask) {
  if (indexMap.has(task.id)) return; // 已在队列中
  task.from = task._value;
  task._beginAt = $elapsed;
  task._accum = 0;
  task._active = true;
  queue.push(task);
  task._index = queue.length - 1;
  indexMap.set(task.id, task._index);
}

/** 把任务移出活动队列但保留其状态（lazy 任务离开视口时暂停） */
function pause(task: ICountupTask) {
  const index = indexMap.get(task.id);
  if (index !== undefined) dequeue(index);
  task._active = false;
}

/**
 * 彻底销毁任务：从活动队列移出（若在跑）、停止观测、从 taskMap 删除、
 * 触发 onDestory 并释放 el 引用，使任务及其元素可被 GC 回收。
 * 是 remove / clear / once 完成的统一收尾路径。
 */
function destroy(task: ICountupTask) {
  const index = indexMap.get(task.id);
  if (index !== undefined) dequeue(index);
  if (task.lazy && task.observer && task.el) unobserve(task.observer, task.el);
  taskMap.delete(task.id);
  task.onDestory?.(task);
  task.el = undefined;
}

/** lazy 任务的默认 observer 覆盖值（install 时可配置）；未配置则用库内共享默认 */
let _observer: IntersectionObserver | undefined;

/** 不含 formatter / end，须在 add 或 group.config 中提供 formatter */
export const defaults: Required<ICountupBaseOptions> = {
  duration: 1000,
  fps: 30,
  lazy: false,
  once: false,
  // 惰性解析：仅在确有 lazy 任务时才创建默认 IntersectionObserver
  get observer() {
    return _observer ?? defaultObserver();
  },
  set observer(value: IntersectionObserver) {
    _observer = value;
  },
  formatter: buildCountupFmt(new Intl.NumberFormat().format),
  easing: ease.easeCountup,
  render: countupRender,
};

/** 按缓动进度计算当前值 */
function valueAt(task: ICountupTask, progress: number): number {
  return task.from + (task.to - task.from) * task.easing(progress);
}

export function countupRender(el: Element, formatted: string) {
  el.textContent = formatted;
}

export function tick(_elapsed: number, dt: number) {
  $elapsed = _elapsed;
  let task: ICountupTask
  let formatted = ''

  for (let i = queue.length - 1; i >= 0; i--) {
    task = queue[i];
    if (!task._active) continue;

    const progress = Math.min(1, (_elapsed - task._beginAt) / task.duration);

    if (task._interval > 0 && progress < 1) {
      task._accum += dt;
      if (task._accum < task._interval) continue;
      task._accum = 0;
    }

    task._value = valueAt(task, progress);
    formatted = task.fmt(task._value)

    if (progress >= 1) {
      task._value = task.to;
      task.onDone?.(task);
      if (task.el) task.render?.(task.el, task.fmt(task._value));
      // once: 完成即彻底销毁（fire-and-forget，可被 GC 回收）；
      // 否则仅移出活动队列，保留在 taskMap 以便 update 重新入队
      if (task.once) destroy(task);
      else dequeue(i);
      continue;
    }

    task.onUpdate?.(formatted, task._value, task);
    if (task.el) {
      task.render?.(task.el, task.fmt?.(task._value));
    }
  }
}

function install(options?: ICountupBaseOptions): IPlugin {
  Object.assign(defaults, options);
  return {
    name: "count-up",
    install: tick,
  };
}

function add(options: ICountupFullOptions): number {
  const lazy = options.lazy ?? defaults.lazy;
  const task: ICountupTask = {
    _index: 0,
    _accum: 0,
    _active: !lazy,
    _value: options.from ?? 0,
    _beginAt: $elapsed,
    _interval: fps2ms(options.fps ?? defaults.fps),
    _nextAt: $elapsed,
    to: options.to,
    id: id++,
    lazy,
    once: options.once ?? defaults.once,
    duration: options.duration ?? defaults.duration,
    label: options.label,
    el: options.el ? $(options.el) : undefined,
    from: options.from ?? 0,
    easing: options.easing ?? defaults.easing,
    fmt: options.formatter ?? defaults.formatter,
    onDone: options.onDone,
    onUpdate: options.onUpdate,
    onDestory: options.onDestory,
    render: options.render ?? defaults.render,
  };
  taskMap.set(task.id, task)

  // 初始化即按动画相同的取整 + 格式化规则渲染一帧，
  // 避免第一帧 onUpdate 时小数位与初始静态值不一致造成视觉跳跃
  task._value = valueAt(task, 0);
  if (task.el) task.render?.(task.el, task.fmt(task._value));

  if (lazy) {
    // 懒加载：不入队，交给 observer 观测；进入视口才 enqueue，离开则 pause
    if (!task.el) throw new Error("[count-up]: lazy:true 依赖 options.el，请提供目标元素");
    task.observer = options.observer ?? defaults.observer;
    observe(task.observer, task.el, {
      enter: () => enqueue(task),
      leave: () => pause(task),
    });
  } else {
    enqueue(task);
  }

  return task.id
}

function remove(id: number) {
  const task = taskMap.get(id)
  if (task) destroy(task)
}

function clear(label?: string) {
  taskMap.forEach((task) => {
    if (label && task.label !== label) return;
    destroy(task)
  })
}

/**
 * 调整任务的目标值。
 * - 若任务仍在活动队列中：从**当前显示值**平滑过渡到新目标；
 * - 若任务**已完成**并被移出队列：将其重新加入队列，从已完成的终值继续滚动到新目标。
 */
function update(id: number, to: number) {
  const task = taskMap.get(id)
  if (!task) return;

  const active = indexMap.get(id) !== undefined;
  if (active && task.to === to) return; // 正在跑且目标一致，无需变更

  task.to = to;

  if (active) {
    // 正在跑：从当前显示值平滑过渡到新目标，避免数字跳变
    task.from = task._value;
    task._beginAt = $elapsed;
    task._accum = 0;
  } else if (!task.lazy) {
    // 已完成/暂停且非 lazy → 重新入队，从当前值续滚到新目标
    enqueue(task);
  }
  // lazy 且当前不在队列（隐藏中）：仅更新目标，待进入视口由 observer 入队
}

function countup(options: ICountupFullOptions): void;
function countup(to: number, label?: string): void;
function countup(to: number, options?: ICountupBaseOptions): void;
function countup(to: number, from: number, label?: string): void;
function countup(to: number, from: number, options?: ICountupBaseOptions): void;
function countup(
  to: number | ICountupFullOptions,
  fromOrLabel?: number | string | ICountupBaseOptions,
  labelOrOptions?: string | ICountupBaseOptions,
): number {
  const len = arguments.length;

  if (len === 1) {
    if (typeof to === "number") return add({ to: to });
    return add(to);
  }

  // len >= 2 时 a 一定是 number（按重载契约）
  if (typeof to !== "number") return -1;

  if (len === 2) {
    if (typeof fromOrLabel === "number") return add({ from: fromOrLabel, to: to });
    if (typeof fromOrLabel === "string") return add({ to: to, label: fromOrLabel });
    return add({ ...fromOrLabel, to: to });
  }

  // len === 3，b 一定是 number
  if (typeof fromOrLabel !== "number") return -1;
  if (typeof labelOrOptions === "string") return add({ from: to, to: fromOrLabel, label: labelOrOptions });
  return add({ ...labelOrOptions, from: fromOrLabel, to });
}

countup.update = update;
countup.remove = remove;
countup.clear = clear;
countup.defaults = defaults;
countup.install = install;

export default countup;

declare module "../core/types" {
  interface Counter {
    up: typeof countup;
  }
}

