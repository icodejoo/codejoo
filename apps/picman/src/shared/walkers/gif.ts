/**
 * Incremental GIF container walker: animation detection, palette, first-frame
 * boundary — no LZW/pixel decoding, structure only.
 *
 * 增量 GIF 容器遍历器:动图判定、调色板、首帧边界——只解结构,不解 LZW 像素。
 */

import { asciiEquals, readLE16 } from "../bytes";

/**
 * Result of scanning a (possibly partial) GIF byte buffer.
 *
 * 扫描(可能不完整的)GIF 字节缓冲的结果。
 */
export interface GifScan {
  /** need-more: not enough bytes yet; static: single frame; animated: 2+ frames/loop ext — 需要更多字节/单帧静图/多帧或含循环扩展 */
  status: "need-more" | "static" | "animated";
  /** Logical screen width — 逻辑屏幕宽 */
  width?: number;
  /** Logical screen height — 逻辑屏幕高 */
  height?: number;
  /** Global Color Table colors, undefined when GCT absent — 全局调色板颜色,无 GCT 时为 undefined */
  palette?: [number, number, number][];
  /** Index right after the first frame's block terminator (0x00) — 首帧数据结束后一个索引(含终止符) */
  firstFrameEnd?: number;
}

/**
 * Walk a GIF sub-block sequence (size-prefixed chunks terminated by 0x00).
 *
 * 遍历 GIF 子块序列(长度前缀,以 0x00 终止)。
 * @param buf - Source bytes — 源字节
 * @param start - Index of the first size byte — 首个长度字节的索引
 * @returns Index right after the terminator, or -1 if data is insufficient — 终止符后索引,数据不足返回 -1
 */
function walkSubBlocks(buf: Uint8Array, start: number): number {
  let q = start;
  while (true) {
    if (q >= buf.length) return -1;
    const size = buf[q]!;
    if (size === 0x00) return q + 1;
    if (q + 1 + size > buf.length) return -1;
    q = q + 1 + size;
  }
}

/**
 * Incrementally scan a GIF byte buffer for size/palette/animation/first-frame.
 *
 * 增量扫描 GIF 字节缓冲,得到尺寸/调色板/动图判定/首帧边界。
 * @param buf - Bytes seen so far (may be partial) — 目前已收到的字节(可能不完整)
 * @returns Scan result — 扫描结果
 */
export function scanGif(buf: Uint8Array): GifScan {
  if (buf.length < 13) return { status: "need-more" };
  if (!asciiEquals(buf, 0, "GIF87a") && !asciiEquals(buf, 0, "GIF89a")) return { status: "static" };

  const width = readLE16(buf, 6);
  const height = readLE16(buf, 8);
  const packed = buf[10]!;
  const gctSize = packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0;
  const gctEnd = 13 + gctSize;
  if (buf.length < gctEnd) return { status: "need-more", width, height };

  let palette: [number, number, number][] | undefined;
  if (gctSize > 0) {
    palette = [];
    for (let i = 13; i < gctEnd; i += 3) palette.push([buf[i]!, buf[i + 1]!, buf[i + 2]!]);
  }

  let animated = false;
  let imageCount = 0;
  let firstFrameEnd: number | undefined;
  let q = gctEnd;

  const needMore = (): GifScan => ({ status: "need-more", width, height, palette, firstFrameEnd });

  while (true) {
    if (animated && firstFrameEnd !== undefined) return { status: "animated", width, height, palette, firstFrameEnd };
    if (q >= buf.length) return needMore();

    const marker = buf[q]!;

    if (marker === 0x3b) {
      return { status: animated ? "animated" : "static", width, height, palette, firstFrameEnd };
    }

    if (marker === 0x21) {
      if (q + 1 >= buf.length) return needMore();
      // Extension sub-blocks are skipped structurally; animation is decided
      // purely by frame count (a Netscape loop ext with 1 frame recomposes
      // to a legal static GIF, so it must not flag 'animated' on its own).
      //
      // 扩展子块只做结构跳过;动图判定只看帧数(仅含 Netscape 循环扩展的单帧
      // 重组产物必须仍是合法静图,故该扩展本身不参与 'animated' 判定)。
      const next = walkSubBlocks(buf, q + 2);
      if (next === -1) return needMore();
      q = next;
      continue;
    }

    if (marker === 0x2c) {
      imageCount++;
      if (imageCount >= 2) animated = true;
      const descStart = q + 1;
      const descEnd = descStart + 9;
      if (buf.length < descEnd) return needMore();
      const imgPacked = buf[descStart + 8]!;
      const lctSize = imgPacked & 0x80 ? 3 * 2 ** ((imgPacked & 7) + 1) : 0;
      const afterDesc = descEnd + lctSize;
      if (buf.length <= afterDesc) return needMore(); // +1 for LZW min-code byte
      const subBlocksStart = afterDesc + 1;
      const subEnd = walkSubBlocks(buf, subBlocksStart);
      if (subEnd === -1) return needMore();
      if (imageCount === 1) firstFrameEnd = subEnd;
      q = subEnd;
      continue;
    }

    // Unrecognized block byte — treat as non-animated/static per spec.
    // 未知块字节——按 spec 判静图。
    return { status: "static", width, height, palette, firstFrameEnd };
  }
}

/**
 * Recompose a legal single-frame GIF from the first-frame boundary.
 *
 * 用首帧边界重组出合法的单帧 GIF。
 * @param buf - Full (or sufficiently long) GIF bytes — 完整(或足够长)的 GIF 字节
 * @param firstFrameEnd - Boundary from {@link scanGif} — {@link scanGif} 给出的边界
 * @returns Bytes ending in the GIF trailer (0x3B) — 以 GIF trailer(0x3B)结尾的字节
 */
export function gifFirstFrame(buf: Uint8Array, firstFrameEnd: number): Uint8Array {
  const out = new Uint8Array(firstFrameEnd + 1);
  out.set(buf.subarray(0, firstFrameEnd), 0);
  out[firstFrameEnd] = 0x3b;
  return out;
}
