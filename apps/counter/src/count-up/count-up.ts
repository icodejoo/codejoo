import type { IPlugin } from "../core/types";
import { start, use } from "../core";
import { $ } from "../helper";
import { createGroupStore, defaultLabel, destroyRender, scheduleStart } from "../groups";
import { buildCountupFormatter, ease } from "./helper";
import type { ICountupBaseOptions, ICountupRenderContext, ICountupTask, ICountupFullOptions } from "./type";

// 全局自增任务 id
let uid = 0;
// 最近一帧的 RAF 时间戳，供 pause 记录、resume 时按暂停时长平移 startAt
let lastElapsed = 0;
// 元素 → 上次动画结束时的末值，供"结束后再次 count-up"从该值续接（WeakMap：元素回收即释放，无泄漏）
const lastValue = new WeakMap<Element, number>();
// 元素 → 当前活动任务，供"同元素再次 count-up 原地重定目标"O(1) 命中（取代全量扫描）
const elTask = new WeakMap<Element, ICountupTask>();

// fps → 节流间隔(ms)；0 表示每帧
const fpsToMs = (fps: number) => (fps > 0 ? (1000 / fps) | 0 : 0);

// 自举：首次 add 时把自身作为插件注册进核心，省去调用方手动 use()，避免"漏 use → 静默不动"
let registered = false;
function ensureRegistered() {
  if (registered) return;
  registered = true;
  use(install());
}

export function countupRender(el: Element, value: number, ctx?: ICountupRenderContext) {
  el.textContent = ctx ? ctx.fmt(value, ctx) : String(value);
}

export const defaults: Required<Omit<ICountupBaseOptions, "observer">> = {
  duration: 1000,
  fps: 60,
  fmt: buildCountupFormatter(new Intl.NumberFormat()),
  easing: ease.easeCountup,
  render: countupRender,
  lazy: true,
  lazyTimeout: 0,
  autoKill: true,
};

/** 释放所有任务（断开 observer、清空队列）并允许重新自举注册——供 counter.destroy() 调用 */
function disposeAll() {
  Array.from(groups.keys()).forEach((label) => clear(label));
  registered = false;
}

// 分组队列管理（与 count-down 共用脚手架）；移除任务时断开 observer、记录末值、清理元素索引
const store = createGroupStore<ICountupTask, ICountupBaseOptions>({
  onRemove: (t) => {
    t.cancel?.();
    destroyRender(t.el, t.render); // 释放渲染器(如插件)对该元素的内部引用
    if (t.el) {
      lastValue.set(t.el, t.value);
      elTask.delete(t.el);
    }
  },
});
const groups = store.groups;
export const group = store.group;
export const clear = store.clear;

export const remove = store.remove;

export function pause(id: number, label = defaultLabel) {
  const t = groups.get(label)?.queue.get(id);
  if (!t || t.paused) return;
  t.paused = true;
  t.ctx.paused = true;
  t.pausedElapsed = lastElapsed;
  t.onPause?.(t.value, t.ctx);
}

export function resume(id: number, label = defaultLabel) {
  const t = groups.get(label)?.queue.get(id);
  if (!t || !t.paused) return;
  t.paused = false;
  t.ctx.paused = false;
  t.resuming = true; // 下一帧补偿暂停时长
  t.onResume?.(t.value, t.ctx);
  start();
}

export function tick(elapsed: number, dt: number): boolean {
  lastElapsed = elapsed;
  let busy = false;
  for (const g of groups.values()) {
    for (const [id, task] of g.queue) {
      if (!task.active || task.paused || task.done) continue; // 未激活 / 暂停 / 已完成保留：跳过且不计 busy
      if (task.resuming) {
        // 把暂停期间流逝的时间平移进 startAt，进度从暂停点无缝继续；
        // 若任务在从未真正开始（startAt 仍是哨兵值 -1）时就被 pause→resume，不平移，
        // 让下面的 "startAt < 0" 分支把本帧当作真正的起点（否则会平移出一个很小的 startAt，
        // 导致 progress 用当前巨大的 elapsed 一算就 ≥1，动画瞬间跳到终值）
        if (task.startAt >= 0) task.startAt += elapsed - task.pausedElapsed;
        task.resuming = false;
      }
      if (task.startAt < 0) {
        task.startAt = elapsed;
        task.accum = 0;
        task.ctx.value = task.value;
        task.onStart?.(task.value, task.ctx); // 本轮动画首帧触发一次
      }

      // duration<=0 视为瞬时完成，避免除零/负时长导致 NaN 或永不结束
      const progress = task.duration > 0 ? Math.min(1, (elapsed - task.startAt) / task.duration) : 1;

      if (progress < 1) {
        busy = true;
        if (task.interval > 0) {
          task.accum += dt;
          if (task.accum < task.interval) continue;
          // 保留余量而非清零，避免节流相位漂移
          task.accum -= task.interval;
        }
        task.value = task.from + (task.to - task.from) * task.easing(progress);
        task.ctx.value = task.value;
        task.onUpdate?.(task.value, task.ctx);
      } else {
        task.value = task.to;
        task.ctx.value = task.value;
        if (task.el) task.render(task.el, task.value, task.ctx); // 末值先落定
        task.onDone?.(task.value, task.ctx);
        // autoKill（默认）：出队并经 onRemove 释放（记录末值 + 清元素索引 + 调用渲染器 destroy）；
        // 否则保留实例停在末值，标记 done 跳过后续帧（可手动 remove 或同元素重定目标）
        if (task.autoKill) remove(id, task.label);
        else task.done = true;
        continue;
      }
      if (task.el) {
        // 不预格式化：传原始 value，渲染器需要字符串时自行 ctx.fmt(value)
        task.render(task.el, task.value, task.ctx);
      }
    }
  }
  return busy;
}

function install(options?: ICountupBaseOptions): IPlugin {
  if (options) Object.assign(defaults, options);
  return {
    name: "up",
    install: tick,
    api: counter,
    dispose: disposeAll,
  };
}

function addTask(options: ICountupFullOptions): number {
  ensureRegistered(); // 首次 add 自动注册插件，无需调用方手动 use()
  const g = group(options.label);
  const el = options.el ? $(options.el) : undefined;

  // 同元素已有任务（一个元素=一个计数器）→ 原地重定目标，从当前值丝滑续接（除非显式传了 from）。
  // 用 elTask 索引 O(1) 命中（跨分组，label 不一致也命中，避免误建竞争任务）。
  if (el) {
    const existing = elTask.get(el);
    if (existing) {
      const merged = { ...defaults, ...groups.get(existing.label!)?.config, ...options };
      const prevRender = existing.render;
      existing.from = options.from ?? existing.value; // 缺省从当前值起，无跳变
      existing.value = existing.from;
      existing.to = merged.to;
      existing.duration = merged.duration;
      existing.easing = merged.easing;
      existing.fps = merged.fps;
      existing.interval = fpsToMs(merged.fps);
      existing.fmt = merged.fmt;
      existing.render = merged.render;
      if (prevRender !== existing.render) destroyRender(el, prevRender); // 换渲染器前先释放旧渲染器对该元素的内部引用
      existing.lazy = merged.lazy;
      existing.lazyTimeout = merged.lazyTimeout;
      existing.onStart = options.onStart;
      existing.onUpdate = options.onUpdate;
      existing.onDone = options.onDone;
      existing.onPause = options.onPause;
      existing.onResume = options.onResume;
      existing.autoKill = merged.autoKill;
      existing.startAt = -1; // 重新计时
      existing.accum = 0;
      existing.done = false; // 复活保留的已完成实例
      existing.paused = false;
      existing.resuming = false;
      existing.ctx.paused = false;
      existing.ctx.from = existing.from;
      existing.ctx.to = existing.to;
      existing.ctx.value = existing.value;
      existing.ctx.fmt = existing.fmt;
      if (!existing.active) {
        // 仍是待激活的懒任务（尚未进入视口）：旧的 scheduleStart 挂钩（含其 lazyTimeout 定时器）
        // 仍会用旧配置在到期后 remove(existing.id)，误杀刚被重定目标的任务，须先取消再按新配置重挂
        existing.cancel?.();
        const active = !(merged.lazy && el);
        existing.active = active;
        existing.ctx.active = active;
        existing.cancel = scheduleStart(
          active,
          el,
          merged.observer,
          () => {
            existing.active = true;
            existing.ctx.active = true;
            existing.startAt = -1;
            existing.accum = 0;
          },
          merged.lazyTimeout,
          () => remove(existing.id, existing.label),
        );
      }
      start();
      return existing.id;
    }
  }

  // 新任务起点：显式 from > 该元素上次的末值（结束后续接）> 0
  const begin = options.from ?? (el && lastValue.get(el)) ?? 0;
  // lazy 且有 el → 待激活（进入视口才开始）；否则立即激活
  const lazy = options.lazy ?? g.config?.lazy ?? defaults.lazy;
  const observer = options.observer ?? g.config?.observer;
  const timeout = options.lazyTimeout ?? g.config?.lazyTimeout ?? defaults.lazyTimeout;
  const active = !(lazy && el);
  const task: ICountupTask = {
    ...defaults,
    ...g.config,
    ...options,
    label: options.label ?? defaultLabel,
    el,
    from: begin,
    value: begin,
    id: uid,
    accum: 0,
    startAt: -1,
    interval: 0,
    active,
    paused: false,
    pausedElapsed: 0,
    resuming: false,
    ctx: undefined as unknown as ICountupTask["ctx"],
  };
  task.interval = fpsToMs(task.fps);
  // 上下文复用同一对象，from/to/fmt/el/id 任务期内固定，仅 value/active/paused 变化
  task.ctx = { value: task.value, from: task.from, to: task.to, fmt: task.fmt, el, id: task.id, active, paused: false };
  g.queue.set(uid, task);
  if (el) elTask.set(el, task); // 建立元素→任务索引，供后续 O(1) 重定
  // 进入视口才激活：重新锚定计时（startAt=-1），动画从可见那一刻开始
  task.cancel = scheduleStart(
    active,
    el,
    observer,
    () => {
      task.active = true;
      task.ctx.active = true;
      task.startAt = -1;
      task.accum = 0;
    },
    timeout,
    () => remove(task.id, task.label),
  );
  return uid++;
}
function add(options: ICountupFullOptions): number;
function add(to: number, label?: string): number;
function add(to: number, options?: ICountupBaseOptions): number;
function add(from: number, to: number, label?: string): number;
function add(from: number, to: number, options?: ICountupBaseOptions): number;
function add(a: number | ICountupFullOptions, b?: number | string | ICountupBaseOptions, c?: string | ICountupBaseOptions): number {
  const len = arguments.length;

  if (len === 1) {
    if (typeof a === "number") return addTask({ to: a });
    return addTask(a);
  }

  // len >= 2 时 a 一定是 number（按重载契约）
  if (typeof a !== "number") throw new TypeError("[GT]: Invalid count-up arguments");

  if (len === 2) {
    if (typeof b === "number") return addTask({ from: a, to: b });
    if (typeof b === "string") return addTask({ to: a, label: b });
    return addTask({ ...b, to: a });
  }

  // len === 3，b 一定是 number
  if (typeof b !== "number") throw new TypeError("[GT]: Invalid count-up arguments");
  if (typeof c === "string") return addTask({ from: a, to: b, label: c });
  return addTask({ ...c, from: a, to: b });
}

const counter = Object.assign(add, { add, remove, clear, group, pause, resume, install, defaults });

export { add, install as register };

export default counter;
