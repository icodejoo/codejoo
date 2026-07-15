/**
 * Public option/context types shared across entries.
 *
 * 各入口共享的公共配置/上下文类型。
 */

import { CACHE_NAME } from "./protocol";

/**
 * Error context passed to onError hooks on both sides.
 *
 * 两端 onError 钩子收到的错误上下文。
 */
export interface PicmanErrorContext {
  /** Canonical image URL — 规范化图片 URL */
  url: string;

  /** Failing stage identifier — 出错阶段标识 */
  stage: string;

  /** Original error — 原始错误 */
  error: unknown;
}

/**
 * Options for the SW-side pipeline (see spec §3 for semantics/defaults).
 *
 * SW 端管线配置(语义与默认值见 spec §3)。
 */
export interface PicmanSWOptions {
  /** Big-image threshold in bytes, default 102400 — 大图阈值(字节),默认 102400 */
  threshold?: number;

  /** URL include rules — URL 包含规则 */
  include?: (string | RegExp)[];

  /** URL exclude rules — URL 排除规则 */
  exclude?: (string | RegExp)[];

  /** Color block style, default 'gradient' — 色块样式,默认 'gradient' */
  colorBlock?: "solid" | "gradient";

  /** Fallback color when no palette, default '#e0e0e0' — 无调色板底色,默认 '#e0e0e0' */
  fallbackColor?: string;

  /** First-frame style, default 'sharp' — 首帧样式,默认 'sharp' */
  firstFrame?: "sharp" | "blur";

  /** Blur radius px for firstFrame:'blur', default 12 — blur 模糊半径,默认 12 */
  blurRadius?: number;

  /** Min head bytes before sniffing, default 4096 — 嗅探前最小头部字节,默认 4096 */
  headBytes?: number;

  /** Max bytes to wait for first frame, default 524288 — 首帧最大等待字节,默认 524288 */
  firstFrameMaxBytes?: number;

  /** Cache tuning — 缓存配置 */
  cache?: { name?: string; maxEntries?: number; maxAgeSeconds?: number };

  /** Error hook — 错误钩子 */
  onError?: (ctx: PicmanErrorContext) => void;
}

/**
 * Fully-resolved SW options with all defaults applied.
 *
 * 应用全部默认值后的 SW 配置。
 */
export type ResolvedSWOptions = Required<Omit<PicmanSWOptions, "cache" | "onError">> & {
  /** Resolved cache tuning — 已解析缓存配置 */
  cache: Required<NonNullable<PicmanSWOptions["cache"]>>;

  /** Error hook (noop by default) — 错误钩子(默认空实现) */
  onError: (ctx: PicmanErrorContext) => void;
};

/**
 * Apply spec §3 defaults.
 *
 * 应用 spec §3 默认值。
 * @param o - User options — 用户配置
 * @returns Resolved options — 解析后的配置
 */
export function resolveSWOptions(o: PicmanSWOptions = {}): ResolvedSWOptions {
  return {
    threshold: o.threshold ?? 102400,
    include: o.include ?? [/\.(gif|png|apng|webp)(\?|$)/i],
    exclude: o.exclude ?? [],
    colorBlock: o.colorBlock ?? "gradient",
    fallbackColor: o.fallbackColor ?? "#e0e0e0",
    firstFrame: o.firstFrame ?? "sharp",
    blurRadius: o.blurRadius ?? 12,
    headBytes: o.headBytes ?? 4096,
    firstFrameMaxBytes: o.firstFrameMaxBytes ?? 512 * 1024,
    cache: {
      name: o.cache?.name ?? CACHE_NAME,
      maxEntries: o.cache?.maxEntries ?? 200,
      maxAgeSeconds: o.cache?.maxAgeSeconds ?? 7 * 86400,
    },
    onError: o.onError ?? (() => {}),
  };
}
