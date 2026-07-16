/**
 * Programmatic fixtures: minimal structurally-valid animated images.
 * No real codec needed — walkers only parse container structure.
 *
 * 程序化生成的最小合法动图 fixtures。走结构层解析,不需要真实编解码。
 */

import { concatBytes } from "../src/shared/bytes";

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
  const typeBytes = Uint8Array.from(type.split("").map((c) => c.charCodeAt(0)));
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
    const fourccBytes = Uint8Array.from(fourcc.split("").map((c) => c.charCodeAt(0)));
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

/** Big-endian uint32 bytes — 大端 32 位字节 */
function isoU32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

/** ASCII 4-char tag bytes — ASCII 4 字符标签字节 */
function isoFourcc(s: string): Uint8Array {
  return Uint8Array.from(s.split("").map((c) => c.charCodeAt(0)));
}

/**
 * Build one ISOBMFF box: size(4, big-endian, self-inclusive) + type(4) + body.
 *
 * 构造单个 ISOBMFF box:size(4,大端,含自身) + type(4) + body。
 * @param type - 4-char box type — 4 字符 box 类型
 * @param parts - Body segments — body 分段
 * @returns Encoded box bytes — 编码后的 box 字节
 */
function isoBox(type: string, ...parts: Uint8Array[]): Uint8Array {
  const totalLen = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + totalLen);
  out.set(isoU32(8 + totalLen), 0);
  out.set(isoFourcc(type), 4);
  let off = 8;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Build one ISOBMFF FullBox: box(type, version+flags(4) + body).
 *
 * 构造单个 ISOBMFF FullBox:box(type, version+flags(4) + body)。
 * @param type - 4-char box type — 4 字符 box 类型
 * @param version - FullBox version byte — FullBox version 字节
 * @param parts - Body segments — body 分段
 * @returns Encoded box bytes — 编码后的 box 字节
 */
function isoFullBox(type: string, version: number, ...parts: Uint8Array[]): Uint8Array {
  return isoBox(type, Uint8Array.from([version, 0, 0, 0]), ...parts);
}

/**
 * Build a minimal (animated) AVIF: ftyp(+moov/trak/mdia/minf/stbl[stsd(av01+av1C)/stsz/stco]) or
 * a bare static ftyp+mdat. Only the boxes {@link scanAvif}/{@link parseMoov} actually inspect are
 * included — sibling boxes real decoders would want (vmhd/dinf/tkhd/mdhd/hdlr) are omitted.
 *
 * 构造最小(动画)AVIF:ftyp(+moov/trak/mdia/minf/stbl[stsd(av01+av1C)/stsz/stco])或裸 ftyp+mdat 静态形态。
 * 只包含 {@link scanAvif}/`parseMoov` 实际会读取的 box——真实解码器会要的兄弟 box(vmhd/dinf/tkhd/mdhd/hdlr)一律省略。
 * @param opts - animated: include moov/avis brand; sampleBytes: first sample's dummy payload
 * @returns AVIF bytes — AVIF 字节
 */
export function makeAvif(opts: { animated: boolean; sampleBytes?: Uint8Array; width?: number; height?: number }): Uint8Array {
  const { animated, sampleBytes = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]), width = 4, height = 4 } = opts;

  if (!animated) {
    const ftyp = isoBox("ftyp", isoFourcc("avif"), isoU32(0), isoFourcc("avif"), isoFourcc("mif1"));
    return concatBytes([ftyp, isoBox("mdat", sampleBytes)]);
  }

  const ftyp = isoBox("ftyp", isoFourcc("avis"), isoU32(0), isoFourcc("avif"), isoFourcc("avis"), isoFourcc("mif1"), isoFourcc("miaf"));

  const av1C = isoBox("av1C", Uint8Array.from([0x81, 0x08, 0x00, 0x00]));
  const sampleEntryFixed = new Uint8Array(78);
  new DataView(sampleEntryFixed.buffer).setUint16(24, width, false);
  new DataView(sampleEntryFixed.buffer).setUint16(26, height, false);
  const av01 = isoBox("av01", sampleEntryFixed, av1C);
  const stsd = isoFullBox("stsd", 0, isoU32(1), av01);
  const stsz = isoFullBox("stsz", 0, isoU32(sampleBytes.length), isoU32(1));

  // Two-pass build: box lengths are independent of stco's offset VALUE (u32
  // slot is fixed-width), so build once with a placeholder to measure the
  // pre-mdat length, then rebuild with the real offset.
  //
  // 两遍构建:各 box 长度与 stco 偏移的具体数值无关(u32 槽位定长),先用占位值构一遍
  // 量出 mdat 前的总长度,再用真实偏移重新构建。
  const buildMoov = (mdatOffset: number): Uint8Array => {
    const stco = isoFullBox("stco", 0, isoU32(1), isoU32(mdatOffset));
    const stbl = isoBox("stbl", stsd, stsz, stco);
    const minf = isoBox("minf", stbl);
    const mdia = isoBox("mdia", minf);
    const trak = isoBox("trak", mdia);
    return isoBox("moov", trak);
  };

  const moovPass1 = buildMoov(0);
  const mdatOffset = ftyp.length + moovPass1.length + 8;
  const moov = buildMoov(mdatOffset);
  const mdat = isoBox("mdat", sampleBytes);

  return concatBytes([ftyp, moov, mdat]);
}

/**
 * Build a minimal structurally-valid JPEG: SOI + SOF0/SOF2 + SOS + entropy
 * bytes (+ optionally the first-scan-end marker for progressive) + EOI.
 * Not required to decode — walkers only parse marker structure.
 *
 * 构造最小结构合法 JPEG:SOI+SOF0/SOF2+SOS+熵编码字节(渐进式可选首 scan 结束
 * marker)+EOI。不要求可解码——walker 只解析 marker 结构。
 * @param opts - progressive: use SOF2; scanBytes: entropy byte count; endFirstScan: append a second SOS after the entropy run (progressive first-scan-complete signal)
 * @returns JPEG bytes — JPEG 字节
 */
export function makeJpeg(opts: { progressive?: boolean; scanBytes?: number; endFirstScan?: boolean; width?: number; height?: number }): Uint8Array {
  const { progressive = false, scanBytes = 8192, endFirstScan = false, width = 100, height = 100 } = opts;
  const parts: number[] = [];
  parts.push(0xff, 0xd8); // SOI

  // SOF0(baseline)/SOF2(progressive): len(2)+precision(1)+h(2)+w(2)+components(1+3×1)
  parts.push(0xff, progressive ? 0xc2 : 0xc0);
  parts.push(0x00, 0x0b); // segment length 11
  parts.push(8); // precision
  parts.push((height >> 8) & 0xff, height & 0xff);
  parts.push((width >> 8) & 0xff, width & 0xff);
  parts.push(1, 0x01, 0x11, 0x00); // 1 component

  // SOS: len(2)+components(1+2)+spectral(3)
  parts.push(0xff, 0xda);
  parts.push(0x00, 0x08);
  parts.push(1, 0x01, 0x00, 0x00, 0x3f, 0x00);

  // Entropy-coded bytes — avoid 0xFF to keep the scan unterminated — 熵编码字节,避开 0xFF 以免提前终止 scan
  for (let i = 0; i < scanBytes; i++) parts.push(i % 255 === 0xff ? 0x00 : i % 255);

  if (endFirstScan) {
    // A second SOS marks the first scan's end (progressive) — 第二个 SOS 标记首 scan 结束(渐进式)
    parts.push(0xff, 0xda);
    parts.push(0x00, 0x08);
    parts.push(1, 0x01, 0x10, 0x00, 0x3f, 0x00);
    for (let i = 0; i < 64; i++) parts.push(i % 200);
  }

  parts.push(0xff, 0xd9); // EOI
  return Uint8Array.from(parts);
}

/**
 * Build a large static PNG whose IDAT payload totals `idatBytes`, split into
 * multiple chunks — for exercising the static-progressive displayability signal.
 *
 * 构造 IDAT 负载总量为 `idatBytes`、分多个 chunk 的大静态 PNG——用于测试静态渐进
 * 可显示信号。
 * @param opts - idatBytes: total IDAT payload bytes; chunkSize: per-IDAT payload size; interlaced: set the IHDR Adam7 interlace flag
 * @returns PNG bytes — PNG 字节
 */
export function makeBigPng(opts: { idatBytes: number; chunkSize?: number; interlaced?: boolean }): Uint8Array {
  const { idatBytes, chunkSize = 4096, interlaced = false } = opts;
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, 100, false); // width
  ihdrView.setUint32(4, 100, false); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor
  ihdrData[12] = interlaced ? 1 : 0; // interlace method: Adam7 or none
  const parts: Uint8Array[] = [sig, pngChunk("IHDR", ihdrData)];

  let remaining = idatBytes;
  let seed = 0;
  while (remaining > 0) {
    const n = Math.min(chunkSize, remaining);
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) data[i] = (seed + i) % 251;
    parts.push(pngChunk("IDAT", data));
    remaining -= n;
    seed++;
  }

  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return concatBytes(parts);
}
