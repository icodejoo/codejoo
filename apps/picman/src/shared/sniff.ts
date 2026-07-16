/**
 * Unified magic-byte sniffer: dispatches to the GIF/APNG/WebP walkers and
 * maps their results into one shape.
 *
 * 统一魔数嗅探器:分派到 GIF/APNG/WebP walker,结果映射为统一结构。
 */

import { asciiEquals } from "./bytes";
import { scanAvif, type AvifSampleRange } from "./walkers/avif";
import { scanGif } from "./walkers/gif";
import { scanJpeg } from "./walkers/jpeg";
import { scanPng } from "./walkers/apng";
import { scanWebp } from "./walkers/webp";

/** Detected image container format ('jpeg' is always static) — 已识别的图片容器格式('jpeg' 恒为静图) */
export type SniffFormat = "gif" | "apng" | "webp" | "avif" | "jpeg";

/**
 * Unified sniff result across all supported formats.
 *
 * 跨所有支持格式的统一嗅探结果。
 */
export interface SniffResult {
  /** need-more: not enough bytes to decide; static: non-animated/unrecognized; animated: confirmed animation — 字节不足待定/非动图或未识别/确认为动图 */
  status: "need-more" | "static" | "animated";
  /** Matched container format, absent when magic bytes match nothing — 命中的容器格式,魔数都不对时缺省 */
  format?: SniffFormat;
  /** Image width — 图片宽 */
  width?: number;
  /** Image height — 图片高 */
  height?: number;
  /** Palette colors, when the format carries one — 调色板颜色(格式带调色板时) */
  palette?: [number, number, number][];
  /** GIF first-frame boundary (see {@link scanGif}) — GIF 首帧边界(见 {@link scanGif}) */
  gifFirstFrameEnd?: number;
  /** APNG first-frame readiness (see {@link scanPng}) — APNG 首帧就绪(见 {@link scanPng}) */
  apngFirstFrameReady?: boolean;
  /** WebP first ANMF chunk range (see {@link scanWebp}) — WebP 首个 ANMF chunk 区间(见 {@link scanWebp}) */
  webpAnmf?: [number, number];
  /** AVIF first sample byte range in `mdat` (see {@link scanAvif}) — AVIF 首样本在 mdat 中的字节区间(见 {@link scanAvif}) */
  avifFirstSample?: AvifSampleRange;
  /** AVIF raw `av1C` box bytes (see {@link scanAvif}) — AVIF 原始 av1C box 字节(见 {@link scanAvif}) */
  avifAv1C?: Uint8Array;
  /**
   * Static-progressive displayability: whether the bytes so far decode into a
   * FULL-COVERAGE preview. Only encodings that interleave the whole picture
   * qualify — progressive JPEG (first scan complete → whole image, blurry)
   * and Adam7-interlaced PNG (early passes → whole image, mosaic). Baseline
   * JPEG / non-interlaced PNG never signal here: their truncated bytes decode
   * to a top slice only, which is not worth showing (those get a downscaled
   * thumbnail generated after the full download instead).
   *
   * 静态渐进可显示信号:已到字节能否解出**全图覆盖**的预览。只有把整幅画面交织编码的
   * 格式才符合——渐进式 JPEG(首个 scan 收完 → 全图模糊)与 Adam7 隔行 PNG(早期 pass →
   * 全图马赛克)。baseline JPEG / 非隔行 PNG 永不触发:它们的截断字节只能解出顶部
   * 一条,不值得展示(这类图改为全量下载后生成降采样缩略图)。
   */
  staticDisplayable?: boolean;
  /** MIME type for the matched format — 命中格式对应的 MIME */
  mime?: "image/gif" | "image/png" | "image/webp" | "image/avif" | "image/jpeg";
}

/** Minimum IDAT bytes before an interlaced PNG's mosaic preview is worth showing — 隔行 PNG 马赛克预览值得展示前的最少 IDAT 字节 */
const MIN_PIXEL_BYTES = 4096;

/**
 * Sniff a (possibly partial) byte buffer's magic bytes and delegate to the
 * matching format walker.
 *
 * 嗅探(可能不完整的)字节缓冲的魔数,分派到匹配的格式 walker。
 * @param buf - Bytes seen so far (may be partial) — 目前已收到的字节(可能不完整)
 * @returns Unified sniff result — 统一嗅探结果
 */
export function sniff(buf: Uint8Array): SniffResult {
  if (buf.length < 12) return { status: "need-more" };

  if (asciiEquals(buf, 0, "GIF8")) {
    const r = scanGif(buf);
    return {
      status: r.status,
      format: "gif",
      width: r.width,
      height: r.height,
      palette: r.palette,
      gifFirstFrameEnd: r.firstFrameEnd,
      mime: "image/gif",
    };
  }

  if (asciiEquals(buf, 0, "\x89PNG")) {
    const r = scanPng(buf);
    return {
      status: r.status,
      format: "apng",
      width: r.width,
      height: r.height,
      palette: r.palette,
      apngFirstFrameReady: r.firstFrameReady,
      staticDisplayable: r.status === "static" && r.interlaced === true && (r.idatBytes ?? 0) >= MIN_PIXEL_BYTES,
      mime: "image/png",
    };
  }

  if (asciiEquals(buf, 0, "RIFF") && asciiEquals(buf, 8, "WEBP")) {
    const r = scanWebp(buf);
    return {
      status: r.status,
      format: "webp",
      width: r.width,
      height: r.height,
      webpAnmf: r.anmf,
      mime: "image/webp",
    };
  }

  if (asciiEquals(buf, 4, "ftyp")) {
    const r = scanAvif(buf);
    return {
      status: r.status,
      format: "avif",
      width: r.width,
      height: r.height,
      avifFirstSample: r.firstSample,
      avifAv1C: r.av1C,
      mime: "image/avif",
    };
  }

  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const r = scanJpeg(buf);
    // Only progressive JPEG signals early: first scan complete = full-coverage
    // blurry decode. Baseline JPEG never signals (top-slice only).
    // 只有渐进式 JPEG 触发早期信号:首个 scan 收完 = 全图覆盖的模糊解码;
    // baseline JPEG 永不触发(只有顶部切片)。
    return {
      status: r.status,
      format: "jpeg",
      width: r.width,
      height: r.height,
      staticDisplayable: r.status === "static" && r.progressive === true && r.firstScanEnd !== undefined,
      mime: "image/jpeg",
    };
  }

  return { status: "static" };
}
