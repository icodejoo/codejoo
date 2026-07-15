/**
 * Byte-level helpers shared by all format walkers. Environment-free.
 *
 * 各格式遍历器共用的字节工具,零环境依赖。
 */

/**
 * Concatenate byte chunks into one array.
 *
 * 将多段字节拼接为一个数组。
 * @param parts - Chunks to join — 待拼接的分段
 * @returns Joined bytes — 拼接结果
 */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  // Total output length — 输出总长
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Read little-endian uint16.
 *
 * 读小端 16 位无符号整数。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Value — 数值
 */
export function readLE16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}

/**
 * Read little-endian uint24.
 *
 * 读小端 24 位无符号整数。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Value — 数值
 */
export function readLE24(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16);
}

/**
 * Read big-endian uint32.
 *
 * 读大端 32 位无符号整数。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Value — 数值
 */
export function readBE32(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
}

/**
 * Compare bytes at offset against an ASCII string; false when out of range.
 *
 * 比较偏移处字节与 ASCII 串;越界返回 false。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @param text - ASCII text — ASCII 文本
 * @returns Whether equal — 是否相等
 */
export function asciiEquals(buf: Uint8Array, off: number, text: string): boolean {
  if (off + text.length > buf.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[off + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Growable byte buffer with amortized O(1) append (doubling capacity),
 * avoiding O(n²) per-chunk concatenation while streaming.
 *
 * 容量倍增的可增长字节缓冲,append 均摊 O(1),避免流式过程中逐 chunk 拼接的 O(n²)。
 */
export class ByteAccumulator {
  // Backing store — 底层存储
  private buf = new Uint8Array(64 * 1024);

  // Bytes written — 已写入字节数
  private len = 0;

  /**
   * Append one chunk.
   *
   * 追加一段字节。
   * @param chunk - Incoming bytes — 新到字节
   */
  append(chunk: Uint8Array): void {
    if (this.len + chunk.length > this.buf.length) {
      // Grow by doubling until it fits — 倍增扩容直到装下
      let cap = this.buf.length * 2;
      while (cap < this.len + chunk.length) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
  }

  /**
   * Current byte count.
   *
   * 当前字节数。
   */
  get length(): number {
    return this.len;
  }

  /**
   * Zero-copy view of accumulated bytes (valid until next append).
   *
   * 已累积字节的零拷贝视图(下次 append 前有效)。
   * @returns Byte view — 字节视图
   */
  view(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}
