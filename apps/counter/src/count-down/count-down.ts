import type { ICountdownOptions, ICountdownContext, ICountdownTask, ICountdownTaskOptions, ICountdownRenderer, TCountdownDeadline, TCountdownValue } from "./types";
import { copyCountdownValue, countdownRender, isRelativeDuration, resolveConfig, resolveDateParser, resolveFormatter, resolveParser, snapshotValue } from "./helper";

import { start, use } from "../core";
import { fpsToInterval, throttle, untilNext } from "../core/throttle";
import type { IPlugin } from "../core/types";
import { $, FRAME_WINDOW, watchOffscreen } from "../helper";
import { isHidden, monoNow } from "../core/clock";
import { createGroupStore, defaultLabel, destroyRender, isLifecycleRenderer, reportTaskError, restoreDefaults, scheduleStart } from "../groups";

const MS_SECOND = 1000;
// 限帧网格容差（ms）：约半个 60Hz vsync，距离网格点不足它就视为到点，避免 vsync 抖动把 30fps 压成 20fps
// 最近一次 tick 汇总出的"最早需要再处理的延迟(ms)"；Infinity 表示没有按时间唤醒的任务
let nextWake = Infinity;

/** 任务 deadline 所在时钟的当前读数：单调钟或墙钟 */
function clockOf(t: { mono: boolean }): number {
  return t.mono ? monoNow() : Date.now();
}

/** 把任务的 deadline 换算成墙钟时间戳，供 ctx.deadline 对外展示 */
function wallDeadline(t: ICountdownTask): number {
  return t.mono ? Date.now() + (t.deadline - monoNow()) : t.deadline;
}

function isLifecycleRender(r: unknown): r is ICountdownRenderer {
  return isLifecycleRenderer(r);
}

function bindLifecycle<S>(r: ICountdownRenderer<S>, el: Element, ctx: ICountdownContext) {
  const state = r.mount(el, ctx);
  return {
    update: (rem: number, v: TCountdownValue, c: ICountdownContext) => r.update(state, rem, v, c),
    destroy: () => r.destroy(state),
  };
}

/** 挂载 lifecycle 渲染器：mount 前按同一剩余时间刷新 ctx.remaining / ctx.value，避免首帧读到全零元组 */
function mountLifecycle(lifecycle: ICountdownRenderer, task: ICountdownTask, remaining: number) {
  const ctx = task.ctx;
  ctx.remaining = remaining;
  ctx.value = task.parser(remaining, ctx);
  return bindLifecycle(lifecycle, task.el, ctx);
}

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
  fps: 0,
  muteHidden: true,
};

// 出厂默认值快照，供 resetDefaults() 还原
const FACTORY_DEFAULTS = { ...defaults };


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

/** 释放单个任务：断开 observer、销毁渲染器、清元素索引（remove 与 clear 共用） */
function releaseTask(t: ICountdownTask) {
  t.cancel?.();
  t.unwatch?.();
  if (t.renderBound !== undefined) t.renderBound?.destroy();
  else destroyRender(t.el, t.render);
  elTask.delete(t.el);
}

// 分组队列管理（与 count-up 共用脚手架）；remove 仅断开 observer，clear 额外触发 onDestroy
const store = createGroupStore<ICountdownTask, ICountdownOptions>({
  onRemove: releaseTask,
  onClearEach: (t) => {
    releaseTask(t);
    // 暂停中的任务用冻结的剩余时间（暂停期间流逝的时间不扣）；未激活的 lazy 任务尚未锚定 deadline，剩余时间未知 → 传 0；active 但已过期时钳到 0
    const remaining = t.paused ? t.frozen : t.active ? Math.max(0, t.deadline - clockOf(t)) : 0;
    t.ctx.remaining = remaining;
    snapshotValue(t.ctx.oldValue, t.ctx.value);
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
  const g = group(lbl);

  const { timeOffset, dateParser, fmt, parser, showDays, showMilliseconds, render, label, lazy, observer, lazyTimeout, autoKill, fps, muteHidden, ...hooks } = resolveConfig(
    defaults,
    g.config,
    isLabel ? undefined : options,
  );

  const elRef = $(el);
  // 同元素已有倒计时 → 先移除旧任务，避免两个倒计时争抢同一元素（与 count-up 的"一元素一计数器"一致）
  const prev = elTask.get(elRef);
  if (prev) remove(prev.id, prev.label);

  // 相对时长（如 60000）锚在单调钟上，不受系统改时影响；绝对时间戳 / Date / 日期字符串 / 自定义解析器锚在墙钟。
  // 每次 tick 现算剩余时间。lazy 任务延后到「进入视口」那一刻才锚定：相对时长由此从可见时刻起算，绝对时间则不受影响。
  const rel = isRelativeDuration(deadline, dateParser);
  const clockNow = () => (rel ? monoNow() : Date.now());
  const anchor = () => {
    const abs = resolveDateParser(dateParser)(deadline, timeOffset);
    return rel ? monoNow() + (abs - Date.now()) : abs;
  };
  const active = !lazy; // el 必有（countdown 必传），故 lazy 即待激活
  const fmtFn = resolveFormatter(fmt, showDays, showMilliseconds);
  const parserFn = resolveParser(parser, showDays);

  const initValue = parserFn(0);
  const ctx: ICountdownContext = {
    el: elRef,
    id: uid,
    deadline: 0,
    remaining: 0,
    value: initValue,
    oldValue: copyCountdownValue(initValue),
    active,
    paused: false,
    fmt: fmtFn,
    parser: parserFn,
  };

  const lifecycle = isLifecycleRender(render) ? render : null;

  const task: ICountdownTask = {
    el: elRef,
    deadline: active ? anchor() : 0,
    mono: rel,
    muteHidden,
    offscreen: false,
    wasMuted: false,
    interval: fpsToInterval(fps),
    nextAt: 0,
    active,
    started: false,
    paused: false,
    frozen: 0,
    last: -1,
    showMs: showMilliseconds,
    fmt: fmtFn,
    parser: parserFn,
    render: lifecycle ? countdownRender : ((render as ICountdownTask["render"]) ?? countdownRender),
    renderBound: lifecycle ? null : undefined,
    autoKill,
    ctx,
    ...hooks,
  };
  // adapter 引用 task.renderBound（运行时），必须在 task 建好后设置，避免 TDZ 陷阱
  if (lifecycle) task.render = (_el, rem, val, c) => task.renderBound?.update(rem, val, c);
  ctx.deadline = active ? wallDeadline(task) : 0;

  if (lifecycle && active) {
    // lifecycle：ctx 就绪，立即 mount（mount 内部完成首帧渲染）
    task.renderBound = mountLifecycle(lifecycle, task, Math.max(0, task.deadline - clockNow()));
  }

  const id = uid;
  // remove(prev) 可能把刚清空的同名非默认分组从 groups 里删掉，而上面拿到的 g 已脱离 groups：
  // 此时 groups 里没有该 label 就把 g 挂回（保留其 config）；若已有同名分组（如 renderer.destroy 回调里重入新建的），入队到它，不覆盖，避免新任务落入孤儿队列永不 tick
  let target = groups.get(lbl);
  if (!target) {
    groups.set(lbl, g);
    target = g;
  }
  target.queue.set(id, task);
  elTask.set(elRef, { id, label: lbl });
  // 进入视口才激活：锚定截止时间（相对时长从可见时刻起算）；超时未见则回收
  task.cancel = scheduleStart(
    active,
    elRef,
    observer,
    () => {
      task.active = true;
      task.ctx.active = true;
      if (task.paused) {
        // 懒任务在暂停期间进入视口：此刻不落定 deadline（避免暂停期间截止时间静默流逝），
        // 只记下"此刻开始的剩余时长"，真正的 deadline 留到 resume() 时按 frozen 重锚
        task.frozen = Math.max(0, anchor() - clockNow());
        if (lifecycle && task.renderBound === null) task.renderBound = mountLifecycle(lifecycle, task, task.frozen);
        return;
      }
      task.deadline = anchor();
      task.ctx.deadline = wallDeadline(task);
      task.last = -1;
      if (lifecycle && task.renderBound === null) task.renderBound = mountLifecycle(lifecycle, task, Math.max(0, task.deadline - clockNow()));
    },
    lazyTimeout,
    () => remove(id, lbl),
  );
  // 离开视口时静音（页面隐藏由 tick 读全局可见性）；重新进入视口立即唤醒循环刷新
  if (muteHidden) {
    task.unwatch = watchOffscreen(elRef, (offscreen) => {
      const was = task.offscreen;
      task.offscreen = offscreen;
      if (was && !offscreen) start();
    });
  }
  return uid++;
}

export function pause(id: number, label = defaultLabel) {
  const t = groups.get(label)?.queue.get(id);
  if (!t || t.paused || t.done) return;
  t.frozen = t.active ? Math.max(0, t.deadline - clockOf(t)) : 0;
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
    // 暂停恢复后一律按单调钟重锚：恢复前后的系统改时都不影响剩余
    t.mono = true;
    t.deadline = monoNow() + t.frozen;
    t.ctx.deadline = wallDeadline(t);
    t.last = -1;
  }
  t.onResume?.(t.frozen, t.ctx);
  start();
}

export function tick(): boolean {
  const wall = Date.now();
  const mono = monoNow();
  const hidden = isHidden();
  let busy = false;
  let wake = Infinity;
  for (const [label, g] of groups) {
    for (const [id, task] of g.queue) {
      if (!task.active || task.paused || task.done) continue; // 未激活 / 暂停 / 已归零保留：跳过且不计 busy
      const remaining = task.deadline - (task.mono ? mono : wall);
      const ctx = task.ctx;
      ctx.remaining = remaining;
      if (remaining <= 0) {
        ctx.remaining = 0;
        // 归零收尾（静音也要落定终值并通知）：回调抛错只上报，出队/置 done 必须照常执行，否则任务会逐帧重复触发 onDone
        try {
          snapshotValue(ctx.oldValue, ctx.value);
          ctx.value = task.parser(0, ctx);
          if (!task.started) {
            task.started = true;
            task.onStart?.(0, ctx); // 首帧即归零（截止时间已过 / 懒任务可见时已到期）：onDone 前仍要保证 onStart 先触发一次
          }
          task.render(task.el, 0, ctx.value, ctx); // 末帧落定（0）
        } catch (err) {
          reportTaskError(err);
        }
        try {
          task.onDone?.(0, ctx); // 渲染失败不应吞掉完成通知
        } catch (err) {
          reportTaskError(err);
        }
        // autoKill（默认）：出队并经 onRemove 释放（清元素索引 + 调用渲染器 destroy）；否则保留实例停在 0
        if (task.autoKill) remove(id, label);
        else task.done = true;
        continue;
      }
      busy = true;
      if (task.muteHidden && (hidden || task.offscreen)) {
        // 静音：不渲染不回调，只盯着归零时刻；解除静音时强制刷新
        task.wasMuted = true;
        if (remaining < wake) wake = remaining;
        continue;
      }
      if (task.wasMuted) {
        task.wasMuted = false;
        task.last = -1;
        task.nextAt = 0;
      }
      if (!task.showMs) {
        // 非毫秒任务只在秒位变化时渲染；下次需要处理的时刻：秒位翻转（剩余跌破 sec 秒整）或归零
        const sec = (remaining / MS_SECOND) | 0;
        const w = sec > 0 ? remaining - sec * MS_SECOND + 1 : remaining;
        if (w < wake) wake = w;
        if (sec === task.last) continue;
        task.last = sec;
      } else if (task.interval > 0) {
        // 毫秒任务限帧：按固定网格推进，跳过错失的时隙、不补发；到点前最多睡到下个网格点（完成时刻取最早）
        const wait = throttle(task, mono);
        if (wait > 0) {
          const w = Math.min(wait, remaining);
          if (w < wake) wake = w;
          continue;
        }
        const w = Math.min(untilNext(task, mono), remaining);
        if (w < wake) wake = w;
      } else {
        wake = 0; // 毫秒任务逐帧
      }
      // 解析为 [d,h,m,s,ms] 元组（零分配复用）；字符串格式化交给渲染器按需调用 ctx.fmt
      try {
        snapshotValue(ctx.oldValue, ctx.value);
        ctx.value = task.parser(remaining, ctx);
        if (!task.started) {
          task.started = true;
          task.onStart?.(remaining, ctx); // 激活后首个渲染帧触发一次
        }
        task.onUpdate?.(remaining, ctx);
        task.render(task.el, remaining, ctx.value, ctx);
      } catch (err) {
        reportTaskError(err); // 单任务回调抛错不饿死同组兄弟
      }
    }
  }
  nextWake = busy ? wake : Infinity;
  return busy;
}

/** 供核心调度使用：忙碌时返回 true（逐帧）或距下次需处理的毫秒数（休眠），空闲返回 false */
function schedule(): boolean | number {
  if (!tick()) return false;
  return nextWake > FRAME_WINDOW ? Math.ceil(nextWake) : true;
}

function install(options?: ICountdownOptions): IPlugin {
  if (options) Object.assign(defaults, options);
  return {
    name: "down",
    install: schedule,
    api: counter,
    dispose: disposeAll,
  };
}

/** 把全局 defaults 还原为出厂值（不影响已创建的任务与分组配置） */
export function resetDefaults() {
  restoreDefaults(defaults, FACTORY_DEFAULTS);
}

const counter = Object.assign(add, { add, remove, clear, group, pause, resume, install, defaults, resetDefaults });

export { add, install as register };

export default counter;
