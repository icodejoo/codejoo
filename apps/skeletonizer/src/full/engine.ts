import { warnOnce } from "../core/dev.js";
import type { SkzExtension } from "../core/extension.js";
import type { EnableOptions } from "../core/types.js";
import type { SkzEngine } from "./types.js";

/**
 * 方案实现：变体入口（skeletonizer/global、skeletonizer/svg）注册进来，
 * 给根挂上 / 撤掉该方案特有的运行时处理（global：继承防火墙与老浏览器降级；svg：blob SVG 动画图）。
 */
export interface SkzEngineImpl {
  /** 方案名，与 engine 选项对应 */
  engine: SkzEngine;
  /**
   * 根已带 skz 后按选项同步（pulse / shimmer 且选中本方案时调用）
   * @param el 骨架根元素
   * @param opts 骨架选项
   */
  sync(el: HTMLElement, opts: EnableOptions): void;
  /**
   * 撤掉本方案在根上的一切处理（未选中本方案、换效果或关闭时调用）
   * @param el 骨架根元素
   */
  release(el: HTMLElement): void;
}

/** 已注册的方案实现 */
const engines = new Map<SkzEngine, SkzEngineImpl>();

/**
 * 注册方案实现；同名重复注册以后者为准。由变体入口在加载时调用，一般不需要手动调用。
 * @param impl 方案实现
 * @example registerEngine({ engine: "svg", sync: applySvg, release: releaseSvg });
 */
export function registerEngine(impl: SkzEngineImpl): void {
  engines.set(impl.engine, impl);
}

/**
 * 决定根实际使用的方案：显式传了就用；否则加载了 global 用 global，只加载了 svg 用 svg，都没加载按 global（纯 CSS 根驱动）。
 * @param opts 骨架选项
 * @returns 方案名
 */
function resolveEngine(opts: EnableOptions): SkzEngine {
  if (opts.engine) return opts.engine;
  return !engines.has("global") && engines.has("svg") ? "svg" : "global";
}

/**
 * 开发模式下提示 engine 误配：显式指定了没注册的方案（如只引了 global 却写 engine: "svg"）。每个方案名只提示一次。
 * @param engine 显式指定的方案
 */
function warnUnregistered(engine: SkzEngine): void {
  if (engines.has(engine)) return;
  const entry = engine === "svg" ? "skeletonizer/svg" : "skeletonizer/global";
  warnOnce(`engine:${engine}`, `[skeletonizer] engine: "${engine}" 对应的方案没有注册，pulse / shimmer 不会有该方案的运行时处理。请引入 ${entry}（或 skeletonizer/all）。`);
}

/**
 * 方案调度扩展：pulse / shimmer 时只让选中的方案处理这个根，其余方案撤掉；其他效果全部撤掉。
 * 分两遍：先撤掉未选中的，再同步选中的——选中方案（如 global 在老浏览器上）可能借用别的方案的运行时图，
 * 同遍里先 sync 再被后面的 release 撤掉就白挂了。由完整版入口自动注册。
 */
export const engineExtension: SkzExtension = {
  name: "engine",
  sync(el, opts) {
    const engine = resolveEngine(opts);
    if (opts.engine) warnUnregistered(opts.engine);
    const animated = opts.effect === "pulse" || opts.effect === "shimmer";
    const selected: SkzEngineImpl[] = [];
    for (const impl of engines.values()) {
      if (animated && impl.engine === engine) selected.push(impl);
      else impl.release(el);
    }
    for (const impl of selected) impl.sync(el, opts);
  },
  release(el) {
    for (const impl of engines.values()) impl.release(el);
  },
};
