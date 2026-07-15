/**
 * Incremental animated-WebP (VP8X/ANIM/ANMF) walker and best-effort
 * first-frame repacker — structure only, no VP8/VP8L bitstream decoding.
 *
 * 增量动画 WebP(VP8X/ANIM/ANMF)遍历器 + 尝试性首帧重打包——只解结构,不解 VP8/VP8L 位流。
 */

import { asciiEquals, readLE24 } from "../bytes";

/**
 * Result of scanning a (possibly partial) WebP byte buffer.
 *
 * 扫描(可能不完整的)WebP 字节缓冲的结果。
 */
export interface WebpScan {
  /** need-more: header not fully arrived yet; static: no animation flag; animated: VP8X animation bit set — 头部未收全/无动画位/含动画位 */
  status: "need-more" | "static" | "animated";
  /** Canvas width from VP8X — VP8X 画布宽 */
  width?: number;
  /** Canvas height from VP8X — VP8X 画布高 */
  height?: number;
  /** [start, end) of the first fully-arrived ANMF chunk, header included — 首个完整到达的 ANMF chunk 区间(含头,前闭后开) */
  anmf?: [number, number];
}

/**
 * Read a little-endian uint32 (RIFF chunk size field).
 *
 * 读小端 32 位无符号整数(RIFF chunk 长度字段)。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Value — 数值
 */
function readLE32(buf: Uint8Array, off: number): number {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

/**
 * Write a little-endian uint24 in place.
 *
 * 原地写入小端 24 位无符号整数。
 * @param buf - Destination bytes — 目标字节
 * @param off - Byte offset — 偏移
 * @param value - Value to write — 待写入数值
 */
function writeLE24(buf: Uint8Array, off: number, value: number): void {
  buf[off] = value & 0xff;
  buf[off + 1] = (value >> 8) & 0xff;
  buf[off + 2] = (value >> 16) & 0xff;
}

/** RIFF chunk header: fourcc, declared (unpadded) data size, total bytes including even padding — RIFF chunk 头:四字符码、声明的(未补齐)数据长度、含补齐的总字节数 */
interface ChunkHeader {
  fourcc: string;
  size: number;
  total: number;
}

/**
 * Read one chunk header at offset; null when not enough bytes.
 *
 * 读取偏移处的 chunk 头;字节不足返回 null。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Header info or null — 头部信息或 null
 */
function readChunkHeader(buf: Uint8Array, off: number): ChunkHeader | null {
  if (off + 8 > buf.length) return null;
  const fourcc = String.fromCharCode(buf[off]!, buf[off + 1]!, buf[off + 2]!, buf[off + 3]!);
  const size = readLE32(buf, off + 4);
  return { fourcc, size, total: 8 + size + (size % 2) };
}

/**
 * Incrementally scan a WebP byte buffer for the VP8X animation flag and canvas size.
 *
 * 增量扫描 WebP 字节缓冲,判定 VP8X 动画位与画布尺寸。
 * @param buf - Bytes seen so far (may be partial) — 目前已收到的字节(可能不完整)
 * @returns Scan result — 扫描结果
 */
export function scanWebp(buf: Uint8Array): WebpScan {
  if (buf.length < 12) return { status: "need-more" };
  if (!asciiEquals(buf, 0, "RIFF") || !asciiEquals(buf, 8, "WEBP")) return { status: "static" };

  const first = readChunkHeader(buf, 12);
  if (!first) return { status: "need-more" };

  if (first.fourcc === "VP8 " || first.fourcc === "VP8L") return { status: "static" };
  if (first.fourcc !== "VP8X") return { status: "static" };
  if (12 + first.total > buf.length) return { status: "need-more" };
  if (first.size < 10) return { status: "static" };

  const dataStart = 12 + 8;
  const flags = buf[dataStart]!;
  const width = 1 + readLE24(buf, dataStart + 4);
  const height = 1 + readLE24(buf, dataStart + 7);
  if (!(flags & 0x02)) return { status: "static", width, height };

  let p = 12 + first.total;
  while (true) {
    const header = readChunkHeader(buf, p);
    if (!header) return { status: "need-more", width, height };
    if (p + header.total > buf.length) return { status: "need-more", width, height };
    if (header.fourcc === "ANMF") return { status: "animated", width, height, anmf: [p, p + header.total] };
    p += header.total;
  }
}

/**
 * Repack the first ANMF frame into a standalone WebP (simple format, or
 * VP8X+ALPH+VP8 when the frame carries alpha); null when structure is invalid.
 *
 * 将首个 ANMF 帧重打包为独立 WebP(简单格式,或含 alpha 时 VP8X+ALPH+VP8);结构不符返回 null。
 * @param buf - Full WebP bytes — 完整 WebP 字节
 * @param anmf - [start, end) from {@link scanWebp} — {@link scanWebp} 给出的区间
 * @returns Standalone WebP bytes, or null — 独立 WebP 字节,或 null
 */
export function webpFirstFrame(buf: Uint8Array, anmf: [number, number]): Uint8Array | null {
  const [start] = anmf;
  const size = readLE32(buf, start + 4);
  const dataStart = start + 8;
  const frameHeaderEnd = dataStart + 16;
  const subEnd = dataStart + size;
  if (frameHeaderEnd > buf.length || subEnd < frameHeaderEnd || subEnd > buf.length) return null;

  const frameHeader = buf.subarray(dataStart, frameHeaderEnd);
  const sub = buf.subarray(frameHeaderEnd, subEnd);

  const first = readChunkHeader(sub, 0);
  if (!first) return null;

  let alpha: Uint8Array | null = null;
  let bitstream: Uint8Array;
  if (first.fourcc === "ALPH") {
    alpha = sub.subarray(0, first.total);
    const second = readChunkHeader(sub, first.total);
    if (!second || (second.fourcc !== "VP8 " && second.fourcc !== "VP8L")) return null;
    if (first.total + second.total > sub.length) return null;
    bitstream = sub.subarray(first.total, first.total + second.total);
  } else if (first.fourcc === "VP8 " || first.fourcc === "VP8L") {
    if (first.total > sub.length) return null;
    bitstream = sub.subarray(0, first.total);
  } else {
    return null;
  }

  const frameWidth = 1 + readLE24(frameHeader, 6);
  const frameHeight = 1 + readLE24(frameHeader, 9);

  const chunks: Uint8Array[] = [];
  if (alpha) {
    const vp8xData = new Uint8Array(10);
    vp8xData[0] = 0x10; // alpha flag — alpha 标志位
    writeLE24(vp8xData, 4, frameWidth - 1);
    writeLE24(vp8xData, 7, frameHeight - 1);
    const vp8xHeader = new Uint8Array(8);
    vp8xHeader.set(Uint8Array.from("VP8X".split("").map((c) => c.charCodeAt(0))), 0);
    new DataView(vp8xHeader.buffer).setUint32(4, vp8xData.length, true);
    chunks.push(vp8xHeader, vp8xData, alpha, bitstream);
  } else {
    chunks.push(bitstream);
  }

  const bodyLen = 4 + chunks.reduce((n, c) => n + c.length, 0); // 'WEBP' + chunks
  const out = new Uint8Array(8 + bodyLen);
  out.set(Uint8Array.from([0x52, 0x49, 0x46, 0x46]), 0); // RIFF
  new DataView(out.buffer).setUint32(4, bodyLen, true);
  out.set(Uint8Array.from([0x57, 0x45, 0x42, 0x50]), 8); // WEBP
  let off = 12;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
