/**
 * SW ↔ page protocol: constants, message shapes, URL helpers.
 * Single source of truth for every cross-context literal.
 *
 * SW ↔ 页面协议:常量、消息类型、URL 工具。跨端字面量唯一出处。
 */

/** Cache Storage bucket name — Cache Storage 桶名 */
export const CACHE_NAME = "imgprogress-v1";

/** Query param marking a stage re-request ('ff' | '1') — 二次请求阶段参数 */
export const PARAM_FULL = "__imgprogress_full__";

/** Query param forcing network passthrough (retry) — 强制透传网络的重试参数 */
export const PARAM_BYPASS = "__imgprogress_bypass__";

/** Query param marking a user-initiated video play request (SW lets it through) — 标记用户发起的视频播放请求(SW 放行) */
export const PARAM_PLAY = "__imgprogress_play__";

/** Query param carrying a per-element skeleton color for the color block (from `data-ske-color`) — 承载按元素骨架色的参数(来自 `data-ske-color`) */
export const PARAM_SKE = "__imgprogress_ske__";

/** Query param carrying a per-element thumbnail downscale factor (from `data-thumb-scale`) — 承载按元素缩略图缩小倍数的参数(来自 `data-thumb-scale`) */
export const PARAM_THUMB_SCALE = "__imgprogress_thumb__";

/** Response header marking imgprogress-generated responses — imgprogress 生成响应的标记头 */
export const HEADER_MARK = "X-Imgprogress";

/**
 * Placeholder stage: 'ff' first frame, '1' full image.
 *
 * 占位阶段:'ff' 首帧,'1' 全图。
 */
export type ImgprogressStage = "ff" | "1";

/**
 * Messages posted from SW to pages.
 *
 * SW 发往页面的消息。
 */
export type ImgprogressMessage =
  | { imgprogress: 1; type: "first-frame"; url: string }
  | { imgprogress: 1; type: "complete"; url: string }
  | { imgprogress: 1; type: "error"; url: string; stage: "download" | "first-frame"; message: string };

/**
 * Type guard for {@link ImgprogressMessage}.
 *
 * {@link ImgprogressMessage} 的类型守卫。
 * @param data - Unknown message data — 未知消息数据
 * @returns Whether data is a imgprogress message — 是否为 imgprogress 消息
 * @example
 * navigator.serviceWorker.addEventListener('message', e => { if (isImgprogressMessage(e.data)) ... })
 */
export function isImgprogressMessage(data: unknown): data is ImgprogressMessage {
  return typeof data === "object" && data !== null && (data as { imgprogress?: unknown }).imgprogress === 1;
}

/**
 * Strip imgprogress marker params, returning the canonical original URL.
 *
 * 剥掉 imgprogress 标记参数,得到规范化原始 URL。
 * @param url - Absolute URL possibly carrying markers — 可能带标记的绝对 URL
 * @returns URL without imgprogress params — 去标记后的 URL
 */
export function stripImgprogressParams(url: string): string {
  const u = new URL(url);
  u.searchParams.delete(PARAM_FULL);
  u.searchParams.delete(PARAM_BYPASS);
  u.searchParams.delete(PARAM_PLAY);
  u.searchParams.delete(PARAM_SKE);
  u.searchParams.delete(PARAM_THUMB_SCALE);
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
export function withStageParam(url: string, stage: ImgprogressStage): string {
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
