import type { IPlugin } from "../core/types";
import { start, use } from "../core";
import { fpsToInterval, throttle } from "../core/throttle";
import { $, FRAME_WINDOW, watchOffscreen } from "../helper";
import { isHidden } from "../core/clock";
import { createGroupStore, defaultLabel, destroyRender, isLifecycleRenderer, reportTaskError, restoreDefaults, scheduleStart } from "../groups";
import { buildCountupFormatter, ease } from "./helper";
import type { ICountupBaseOptions, ICountupRenderContext, ICountupTask, ICountupFullOptions, ICountupRenderer } from "./type";

// 全局自增任务 id
let uid = 0;
// 最近一帧的 RAF 时间戳，供 pause 记录、resume 时按暂停时长平移 startAt
let lastElapsed = 0;
// 元素 → 上次动画结束时的末值，供"结束后再次 count-up"从该值续接（WeakMap：元素回收即释放，无泄漏）
const lastValue = new WeakMap<Element, number>();
// 元素 → 当前活动任务，供"同元素再次 count-up 原地重定目标"O(1) 命中（取代全量扫描）
const elTask = new WeakMap<Element, ICountupTask>();

// 最近一次 tick 汇总：是否有任务需要逐帧（needFrame），以及仅静音任务时最早的到点延迟(ms)（nextWake）
let needFrame = false;
let nextWake = Infinity;

/** 为带元素的任务挂离屏观察（muteHidden 时）：离开视口 → 静音；回到视口立即唤醒循环刷新 */
function ensureWatch(task: ICountupTask) {
  if (!task.el || !task.muteHidden || task.unwatch) return;
  task.unwatch = watchOffscreen(task.el, (offscreen) => {
    const was = task.offscreen;
    task.offscreen = offscreen;
    if (was && !offscreen) start();
  });
}

function isLifecycleRender(r: unknown): r is ICountupRenderer {
  return isLifecycleRenderer(r);
}

function bindLifecycle<S>(r: ICountupRenderer<S>, el: Element, ctx: ICountupRenderContext) {
  const state = r.mount(el, ctx);
  return {
    update: (v: number, c: ICountupRenderContext) => r.update(state, v, c),
    destroy: () => r.destroy(state),
  };
}

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
  fps: 0,
  fmt: buildCountupFormatter(new Intl.NumberFormat()),
  easing: ease.easeCountup,
  render: countupRender,
  lazy: true,
  lazyTimeout: 0,
  autoKill: true,
  muteHidden: true,
};

// 出厂默认值快照，供 resetDefaults() 还原
const FACTORY_DEFAULTS = { ...defaults };


/** 释放所有任务（断开 observer、清空队列）并允许重新自举注册——供 counter.destroy() 调用 */
function disposeAll() {
  Array.from(groups.keys()).forEach((label) => clear(label));
  registered = false;
}

// 分组队列管理（与 count-down 共用脚手架）；移除任务时断开 observer、记录末值、清理元素索引
const store = createGroupStore<ICountupTask, ICountupBaseOptions>({
  onRemove: (t) => {
    t.cancel?.();
    t.unwatch?.();
    t.unwatch = undefined;
    if (t.renderBound !== undefined) t.renderBound?.destroy();
    else destroyRender(t.el, t.render);
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
  if (!t || t.paused || t.done) return;
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

export function tick(elapsed: number): boolean {
  lastElapsed = elapsed;
  const hidden = isHidden();
  let busy = false; // 有任务需要逐帧
  let alive = false; // 有任务存活（含仅静音、只等到点的）
  let wake = Infinity;
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
        task.nextAt = 0;
        task.ctx.value = task.value;
        task.onStart?.(task.value, task.ctx); // 本轮动画首帧触发一次
      }

      // duration<=0 视为瞬时完成，避免除零/负时长导致 NaN 或永不结束
      const progress = task.duration > 0 ? Math.min(1, (elapsed - task.startAt) / task.duration) : 1;

      if (progress < 1) {
        alive = true;
        if (task.muteHidden && (hidden || task.offscreen)) {
          // 静音：不渲染不回调，进度照常按时间推进；只需在完成时刻醒来，解除静音后下一帧立即刷新
          task.wasMuted = true;
          const w = task.duration - (elapsed - task.startAt);
          if (w < wake) wake = w;
          continue;
        }
        if (task.wasMuted) {
          task.wasMuted = false;
          task.nextAt = 0; // 重起网格，让本帧立即渲染
        }
        const wait = throttle(task, elapsed);
        if (wait > 0) {
          // 节流未到点：不逐帧空转，睡到下个节流点或完成时刻（取更早者）
          const w = Math.min(wait, task.duration - (elapsed - task.startAt));
          if (w < wake) wake = w;
          continue;
        }
        busy = true;
        task.value = task.from + (task.to - task.from) * task.easing(progress);
        task.ctx.value = task.value;
        try {
          task.onUpdate?.(task.value, task.ctx);
        } catch (err) {
          reportTaskError(err);
        }
      } else {
        task.value = task.to;
        task.ctx.value = task.value;
        // 回调抛错只上报：后续出队/置 done 必须照常执行，否则任务会逐帧重复触发 onDone
        try {
          if (task.el) task.render(task.el, task.value, task.ctx); // 末值先落定
        } catch (err) {
          reportTaskError(err);
        }
        try {
          task.onDone?.(task.value, task.ctx);
        } catch (err) {
          reportTaskError(err);
        }
        if (task.startAt < 0) {
          // onDone 回调里已对同元素重新 countup()（原地重定目标，startAt 被重置）：保留并继续推进，本帧仍算忙碌
          busy = true;
          alive = true;
          continue;
        }
        // autoKill（默认）：出队并经 onRemove 释放（记录末值 + 清元素索引 + 调用渲染器 destroy）；
        // 否则保留实例停在末值，标记 done 跳过后续帧（可手动 remove 或同元素重定目标）
        if (task.autoKill) remove(id, task.label);
        else task.done = true;
        continue;
      }
      if (task.el) {
        // 不预格式化：传原始 value，渲染器需要字符串时自行 ctx.fmt(value)
        try {
          task.render(task.el, task.value, task.ctx);
        } catch (err) {
          reportTaskError(err); // 单任务 render 抛错不饿死同组兄弟
        }
      }
    }
  }
  needFrame = busy;
  nextWake = wake;
  return alive || busy;
}

/** 供核心调度使用：需要逐帧返回 true，只剩静音任务时返回到点延迟(ms)（休眠），空闲返回 false */
function schedule(elapsed: number): boolean | number {
  if (!tick(elapsed)) return false;
  if (needFrame) return true;
  return nextWake > FRAME_WINDOW ? Math.ceil(nextWake) : true;
}

function install(options?: ICountupBaseOptions): IPlugin {
  if (options) Object.assign(defaults, options);
  return {
    name: "up",
    install: schedule,
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
      const merged = { ...defaults, ...g.config, ...options };
      const prevRender = existing.render;
      const prevRenderBound = existing.renderBound;
      existing.from = options.from ?? existing.value; // 缺省从当前值起，无跳变
      existing.value = existing.from;
      existing.to = merged.to;
      existing.duration = merged.duration;
      existing.easing = merged.easing;
      existing.fps = merged.fps;
      existing.interval = fpsToInterval(merged.fps);
      existing.fmt = merged.fmt;
      existing.lazy = merged.lazy;
      existing.lazyTimeout = merged.lazyTimeout;
      existing.onStart = options.onStart;
      existing.onUpdate = options.onUpdate;
      existing.onDone = options.onDone;
      existing.onPause = options.onPause;
      existing.onResume = options.onResume;
      existing.autoKill = merged.autoKill;
      existing.muteHidden = merged.muteHidden; // 重定目标必有元素
      existing.wasMuted = false;
      ensureWatch(existing);
      existing.startAt = -1; // 重新计时
      existing.nextAt = 0;
      existing.done = false; // 复活保留的已完成实例
      existing.paused = false;
      existing.resuming = false;
      // ctx 先同步，再切换渲染器——确保 lifecycle mount() 拿到最新的 from/to/fmt
      existing.ctx.paused = false;
      existing.ctx.from = existing.from;
      existing.ctx.to = existing.to;
      existing.ctx.value = existing.value;
      existing.ctx.fmt = existing.fmt;
      // 渲染器切换：lifecycle ↔ function 都需先释放旧绑定，再挂新适配器
      const newLifecycle = isLifecycleRender(merged.render) ? merged.render : null;
      if (newLifecycle) {
        if (prevRenderBound !== undefined) prevRenderBound?.destroy();
        else destroyRender(el, prevRender);
        existing.render = (_el2, v, c) => existing.renderBound?.update(v, c);
        existing.renderBound = existing.active ? bindLifecycle(newLifecycle, el, existing.ctx) : null;
      } else {
        existing.render = (merged.render as ICountupTask["render"]) ?? countupRender;
        if (prevRenderBound !== undefined) {
          prevRenderBound?.destroy();
          existing.renderBound = undefined;
        } else if (prevRender !== existing.render) {
          destroyRender(el, prevRender);
        }
      }
      if (!existing.active) {
        // 仍是待激活的懒任务（尚未进入视口）：旧的 scheduleStart 挂钩（含其 lazyTimeout 定时器）
        // 仍会用旧配置在到期后 remove(existing.id)，误杀刚被重定目标的任务，须先取消再按新配置重挂
        existing.cancel?.();
        const active = !(merged.lazy && el);
        existing.active = active;
        existing.ctx.active = active;
        // 旧任务未激活时 renderBound 被置为 null；重定为立即激活后 scheduleStart 不会再调 onActivate，需在此直接挂载
        if (active && newLifecycle && existing.renderBound === null) {
          existing.renderBound = bindLifecycle(newLifecycle, el, existing.ctx);
        }
        existing.cancel = scheduleStart(
          active,
          el,
          merged.observer,
          () => {
            existing.active = true;
            existing.ctx.active = true;
            existing.startAt = -1;
            existing.nextAt = 0;
            if (newLifecycle && existing.renderBound === null) {
              existing.renderBound = bindLifecycle(newLifecycle, el, existing.ctx);
            }
          },
          merged.lazyTimeout,
          () => remove(existing.id, existing.label),
        );
      }
      // 若 label 发生变化，迁移任务到新分组（g 已是目标分组）
      const newLabel = options.label ?? existing.label;
      if (newLabel !== existing.label) {
        const oldG = groups.get(existing.label)!; // 任务仍在队列里，其分组必然存在
        oldG.queue.delete(existing.id);
        if (oldG.queue.size === 0 && existing.label !== defaultLabel) groups.delete(existing.label);
        existing.label = newLabel;
        g.queue.set(existing.id, existing);
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
  const taskId = uid;
  const interval = fpsToInterval(options.fps ?? g.config?.fps ?? defaults.fps);
  const fmt = options.fmt ?? g.config?.fmt ?? defaults.fmt;
  const optRender = options.render ?? g.config?.render ?? defaults.render;
  const lifecycle = isLifecycleRender(optRender) ? optRender : null;
  const task: ICountupTask = {
    ...defaults,
    ...g.config,
    ...options,
    render: countupRender, // lifecycle: adapter 覆写于下方；function: 同样覆写于下方
    label: options.label ?? defaultLabel,
    el,
    from: begin,
    value: begin,
    id: taskId,
    nextAt: 0,
    startAt: -1,
    interval,
    active,
    paused: false,
    pausedElapsed: 0,
    resuming: false,
    offscreen: false,
    wasMuted: false,
    renderBound: lifecycle ? null : undefined,
    // 上下文复用同一对象，from/to/fmt/el/id 任务期内固定，仅 value/active/paused 变化
    ctx: { value: begin, from: begin, to: options.to, fmt, el, id: taskId, active, paused: false },
  };
  // 无元素的任务是纯数据补间（只有回调，没有可见输出），不应因页面隐藏 / 离屏被静音
  task.muteHidden = task.muteHidden && el !== undefined;
  // render 赋值统一在此，避免字面量内出现死代码分支
  if (lifecycle) {
    task.render = (_el2, v, c) => task.renderBound?.update(v, c);
    if (active && el) task.renderBound = bindLifecycle(lifecycle, el, task.ctx);
  } else {
    task.render = optRender as ICountupTask["render"]; // optRender 已回退到 defaults.render，必有值
  }
  // 非 lazy 且有挂载元素：立即渲染初始值，不等第一帧 RAF
  if (active && el) task.render(el, task.value, task.ctx);
  g.queue.set(uid, task);
  if (el) elTask.set(el, task); // 建立元素→任务索引，供后续 O(1) 重定
  ensureWatch(task);
  // 进入视口才激活：重新锚定计时（startAt=-1），动画从可见那一刻开始
  task.cancel = scheduleStart(
    active,
    el,
    observer,
    () => {
      task.active = true;
      task.ctx.active = true;
      task.startAt = -1;
      task.nextAt = 0;
      if (lifecycle && task.renderBound === null && el) {
        task.renderBound = bindLifecycle(lifecycle, el, task.ctx);
      }
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

/** 把全局 defaults 还原为出厂值（不影响已创建的任务与分组配置） */
export function resetDefaults() {
  restoreDefaults(defaults, FACTORY_DEFAULTS);
}

const counter = Object.assign(add, { add, remove, clear, group, pause, resume, install, defaults, resetDefaults });

export { add, install as register };

export default counter;
