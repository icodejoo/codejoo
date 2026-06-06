import type {
  ICountdownOptions,
  ICountdownTask,
  ICountdownTaskOptions,
  TCountdownValue,
  TEndTime,
} from "./types";
import {
  buildCountdownParser,
  countdownRender,
  resolveDateParser,
  resolveFormatter as resolveFmt,
} from "./helper";

import type { IPlugin } from "../core/types";
import { $ } from "../helper";
import { defaultObserver, observe, unobserve } from "../core/observer";

let _offset = 0;
let lastTickAt = 0;
let tickGap = 0;
let id = 0;
let queue: ICountdownTask[] = []
/** id -> 在 queue 中的下标，仅记录“活动中”（可见）的任务 */
const indexMap = new Map<number, number>()
/** id -> 任务对象，记录所有存活任务（含被 observer 暂停的 lazy 任务） */
const taskMap = new Map<number, ICountdownTask>()

const defaults: Required<ICountdownOptions> & { offset: number } = {
  // 服务器时间与客户端时间的差值(ms)：offset = serverTime - localTime
  get offset() {
    return _offset;
  },
  set offset(value: number) {
    const delta = value - _offset;
    if (!delta) return;
    _offset = value;
    // offset 变化意味着“校正后的当前时间”整体平移了 delta，
    // 已在跑的倒计时需同步校正：剩余时间 -= delta
    syncOffset(delta);
  },
  fmt: "HH:mm:ss",
  resolver: "millseconds",
  parser: buildCountdownParser(),
  render: countdownRender,
};

function each(callback: (task: ICountdownTask) => void) {
  let task: ICountdownTask
  for (let i = queue.length - 1; i >= 0; i--) {
    task = queue[i];
    callback(task)
  }
}

/** 把任务移出队列（swap-remove），同时维护 indexMap，不触发销毁钩子 */
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

/** 把任务加入活动队列开始倒数（普通任务初始化 / lazy 任务进入视口） */
function enqueue(task: ICountdownTask) {
  if (indexMap.has(task.id)) return; // 已在队列中
  task._active = true;
  queue.push(task);
  task._index = queue.length - 1;
  indexMap.set(task.id, task._index);
}

/** 把任务移出活动队列但保留其剩余时间（lazy 任务离开视口时暂停倒数） */
function pause(task: ICountdownTask) {
  const index = indexMap.get(task.id);
  if (index !== undefined) dequeue(index);
  task._active = false;
}

/**
 * 彻底销毁任务：出队、停止观测、从 taskMap 删除、触发 onDestroy 并释放 el 引用，
 * 使其可被 GC 回收。是 remove / clear / autokill 的统一收尾路径。
 */
function destroy(task: ICountdownTask) {
  const index = indexMap.get(task.id);
  if (index !== undefined) dequeue(index);
  if (task.lazy && task.observer && task.el) unobserve(task.observer, task.el);
  taskMap.delete(task.id);
  task.onDestroy?.(task);
  task.el = undefined;
}

/**
 * offset 变化时同步所有倒计时：按差值 delta 校正剩余时间并立即重渲染，
 * 无需等待下一个 tick。
 * @param delta 新旧 offset 之差 (newOffset - oldOffset)
 */
function syncOffset(delta: number) {
  let value: TCountdownValue
  let formatted: string
  // 遍历 taskMap：连暂停中的 lazy 任务也一并校正，避免其再次可见时时间错位
  taskMap.forEach(task => {
    task.cd -= delta;
    if (task.el) {
      value = task.parser(task.cd)
      formatted = task.fmt(value)
      task.render?.(task.el, formatted, value)
    }
  })
}

function tick(elapsed: number, dt: number) {
  tickGap = elapsed - lastTickAt;
  if (tickGap < 1000) return;
  lastTickAt = elapsed;
  let value: TCountdownValue
  let formatted: string
  each(task => {
    task.cd -= tickGap;
    value = task.parser(task.cd)
    formatted = task.fmt(value)

    if (task.cd <= 0) {
      task.onDone?.(task);
      if (task.autokill) {
        remove(task.id)
      }
    } else {
      task.onUpdate?.(formatted, value, task);
    }
    if (task.el) {
      task.render?.(task.el, formatted, value);
    }
  })
}

function remove(id: number) {
  const task = taskMap.get(id)
  if (task) destroy(task)
}

function clear(label?: string) {
  // 遍历 taskMap：含暂停中的 lazy 任务都能被清理
  taskMap.forEach(task => {
    if (label && task.label !== label) return;
    destroy(task)
  })
}

function install(options?: ICountdownOptions): IPlugin {
  Object.assign(defaults, options)
  return {
    name: "count-down",
    install: tick,
  };
}

function countdown(options: ICountdownTaskOptions | TEndTime, label?: string): number {
  if (typeof options === 'object' && !(options instanceof Date)) {
    options = { ...defaults, ...options }
  } else {
    options = {
      ...defaults,
      endTime: options,
    }
  }

  const ts = resolveDateParser(options.resolver!)(options.endTime);
  const lazy = options.lazy ?? false
  const task: ICountdownTask = {
    ...(options as Required<ICountdownOptions>),
    _index: 0,
    _active: !lazy,
    id: id++,
    el: options.el ? $(options.el) : undefined,
    // 剩余 = 目标时间 - 校正后的当前时间(localNow + offset)，再补偿一帧 tickGap
    cd: ts - Date.now() - _offset + tickGap,
    label: label ?? options.label,
    autokill: options.autokill ?? false,
    lazy,
    fmt: resolveFmt(options.fmt!),
    // render: options.render!,
    // parser: options.parser!,

    // onDestroy:options.onDestroy,
    // onDone:options.onDone,
    // onPause:options.onPause,
    // onResume:options.onResume,
    // onStart:options.onStart,
    // onStop:options.onStop,
    // onUpdate:options.onUpdate,
  }

  if (task.lazy && !task.el) {
    throw new Error('options.lazy:true dependen on options.el,please check your options')
  }

  taskMap.set(task.id, task)

  // 初始化即渲染一帧，避免入队/进入视口前元素为空
  if (task.el) {
    const value = task.parser(task.cd)
    task.render?.(task.el, task.fmt(value), value)
  }

  if (task.lazy) {
    // 懒加载：不入队，交给 observer 观测；进入视口才 enqueue，离开则 pause
    task.observer = options.observer ?? defaultObserver();
    observe(task.observer, task.el!, {
      enter: () => enqueue(task),
      leave: () => pause(task),
    })
  } else {
    enqueue(task)
  }
  return task.id
}

countdown.remove = remove;
countdown.clear = clear;
countdown.install = install;
countdown.defauls = defaults;

export default countdown;

declare module "../core/types" {
  interface Counter {
    down: typeof countdown;
  }
}

// function resolveFormatter(){}