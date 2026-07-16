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
   * Static-progressive displayability: whether enough pixel-data bytes have
   * arrived for a tolerant decoder to show a partial/blurry preview. Dynamic
   * per image — depends on where its pixel data starts and how it's encoded
   * (progressive JPEG: first scan complete; baseline JPEG/PNG: a minimum run
   * of entropy/IDAT bytes past the structural headers).
   *
   * 静态渐进可显示信号:已到达的像素数据字节是否足以让宽容解码器显示出部分/模糊预览。
   * 逐图动态判定——取决于该图像素数据从哪里开始、以及编码方式(渐进式 JPEG:第一个 scan
   * 收完;baseline JPEG/PNG:越过结构头之后攒到最起码的一段熵编码/IDAT 字节)。
   */
  staticDisplayable?: boolean;
  /** MIME type for the matched format — 命中格式对应的 MIME */
  mime?: "image/gif" | "image/png" | "image/webp" | "image/avif" | "image/jpeg";
}

/** Minimum pixel-data bytes for the baseline-JPEG/PNG displayability heuristic — baseline JPEG/PNG 可显示启发式的最少像素数据字节 */
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
      staticDisplayable: r.status === "static" && (r.idatBytes ?? 0) >= MIN_PIXEL_BYTES,
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
    // Progressive JPEG: first scan complete = full-coverage blurry decode.
    // Baseline: a minimum run of entropy bytes past SOS = top-slice decode.
    // 渐进式 JPEG:第一个 scan 收完 = 全图覆盖的模糊解码;
    // baseline:越过 SOS 攒到最少一段熵编码字节 = 顶部切片解码。
    const displayable = r.status === "static" && r.scanDataStart !== undefined && (r.progressive ? r.firstScanEnd !== undefined : buf.length - r.scanDataStart >= MIN_PIXEL_BYTES);
    return {
      status: r.status,
      format: "jpeg",
      width: r.width,
      height: r.height,
      staticDisplayable: displayable,
      mime: "image/jpeg",
    };
  }

  return { status: "static" };
}
