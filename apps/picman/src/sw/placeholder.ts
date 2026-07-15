/**
 * Placeholder synthesis: zero-dependency SVG color blocks and a bitmap
 * first-frame renderer built on an injectable OffscreenCanvas-like API.
 *
 * 占位生成:零依赖 SVG 色块,以及基于可注入 OffscreenCanvas 式 API 的位图首帧渲染器。
 */

/**
 * Input for {@link svgColorBlock}.
 *
 * {@link svgColorBlock} 的入参。
 */
export interface ColorBlockInput {
  /** Placeholder width — 占位宽 */
  width: number;
  /** Placeholder height — 占位高 */
  height: number;
  /** Source palette, undefined falls back to fallbackColor — 来源调色板,缺省时用 fallbackColor */
  palette?: [number, number, number][];
  /** Solid fill or two-stop vertical gradient — 纯色或双色纵向渐变 */
  mode: "solid" | "gradient";
  /** Hex color used when no palette is available — 无调色板时使用的十六进制颜色 */
  fallbackColor: string;
}

/**
 * Format an RGB triple as a lowercase hex color.
 *
 * 把 RGB 三元组格式化为小写十六进制颜色。
 * @param rgb - Color channels 0-255 — 颜色通道(0-255)
 * @returns Hex color like '#a1b2c3' — 十六进制颜色,如 '#a1b2c3'
 */
export function rgbHex([r, g, b]: [number, number, number]): string {
  const ch = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/**
 * Perceptual luminance (ITU-R BT.601 weights).
 *
 * 感知亮度(ITU-R BT.601 权重)。
 * @param rgb - Color channels 0-255 — 颜色通道(0-255)
 * @returns Luminance value — 亮度值
 */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Average a palette's colors channel-wise.
 *
 * 按通道平均调色板颜色。
 * @param palette - Source colors — 来源颜色
 * @returns Averaged color — 平均色
 */
export function avgColor(palette: [number, number, number][]): [number, number, number] {
  const sum = palette.reduce((acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b] as [number, number, number], [0, 0, 0] as [number, number, number]);
  return [sum[0] / palette.length, sum[1] / palette.length, sum[2] / palette.length];
}

/**
 * Pick the light and dark ends of a palette, sorted by luminance.
 *
 * 按亮度排序,取调色板的明暗两端。
 * @param palette - Source colors — 来源颜色
 * @returns [light, dark] colors — [亮色, 暗色]
 */
export function lightDark(palette: [number, number, number][]): [[number, number, number], [number, number, number]] {
  const sorted = [...palette].sort((a, b) => luminance(a) - luminance(b));
  const last = sorted.length - 1;
  const dark = sorted[Math.round(last * 0.1)]!;
  const light = sorted[Math.round(last * 0.9)]!;
  return [light, dark];
}

/**
 * Adjust a hex color's brightness by a signed percentage.
 *
 * 按带符号百分比调整十六进制颜色的亮度。
 * @param hex - Source hex color — 来源十六进制颜色
 * @param pct - Signed adjustment, e.g. 0.08 for +8% — 带符号调整量,如 0.08 表示 +8%
 * @returns Adjusted hex color — 调整后的十六进制颜色
 */
function adjustHexBrightness(hex: string, pct: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const adjust = (c: number) => Math.max(0, Math.min(255, Math.round(c + 255 * pct)));
  return rgbHex([adjust(r), adjust(g), adjust(b)]);
}

/**
 * Build an SVG color-block placeholder (zero canvas dependency).
 *
 * 生成 SVG 色块占位(零 canvas 依赖)。
 * @param input - Size, palette, style — 尺寸、调色板、样式
 * @returns SVG markup string — SVG 字符串
 * @example svgColorBlock({ width: 64, height: 40, mode: 'gradient', fallbackColor: '#e0e0e0' })
 */
export function svgColorBlock(input: ColorBlockInput): string {
  const { width, height, palette, mode, fallbackColor } = input;

  if (mode === "solid") {
    const color = palette && palette.length > 0 ? rgbHex(avgColor(palette)) : fallbackColor;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
  }

  const [light, dark] =
    palette && palette.length > 0
      ? lightDark(palette).map((c) => rgbHex(c))
      : [adjustHexBrightness(fallbackColor, 0.08), adjustHexBrightness(fallbackColor, -0.08)];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

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
  createCanvas: (w: number, h: number) => {
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
export async function makeFirstFramePlaceholder(
  bytes: Uint8Array,
  mime: string,
  opts: { firstFrame: "sharp" | "blur"; blurRadius: number },
  deps: BitmapDeps,
): Promise<Blob | null> {
  let bitmap: { width: number; height: number; close?: () => void };
  try {
    bitmap = await deps.decode(new Blob([bytes], { type: mime }));
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
