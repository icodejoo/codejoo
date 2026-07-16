/**
 * Incremental PNG/APNG container walker: acTL-based animation detection,
 * palette, first-frame readiness — structure only, no zlib inflate.
 *
 * 增量 PNG/APNG 容器遍历器:基于 acTL 的动图判定、调色板、首帧就绪——只解结构,不做 zlib inflate。
 */

import { readBE32 } from "../bytes";

/**
 * Result of scanning a (possibly partial) PNG/APNG byte buffer.
 *
 * 扫描(可能不完整的)PNG/APNG 字节缓冲的结果。
 */
export interface PngScan {
  /** need-more: header/palette/first IDAT not yet decided; static/animated: acTL absence/presence — 头部信息不足待定/静图/动图(按 acTL 有无) */
  status: "need-more" | "static" | "animated";
  /** IHDR width — IHDR 宽 */
  width?: number;
  /** IHDR height — IHDR 高 */
  height?: number;
  /** PLTE colors — PLTE 调色板 */
  palette?: [number, number, number][];
  /** Whether the first frame's IDAT run has fully arrived (a following chunk header was read) — 首帧 IDAT 连段是否已收完(其后 chunk 头已读到) */
  firstFrameReady?: boolean;
  /**
   * IDAT payload bytes arrived so far, counting the already-received part of
   * a chunk whose tail hasn't arrived yet — the static-progressive pipeline's
   * displayability signal (a tolerant decoder can inflate whatever is here).
   *
   * 目前已到达的 IDAT 负载字节数,含尾部尚未收全的 chunk 的已到部分——静态渐进管线的
   * 可显示信号(宽容解码器能 inflate 已有的这部分数据)。
   */
  idatBytes?: number;
}

/** Standalone IEND chunk bytes (len=0, CRC precomputed) — 独立 IEND chunk 字节(长度 0,CRC 预算好) */
export const IEND_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/**
 * Incrementally scan a PNG/APNG byte buffer.
 *
 * 增量扫描 PNG/APNG 字节缓冲。
 * @param buf - Bytes seen so far (may be partial) — 目前已收到的字节(可能不完整)
 * @returns Scan result — 扫描结果
 */
export function scanPng(buf: Uint8Array): PngScan {
  let width: number | undefined;
  let height: number | undefined;
  let palette: [number, number, number][] | undefined;
  let status: PngScan["status"] = "need-more";
  let sawACTL = false;
  let sawIDAT = false;
  let inIdatRun = false;
  let firstFrameReady = false;
  let idatBytes = 0;

  let p = 8;
  while (p + 8 <= buf.length) {
    const len = readBE32(buf, p);
    const total = 12 + len;
    const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);

    if (p + total > buf.length) {
      // Chunk tail not arrived — still count the received part of IDAT payload
      // toward displayability before breaking.
      // chunk 尾部未收全——break 前仍把 IDAT 负载的已到部分计入可显示信号。
      if (type === "IDAT") idatBytes += Math.max(0, Math.min(len, buf.length - (p + 8)));
      break;
    }

    const dataStart = p + 8;

    if (type === "IHDR") {
      width = readBE32(buf, dataStart);
      height = readBE32(buf, dataStart + 4);
    } else if (type === "PLTE") {
      palette = [];
      for (let i = dataStart; i + 3 <= dataStart + len; i += 3) palette.push([buf[i]!, buf[i + 1]!, buf[i + 2]!]);
    } else if (type === "acTL") {
      sawACTL = true;
    } else if (type === "IDAT") {
      if (!sawIDAT) {
        sawIDAT = true;
        status = sawACTL ? "animated" : "static";
      }
      inIdatRun = true;
      idatBytes += len;
    } else {
      if (sawIDAT && inIdatRun) firstFrameReady = true;
      inIdatRun = false;
    }

    p += total;
  }

  return { status, width, height, palette, firstFrameReady, idatBytes };
}

/**
 * Recompose a legal static PNG from the default image, dropping every
 * animation-only chunk (acTL/fcTL/fdAT) and appending a fresh IEND.
 *
 * 从默认图像重组出合法静态 PNG,剔除所有动画专属 chunk(acTL/fcTL/fdAT),补一个新 IEND。
 * @param buf - Full APNG bytes — 完整 APNG 字节
 * @returns Static PNG bytes — 静态 PNG 字节
 */
export function apngFirstFrame(buf: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [buf.subarray(0, 8)];
  let sawIDAT = false;
  let idatRunDone = false;

  let p = 8;
  while (p + 8 <= buf.length) {
    const len = readBE32(buf, p);
    const total = 12 + len;
    if (p + total > buf.length) break;

    const type = String.fromCharCode(buf[p + 4]!, buf[p + 5]!, buf[p + 6]!, buf[p + 7]!);

    if (type === "acTL" || type === "fcTL" || type === "fdAT" || type === "IEND") {
      p += total;
      continue;
    }

    if (type === "IDAT") {
      if (!idatRunDone) {
        parts.push(buf.subarray(p, p + total));
        sawIDAT = true;
      }
    } else {
      if (sawIDAT) idatRunDone = true;
      parts.push(buf.subarray(p, p + total));
    }

    p += total;
  }

  parts.push(IEND_BYTES);

  const totalLen = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}
