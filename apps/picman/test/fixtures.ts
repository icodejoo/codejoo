/**
 * Programmatic fixtures: minimal structurally-valid animated images.
 * No real codec needed — walkers only parse container structure.
 *
 * 程序化生成的最小合法动图 fixtures。走结构层解析,不需要真实编解码。
 */

/**
 * Standard CRC-32 (polynomial 0xEDB88320), used by PNG chunks.
 *
 * 标准 CRC-32(多项式 0xEDB88320),PNG chunk 校验用。
 * @param bytes - Input bytes — 输入字节
 * @returns Unsigned 32-bit CRC — 32 位无符号 CRC
 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build one PNG chunk: length + type + data + CRC (over type+data).
 *
 * 构造单个 PNG chunk:长度 + 类型 + 数据 + CRC(覆盖 type+data)。
 * @param type - 4-char chunk type — 4 字符 chunk 类型
 * @param data - Chunk payload — chunk 数据
 * @returns Encoded chunk bytes — 编码后的 chunk 字节
 */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((c) => c.charCodeAt(0)));
  const typeAndData = new Uint8Array(typeBytes.length + data.length);
  typeAndData.set(typeBytes, 0);
  typeAndData.set(data, typeBytes.length);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(typeAndData), false);
  const out = new Uint8Array(4 + typeAndData.length + 4);
  out.set(len, 0);
  out.set(typeAndData, 4);
  out.set(crc, 4 + typeAndData.length);
  return out;
}

// Fixed 4-color test palette (black/white/red/green) — 固定 4 色测试调色板
const TEST_PALETTE: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 0, 0],
  [0, 255, 0],
];

/**
 * Build a minimal structurally-valid GIF (not required to decode).
 *
 * 构造最小的结构合法 GIF(不要求可解码)。
 * @param opts - frames: frame count; loop: add Netscape loop ext; width/height: LSD size
 * @returns GIF bytes — GIF 字节
 */
export function makeGif(opts: { frames: number; loop?: boolean; width?: number; height?: number }): Uint8Array {
  const { frames, loop = false, width = 2, height = 2 } = opts;
  const parts: number[] = [];
  // Header — 头
  parts.push(..."GIF89a".split("").map((c) => c.charCodeAt(0)));
  // Logical Screen Descriptor — 逻辑屏幕描述符
  parts.push(width & 0xff, (width >> 8) & 0xff);
  parts.push(height & 0xff, (height >> 8) & 0xff);
  parts.push(0x91); // packed: GCT present, 4 colors
  parts.push(0x00, 0x00); // bg color index, pixel aspect ratio
  // Global Color Table (4 colors × 3 bytes) — 全局调色板
  for (const [r, g, b] of TEST_PALETTE) parts.push(r, g, b);
  if (loop) {
    parts.push(0x21, 0xff, 0x0b);
    parts.push(..."NETSCAPE2.0".split("").map((c) => c.charCodeAt(0)));
    parts.push(0x03, 0x01, 0x00, 0x00, 0x00);
  }
  for (let i = 0; i < frames; i++) {
    // Graphic Control Extension — 图形控制扩展
    parts.push(0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00);
    // Image Descriptor (no LCT) — 图像描述符(无局部调色板)
    parts.push(0x2c);
    parts.push(0x00, 0x00, 0x00, 0x00); // left, top
    parts.push(width & 0xff, (width >> 8) & 0xff);
    parts.push(height & 0xff, (height >> 8) & 0xff);
    parts.push(0x00); // packed
    // LZW minimum code size + one data sub-block + terminator
    parts.push(0x02, 0x04, 0x01, 0x02, 0x03, 0x04, 0x00);
  }
  parts.push(0x3b); // trailer
  return Uint8Array.from(parts);
}

/**
 * Build a minimal (A)PNG: sig + IHDR (+acTL+fcTL) + PLTE + IDAT×2 (+fdAT) + IEND.
 *
 * 构造最小 (A)PNG:sig+IHDR(+acTL+fcTL)+PLTE+IDAT×2+(fdAT)+IEND。
 * @param opts - animated: whether to include acTL/fcTL/fdAT
 * @returns PNG bytes — PNG 字节
 */
export function makeApng(opts: { animated: boolean }): Uint8Array {
  const { animated } = opts;
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, 2, false); // width
  ihdrView.setUint32(4, 2, false); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 3; // color type: palette
  const ihdr = pngChunk("IHDR", ihdrData);

  const plteData = new Uint8Array(TEST_PALETTE.length * 3);
  TEST_PALETTE.forEach(([r, g, b], i) => {
    plteData[i * 3] = r;
    plteData[i * 3 + 1] = g;
    plteData[i * 3 + 2] = b;
  });
  const plte = pngChunk("PLTE", plteData);

  const parts: Uint8Array[] = [sig, ihdr];

  if (animated) {
    const actlData = new Uint8Array(8);
    new DataView(actlData.buffer).setUint32(0, 2, false); // numFrames
    new DataView(actlData.buffer).setUint32(4, 0, false); // numPlays (infinite)
    parts.push(pngChunk("acTL", actlData));
  }

  parts.push(plte);

  if (animated) {
    const fctlData = new Uint8Array(26);
    parts.push(pngChunk("fcTL", fctlData));
  }

  parts.push(pngChunk("IDAT", new Uint8Array([1, 2, 3, 4])));

  if (animated) {
    const fdatData = new Uint8Array(4 + 4);
    new DataView(fdatData.buffer).setUint32(0, 1, false); // sequence number
    parts.push(pngChunk("fdAT", fdatData));
  }

  parts.push(pngChunk("IEND", new Uint8Array(0)));

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
 * Build a minimal (animated) WebP: RIFF+VP8X(+ANIM+ANMF[VP8/VP8L(+ALPH)]) or plain.
 *
 * 构造最小(动画)WebP:RIFF+VP8X(+ANIM+ANMF[VP8/VP8L(+ALPH)])或简单格式。
 * @param opts - animated: include VP8X+ANIM+ANMF; alpha: prefix ALPH inside ANMF
 * @returns WebP bytes — WebP 字节
 */
export function makeWebp(opts: { animated: boolean; alpha?: boolean }): Uint8Array {
  const { animated, alpha = false } = opts;

  const chunk = (fourcc: string, data: Uint8Array): Uint8Array => {
    const fourccBytes = Uint8Array.from([...fourcc].map((c) => c.charCodeAt(0)));
    const padded = data.length % 2 === 1 ? new Uint8Array(data.length + 1) : data;
    if (padded !== data) padded.set(data, 0);
    const out = new Uint8Array(4 + 4 + padded.length);
    out.set(fourccBytes, 0);
    new DataView(out.buffer).setUint32(4, data.length, true);
    out.set(padded, 8);
    return out;
  };

  const bitstream = Uint8Array.from([0x10, 0x20, 0x30, 0x40]);
  const chunks: Uint8Array[] = [];

  if (!animated) {
    chunks.push(chunk("VP8 ", bitstream));
  } else {
    const vp8xData = new Uint8Array(10);
    vp8xData[0] = 0x02; // animation flag
    // canvas width-1 / height-1, 24-bit LE
    vp8xData[4] = 1;
    vp8xData[7] = 1;
    chunks.push(chunk("VP8X", vp8xData));
    chunks.push(chunk("ANIM", new Uint8Array(6)));

    const frameHeader = new Uint8Array(16);
    frameHeader[6] = 1; // frame width-1
    frameHeader[9] = 1; // frame height-1
    let sub: Uint8Array;
    if (alpha) {
      const alph = chunk("ALPH", Uint8Array.from([0x00, 0x01]));
      const vp8 = chunk("VP8 ", bitstream);
      sub = new Uint8Array(alph.length + vp8.length);
      sub.set(alph, 0);
      sub.set(vp8, alph.length);
    } else {
      sub = chunk("VP8 ", bitstream);
    }
    const anmfData = new Uint8Array(frameHeader.length + sub.length);
    anmfData.set(frameHeader, 0);
    anmfData.set(sub, frameHeader.length);
    chunks.push(chunk("ANMF", anmfData));
  }

  const bodyLen = chunks.reduce((n, c) => n + c.length, 0);
  const riffSize = 4 + bodyLen; // 'WEBP' + chunks
  const out = new Uint8Array(8 + riffSize);
  out.set(Uint8Array.from([0x52, 0x49, 0x46, 0x46]), 0); // RIFF
  new DataView(out.buffer).setUint32(4, riffSize, true);
  out.set(Uint8Array.from([0x57, 0x45, 0x42, 0x50]), 8); // WEBP
  let off = 12;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
