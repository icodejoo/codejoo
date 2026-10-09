/**
 * JS 计时器：pulse / shimmer 开启 fps 选项时，代替根上的 CSS 动画，按限定帧率写根变量。
 * 根驱动的成本在于"根变量变一次 → 整棵子树重算一次样式"，CSS 动画哪怕值没变也每帧触发；
 * 这里只在到点且值真的变了的帧才写，其余帧零成本。全库共用一个 rAF 循环。
 */

import { PAUSED_ATTR, dropEmptyStyle, toMs } from "./dom.js";

/** 根上标记计时器模式的属性：CSS 据此停掉根上的动画 */
export const TICK_ATTR = "skz-tick";

/** 脉冲进度变量（0~1，CSS 用 color-mix 换算成颜色） */
const PULSE_T = "--skz-pulse-t";

/** 流光位置变量（视口宽度的百分比，-60~110） */
const SHIMMER_P = "--skz-shimmer-p";

/** 默认动画时长（毫秒），与 CSS 的 --skz-duration 默认值一致 */
const DEFAULT_DURATION = 1500;

/** 脉冲进度的量化级数：颜色本身只有几十个可分辨的台阶，再细只会多写无效更新 */
const PULSE_LEVELS = 32;

/** 自动档：写入后下一帧间隔超过它（毫秒）就放慢一档 */
const SLOW_FRAME = 20;

/** 自动档：帧间隔低于它（毫秒）算流畅 */
const CALM_FRAME = 17;

/** 自动档：连续这么多流畅帧后加快一档 */
const CALM_STREAK = 30;

/** 自动档：最多每几帧写一次 */
const MAX_STRIDE = 4;

/** 计时器驱动的效果 */
export type TickKind = "pulse" | "shimmer";

/** 帧率设置：固定上限（每秒最多写几次）或自动档（按帧耗时每 1~4 帧写一次） */
export type TickRate = number | "auto";

/** 每个注册根的计时状态 */
interface TickEntry {
  /** 效果 */
  kind: TickKind;
  /** 两次写入的最小间隔（毫秒） */
  gap: number;
  /** 动画时长（毫秒） */
  duration: number;
  /** 起始时间 */
  start: number;
  /** 上次写入时间 */
  last: number;
  /** 上次写入的脉冲进度 */
  pulse: string;
  /** 上次写入的流光位置 */
  shimmer: string;
  /** 是否自动档 */
  auto: boolean;
  /** 自动档：每几帧写一次 */
  stride: number;
  /** 自动档：距上次写入过了几帧 */
  since: number;
  /** 自动档：上一帧是否写过 */
  wrote: boolean;
  /** 自动档：连续流畅帧数 */
  calm: number;
}

/** 已注册的根 */
const entries = new Map<HTMLElement, TickEntry>();

/** 当前 rAF 句柄，0 表示循环没在跑 */
let frame = 0;

/** 减少动态效果的媒体查询，首次用到时创建 */
let reduceMotion: MediaQueryList | null = null;

/** 上一帧的时间戳，自动档用来算帧间隔 */
let prevNow = 0;

/**
 * 当前环境能否用计时器：需要 rAF，且 CSS 支持根驱动所需的 @property（借相对颜色语法判断，与 CSS 侧一致）。
 * @returns 是否可用
 */
export function canTick(): boolean {
  return typeof requestAnimationFrame === "function" && typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", "rgb(from red r g b)");
}

/**
 * 读根上的 --skz-duration（支持 s / ms），读不到用默认值。
 * @param el 骨架根元素
 * @returns 时长（毫秒）
 */
function durationOf(el: HTMLElement): number {
  return toMs(getComputedStyle(el).getPropertyValue("--skz-duration"), DEFAULT_DURATION);
}

/**
 * ease-in-out（二次）缓动，与 CSS 侧的 ease-in-out 近似。
 * @param k 线性进度 0~1
 * @returns 缓动后的进度
 */
function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

/**
 * 写一帧：值变了才写。
 * @param el 骨架根元素
 * @param e 计时状态
 * @param now 当前时间
 * @returns 是否真的写了
 */
function write(el: HTMLElement, e: TickEntry, now: number): boolean {
  let wrote = false;
  // phase 在 [0, 2) 内：脉冲来回一次是两个时长，流光每个时长扫一遍
  const phase = ((now - e.start) % (e.duration * 2)) / e.duration;
  const pulse = String(Math.round(easeInOut(phase <= 1 ? phase : 2 - phase) * PULSE_LEVELS) / PULSE_LEVELS);
  if (pulse !== e.pulse) {
    el.style.setProperty(PULSE_T, pulse);
    e.pulse = pulse;
    wrote = true;
  }
  if (e.kind === "shimmer") {
    const shimmer = (-60 + 170 * (phase % 1)).toFixed(1);
    if (shimmer !== e.shimmer) {
      el.style.setProperty(SHIMMER_P, shimmer);
      e.shimmer = shimmer;
      wrote = true;
    }
  }
  return wrote;
}

/**
 * 自动档调速：写入后的下一帧明显变慢就放慢一档；连续一段时间都流畅就加快一档。
 * @param e 计时状态
 * @param dt 本帧与上一帧的间隔（毫秒）
 */
function adapt(e: TickEntry, dt: number): void {
  const afterWrite = e.wrote;
  e.wrote = false;
  if (afterWrite && dt > SLOW_FRAME) {
    // 写入拖慢了下一帧：放慢一档
    e.stride = Math.min(e.stride + 1, MAX_STRIDE);
    e.calm = 0;
  } else if (dt < CALM_FRAME) {
    // 流畅帧（含写入后的流畅帧）都计数，攒够了加快一档
    if (++e.calm >= CALM_STREAK && e.stride > 1) {
      e.stride--;
      e.calm = 0;
    }
  } else {
    e.calm = 0;
  }
}

/**
 * rAF 循环：遍历所有注册根，跳过没到点的、在视口外的；减少动态效果时整体不写。
 * @param now rAF 时间戳
 */
function loop(now: number): void {
  frame = requestAnimationFrame(loop);
  const dt = prevNow ? now - prevNow : 0;
  prevNow = now;
  reduceMotion ??= typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  if (reduceMotion?.matches) return;
  for (const [el, e] of entries) {
    if (el.hasAttribute(PAUSED_ATTR)) continue;
    if (e.auto) {
      adapt(e, dt);
      if (++e.since < e.stride) continue;
      e.since = 0;
      e.wrote = write(el, e, now);
    } else if (now - e.last >= e.gap) {
      e.last = now;
      write(el, e, now);
    }
  }
}

/**
 * 注册（或更新）一个根：之后由共享循环按帧率设置写它的根变量。
 * @param el 骨架根元素
 * @param kind 效果
 * @param rate 每秒最多写几次，或 "auto"（按帧耗时自动每 1~4 帧写一次）
 * @example startTick(root, "shimmer", 30);
 * @example startTick(root, "shimmer", "auto");
 */
export function startTick(el: HTMLElement, kind: TickKind, rate: TickRate): void {
  const prev = entries.get(el);
  const auto = rate === "auto";
  const gap = auto ? 0 : 1000 / rate - 1;
  if (prev) {
    // 重入：保留起始时间和自动档当前档位，动画不跳
    prev.kind = kind;
    prev.gap = gap;
    prev.auto = auto;
    prev.duration = durationOf(el);
  } else {
    entries.set(el, { kind, gap, duration: durationOf(el), start: performance.now(), last: -Infinity, pulse: "", shimmer: "", auto, stride: 1, since: 0, wrote: false, calm: 0 });
  }
  el.setAttribute(TICK_ATTR, "");
  if (!frame) frame = requestAnimationFrame(loop);
}

/**
 * 注销一个根并清掉它的计时器变量；没有根了就停掉循环。没注册过则什么都不做。
 * @param el 骨架根元素
 * @example stopTick(root);
 */
export function stopTick(el: HTMLElement): void {
  if (!entries.delete(el)) return;
  el.removeAttribute(TICK_ATTR);
  el.style.removeProperty(PULSE_T);
  el.style.removeProperty(SHIMMER_P);
  dropEmptyStyle(el);
  if (!entries.size && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
    prevNow = 0;
  }
}
