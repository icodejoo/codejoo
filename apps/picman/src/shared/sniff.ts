/**
 * Unified magic-byte sniffer: dispatches to the GIF/APNG/WebP walkers and
 * maps their results into one shape.
 *
 * 统一魔数嗅探器:分派到 GIF/APNG/WebP walker,结果映射为统一结构。
 */

import { asciiEquals } from "./bytes";
import { scanGif } from "./walkers/gif";
import { scanPng } from "./walkers/apng";
import { scanWebp } from "./walkers/webp";

/** Detected animated-image container format — 已识别的动图容器格式 */
export type SniffFormat = "gif" | "apng" | "webp";

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
  /** MIME type for the matched format — 命中格式对应的 MIME */
  mime?: "image/gif" | "image/png" | "image/webp";
}

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

  return { status: "static" };
}
