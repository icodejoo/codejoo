/**
 * SW ↔ page protocol: constants, message shapes, URL helpers.
 * Single source of truth for every cross-context literal.
 *
 * SW ↔ 页面协议:常量、消息类型、URL 工具。跨端字面量唯一出处。
 */

/** Cache Storage bucket name — Cache Storage 桶名 */
export const CACHE_NAME = "picman-v1";

/** Query param marking a stage re-request ('ff' | '1') — 二次请求阶段参数 */
export const PARAM_FULL = "__picman_full__";

/** Query param forcing network passthrough (retry) — 强制透传网络的重试参数 */
export const PARAM_BYPASS = "__picman_bypass__";

/** Query param marking a user-initiated video play request (SW lets it through) — 标记用户发起的视频播放请求(SW 放行) */
export const PARAM_PLAY = "__picman_play__";

/** Response header marking picman-generated responses — picman 生成响应的标记头 */
export const HEADER_MARK = "X-Picman";

/**
 * Placeholder stage: 'ff' first frame, '1' full image.
 *
 * 占位阶段:'ff' 首帧,'1' 全图。
 */
export type PicmanStage = "ff" | "1";

/**
 * Messages posted from SW to pages.
 *
 * SW 发往页面的消息。
 */
export type PicmanMessage = { picman: 1; type: "first-frame"; url: string } | { picman: 1; type: "complete"; url: string } | { picman: 1; type: "error"; url: string; stage: "download" | "first-frame"; message: string };

/**
 * Type guard for {@link PicmanMessage}.
 *
 * {@link PicmanMessage} 的类型守卫。
 * @param data - Unknown message data — 未知消息数据
 * @returns Whether data is a picman message — 是否为 picman 消息
 * @example
 * navigator.serviceWorker.addEventListener('message', e => { if (isPicmanMessage(e.data)) ... })
 */
export function isPicmanMessage(data: unknown): data is PicmanMessage {
  return typeof data === "object" && data !== null && (data as { picman?: unknown }).picman === 1;
}

/**
 * Strip picman marker params, returning the canonical original URL.
 *
 * 剥掉 picman 标记参数,得到规范化原始 URL。
 * @param url - Absolute URL possibly carrying markers — 可能带标记的绝对 URL
 * @returns URL without picman params — 去标记后的 URL
 */
export function stripPicmanParams(url: string): string {
  const u = new URL(url);
  u.searchParams.delete(PARAM_FULL);
  u.searchParams.delete(PARAM_BYPASS);
  u.searchParams.delete(PARAM_PLAY);
  return u.href;
}

/**
 * Append the stage param used for the swap re-request.
 *
 * 追加切图二次请求的阶段参数。
 * @param url - Canonical original URL — 规范化原始 URL
 * @param stage - Target stage — 目标阶段
 * @returns URL with stage param — 带阶段参数的 URL
 * @example withStageParam('https://a.com/x.gif', '1')
 */
export function withStageParam(url: string, stage: PicmanStage): string {
  const u = new URL(url);
  u.searchParams.set(PARAM_FULL, stage);
  return u.href;
}

/**
 * Append the play marker used to release a deferred video through the SW.
 *
 * 追加播放标记,用于让被延迟的视频经 SW 放行。
 * @param url - Canonical original video URL — 规范化原始视频 URL
 * @returns URL carrying the play marker — 带播放标记的 URL
 * @example withPlayParam('https://a.com/hero.mp4')
 */
export function withPlayParam(url: string): string {
  const u = new URL(url);
  u.searchParams.set(PARAM_PLAY, "1");
  return u.href;
}
