import type { ICountdownOptions, ICountdownContext, ICountdownTask, ICountdownTaskOptions, TCountdownDeadline } from "./types";
import { countdownRender, resolveConfig, resolveDateParser, resolveFormatter, resolveParser } from "./helper";

import { start, use } from "../core";
import type { IPlugin } from "../core/types";
import { $ } from "../helper";
import { createGroupStore, defaultLabel, destroyRender, scheduleStart } from "../groups";

const MS_SECOND = 1000;

export const defaults: Required<Omit<ICountdownOptions, "parser" | "observer">> = {
  // 服务器时间与客户端时间的差值（server - client），用于校正客户端时钟
  timeOffset: 0,
  dateParser: "ms",
  fmt: "HH:mm:ss",
  showMilliseconds: false,
  showDays: true,
  render: countdownRender,
  lazy: true,
  lazyTimeout: 0,
  autoKill: true,
};

/** 释放所有任务（断开 observer、触发 onDestroy、清空队列）并允许重新自举注册——供 counter.destroy() 调用 */
function disposeAll() {
  Array.from(groups.keys()).forEach((label) => clear(label));
  registered = false;
}

// 全局自增任务 id
let uid = 0;
// 元素 → 当前任务 {id,label}：同元素再次 countdown 时先移除旧任务，避免多个倒计时争抢同一元素
const elTask = new WeakMap<Element, { id: number; label: string }>();

// 自举：首次 add 自动注册插件，省去调用方手动 use()，避免"漏 use → 静默不动"
let registered = false;
function ensureRegistered() {
  if (registered) return;
  registered = true;
  use(install());
}

// 分组队列管理（与 count-up 共用脚手架）；remove 仅断开 observer，clear 额外触发 onDestroy
const store = createGroupStore<ICountdownTask, ICountdownOptions>({
  onRemove: (t) => {
    t.cancel?.();
    destroyRender(t.el, t.render); // 释放渲染器(如插件)对该元素的内部引用
    if (t.el) elTask.delete(t.el);
  },
  onClearEach: (t) => {
    t.cancel?.();
    destroyRender(t.el, t.render);
    if (t.el) elTask.delete(t.el);
    // 未激活的 lazy 任务尚未锚定 deadline，剩余时间未知 → 传 0
    const remaining = t.active ? t.deadline - Date.now() : 0;
    t.ctx.remaining = remaining;
    t.ctx.value = t.parser(remaining, t.ctx);
    t.onDestroy?.(remaining, t.ctx);
  },
});
const groups = store.groups;
export const remove = store.remove;
export const clear = store.clear;
export const group = store.group;

function add(deadline: TCountdownDeadline, el: string | Element, label?: string): number;
function add(deadline: TCountdownDeadline, el: string | Element, options?: ICountdownTaskOptions): number;
function add(deadline: TCountdownDeadline, el: string | Element, options?: string | ICountdownTaskOptions): number {
  ensureRegistered(); // 首次 add 自动注册插件，无需调用方手动 use()
  const isLabel = typeof options === "string";
  const lbl = (isLabel ? options : options?.label) ?? defaultLabel;
  const g = group(isLabel ? options : options?.label);

  const { timeOffset, dateParser, fmt, parser, showDays, showMilliseconds, render, label, lazy, observer, lazyTimeout, autoKill, ...hooks } = resolveConfig(defaults, g.config, isLabel ? undefined : options);

  const elRef = $(el);
  // 同元素已有倒计时 → 先移除旧任务，避免两个倒计时争抢同一元素（与 count-up 的"一元素一计数器"一致）
  const prev = elTask.get(elRef);
  if (prev) remove(prev.id, prev.label);

  // deadline 是客户端时钟下的绝对截止时间，每次 tick 用 Date.now() 现算剩余时间。
  // lazy 任务延后到「进入视口」那一刻才锚定：相对时长由此从可见时刻起算，绝对时间戳/Date 则不受影响。
  const anchor = () => resolveDateParser(dateParser)(deadline, timeOffset);
  const active = !lazy; // el 必有（countdown 必传），故 lazy 即待激活
  const fmtFn = resolveFormatter(fmt, showDays, showMilliseconds);
  const parserFn = resolveParser(parser, showDays);

  const ctx: ICountdownContext = {
    el: elRef,
    id: uid,
    deadline: 0,
    remaining: 0,
    value: parserFn(0),
    active,
    paused: false,
    fmt: fmtFn,
    parser: parserFn,
  };

  const task: ICountdownTask = {
    el: elRef,
    deadline: active ? anchor() : 0,
    active,
    started: false,
    paused: false,
    frozen: 0,
    last: -1,
    showMs: showMilliseconds,
    fmt: fmtFn,
    parser: parserFn,
    render,
    autoKill,
    ctx,
    ...hooks,
  };
  ctx.deadline = task.deadline;
  const id = uid;
  g.queue.set(id, task);
  elTask.set(elRef, { id, label: lbl });
  // 进入视口才激活：锚定截止时间（相对时长从可见时刻起算）；超时未见则回收
  task.cancel = scheduleStart(
    active,
    elRef,
    observer,
    () => {
      task.active = true;
      task.ctx.active = true;
      task.deadline = anchor();
      task.ctx.deadline = task.deadline;
      task.last = -1;
    },
    lazyTimeout,
    () => remove(id, lbl),
  );
  return uid++;
}

export function pause(id: number, label = defaultLabel) {
  const t = groups.get(label)?.queue.get(id);
  if (!t || t.paused) return;
  t.frozen = t.active ? t.deadline - Date.now() : 0;
  t.paused = true;
  t.ctx.paused = true;
  t.onPause?.(t.frozen, t.ctx);
}

export function resume(id: number, label = defaultLabel) {
  const t = groups.get(label)?.queue.get(id);
  if (!t || !t.paused) return;
  t.paused = false;
  t.ctx.paused = false;
  if (t.active) {
    t.deadline = Date.now() + t.frozen; // 从暂停时的剩余重锚截止时间
    t.ctx.deadline = t.deadline;
    t.last = -1;
  }
  t.onResume?.(t.frozen, t.ctx);
  start();
}

export function tick(): boolean {
  const now = Date.now();
  let busy = false;
  groups.forEach((g, label) => {
    g.queue.forEach((task, id) => {
      if (!task.active || task.paused || task.done) return; // 未激活 / 暂停 / 已归零保留：跳过且不计 busy
      const remaining = task.deadline - now;
      const ctx = task.ctx;
      ctx.remaining = remaining;
      if (remaining <= 0) {
        ctx.remaining = 0;
        ctx.value = task.parser(0, ctx);
        task.render(task.el, 0, ctx.value, ctx); // 末帧落定（0）
        task.onDone?.(0, ctx);
        // autoKill（默认）：出队并经 onRemove 释放（清元素索引 + 调用渲染器 destroy）；否则保留实例停在 0
        if (task.autoKill) remove(id, label);
        else task.done = true;
        return;
      }
      busy = true;
      // 非毫秒任务只在秒位变化时渲染，每帧只剩一次减法和比较
      if (!task.showMs) {
        const sec = (remaining / MS_SECOND) | 0;
        if (sec === task.last) return;
        task.last = sec;
      }
      // 解析为 [d,h,m,s,ms] 元组（零分配复用）；字符串格式化交给渲染器按需调用 ctx.fmt
      ctx.value = task.parser(remaining, ctx);
      if (!task.started) {
        task.started = true;
        task.onStart?.(remaining, ctx); // 激活后首个渲染帧触发一次
      }
      task.onUpdate?.(remaining, ctx);
      task.render(task.el, remaining, ctx.value, ctx);
    });
  });
  return busy;
}

function install(options?: ICountdownOptions): IPlugin {
  if (options) Object.assign(defaults, options);
  return {
    name: "down",
    install: tick,
    api: counter,
    dispose: disposeAll,
  };
}

const counter = Object.assign(add, { add, remove, clear, group, pause, resume, install, defaults });

export { add, install as register };

export default counter;
