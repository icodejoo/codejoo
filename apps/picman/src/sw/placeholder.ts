/**
 * Bitmap first-frame renderer built on an injectable OffscreenCanvas-like API.
 * The zero-dependency SVG color-block helpers now live in
 * {@link ../shared/placeholder} and are re-exported here for backward compatibility.
 *
 * 基于可注入 OffscreenCanvas 式 API 的位图首帧渲染器。零依赖 SVG 色块工具已移至
 * {@link ../shared/placeholder},此处 re-export 以保持向后兼容。
 */

export { type ColorBlockInput, rgbHex, avgColor, lightDark, svgColorBlock, svgDataUri } from "../shared/placeholder";

/**
 * Injectable bitmap decode/draw dependencies, so this runs identically in a
 * Service Worker (OffscreenCanvas) and in Node tests (mocks).
 *
 * 可注入的位图解码/绘制依赖,使其在 Service Worker(OffscreenCanvas)与 Node 测试(mock)下行为一致。
 */
export interface BitmapDeps {
  /** createImageBitmap-like decoder — 类 createImageBitmap 解码器 */
  decode: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  /** OffscreenCanvas-like factory — 类 OffscreenCanvas 工厂 */
  createCanvas: (
    w: number,
    h: number,
  ) => {
    getContext(id: "2d"): { filter: string; drawImage(img: unknown, x: number, y: number, w: number, h: number): void } | null;
    convertToBlob(opts?: { type?: string }): Promise<Blob>;
  };
}

/** Longest side of the first-frame placeholder bitmap, px — 首帧占位位图长边上限(像素) */
const MAX_SIDE = 512;

/**
 * Decode the first-frame bytes and render a downscaled (optionally blurred)
 * placeholder bitmap; resolves null on any decode/draw failure instead of throwing.
 *
 * 解码首帧字节并渲染缩小(可选模糊)的占位位图;解码/绘制失败一律 resolve null,不抛异常。
 * @param bytes - Recomposed first-frame image bytes — 重组后的首帧图片字节
 * @param mime - MIME type for the decode Blob — 解码用 Blob 的 MIME 类型
 * @param opts - Rendering style — 渲染样式
 * @param deps - Injected decode/canvas dependencies — 注入的解码/canvas 依赖
 * @returns PNG blob, or null on failure — PNG blob,失败时为 null
 * @example
 * const blob = await makeFirstFramePlaceholder(bytes, 'image/gif', { firstFrame: 'sharp', blurRadius: 12 }, deps)
 */
export async function makeFirstFramePlaceholder(bytes: Uint8Array, mime: string, opts: { firstFrame: "sharp" | "blur"; blurRadius: number }, deps: BitmapDeps): Promise<Blob | null> {
  let bitmap: { width: number; height: number; close?: () => void };
  try {
    bitmap = await deps.decode(new Blob([new Uint8Array(bytes)], { type: mime }));
  } catch {
    return null;
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const scaledW = Math.round(bitmap.width * scale);
  const scaledH = Math.round(bitmap.height * scale);

  const canvas = deps.createCanvas(scaledW, scaledH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (opts.firstFrame === "blur") ctx.filter = `blur(${opts.blurRadius}px)`;
  ctx.drawImage(bitmap, 0, 0, scaledW, scaledH);
  bitmap.close?.();

  return canvas.convertToBlob({ type: "image/png" });
}
