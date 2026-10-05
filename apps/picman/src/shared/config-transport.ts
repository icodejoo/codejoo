/**
 * SW 配置在"页面端 register"与"预构建独立 SW"之间的传输编解码。
 *
 * 预构建 SW 是独立脚本文件,页面端无法直接把配置对象传进它的作用域。这里把可序列化的
 * SW 选项编码进 SW 脚本 URL 的 query;SW 启动时(在 setupImgprogress 之前)从自身
 * location 解析出来——没有跨进程时序窗口,SW 被浏览器回收重启后配置也不丢失。
 *
 * 只有可 JSON 序列化的标量/普通对象选项能这样传;含函数(onError)或正则(include/exclude
 * 的 RegExp 形式)的选项无法跨进程传输,需改用"自己的 SW + setupImgprogress"的接入方式。
 */

import type { ImgprogressSWOptions } from "./types";

/** query 参数名,承载 JSON 编码后的 SW 配置 — query param carrying the JSON-encoded SW options */
const CONFIG_PARAM = "__imgprogress_cfg__";

/**
 * 可经 query 传入预构建 SW 的选项字段——均为可 JSON 序列化的标量或普通对象。
 * 刻意排除 `include`/`exclude`(常为正则,不可序列化)与 `onError`(函数)。
 */
const TRANSFERABLE_KEYS = [
  "threshold",
  "colorBlock",
  "fallbackColor",
  "firstFrame",
  "blurRadius",
  "headBytes",
  "firstFrameMaxBytes",
  "staticProgressive",
  "deferVideos",
  "cache",
] as const satisfies readonly (keyof ImgprogressSWOptions)[];

/**
 * 把选项里可传输的 SW 字段编码成 query,追加到预构建 SW 脚本 URL 后。
 *
 * 用字符串拼接而非 URL 归一化,避免改变传入 URL 的原始形态(相对/绝对路径均原样保留)。
 * @param swUrl - 预构建 SW 脚本 URL,可带或不带已有 query — prebuilt SW script URL
 * @param options - 合并后的选项对象,函数按白名单从中挑出可传输的 SW 字段 — merged options to pick SW fields from
 * @returns 追加了配置 query 的 SW 脚本 URL;无可传字段时原样返回 — SW URL with config query appended, or unchanged when nothing to transfer
 * @example
 * appendSWConfig("/imgprogress-sw.js", { threshold: 200000, colorBlock: "solid" })
 * // => "/imgprogress-sw.js?__imgprogress_cfg__=%7B%22threshold%22%3A200000%2C%22colorBlock%22%3A%22solid%22%7D"
 */
export function appendSWConfig(swUrl: string, options: Partial<ImgprogressSWOptions>): string {
  const picked: Record<string, unknown> = {};
  for (const key of TRANSFERABLE_KEYS) {
    if (options[key] !== undefined) picked[key] = options[key];
  }
  if (Object.keys(picked).length === 0) return swUrl;
  const sep = swUrl.includes("?") ? "&" : "?";
  return `${swUrl}${sep}${CONFIG_PARAM}=${encodeURIComponent(JSON.stringify(picked))}`;
}

/**
 * 从 SW 脚本 URL 的 query 解析出页面端传入的 SW 选项,供预构建 SW 入口在
 * setupImgprogress 之前调用。按同一白名单二次过滤,忽略任何非预期字段。
 * @param search - SW 自身 location.search(形如 "?__imgprogress_cfg__=...") — the SW location search string
 * @returns 解析出的 SW 选项;缺失或解析失败时返回空对象(SW 走默认配置) — parsed SW options, or {} on absence/parse failure
 * @example
 * // 预构建 SW 入口
 * setupImgprogress(parseSWConfig(location.search))
 */
export function parseSWConfig(search: string): Partial<ImgprogressSWOptions> {
  try {
    const raw = new URLSearchParams(search).get(CONFIG_PARAM);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of TRANSFERABLE_KEYS) {
      if (parsed[key] !== undefined) out[key] = parsed[key];
    }
    return out as Partial<ImgprogressSWOptions>;
  } catch {
    return {};
  }
}
