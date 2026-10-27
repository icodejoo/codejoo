/**
 * Incremental AVIF (ISOBMFF/HEIF) container walker: ftyp-brand-based animation
 * detection, first-sample byte range + av1C extraction from the `moov` sample
 * table, and a still-image (`meta`/`iloc`-based) first-frame repacker — no AV1
 * bitstream decoding, structure only.
 *
 * 增量 AVIF(ISOBMFF/HEIF)容器遍历器:基于 ftyp brand 的动图判定、从 `moov` 样本表提取
 * 首样本字节区间与 av1C、以及基于 `meta`/`iloc` 的静态首帧重打包——只解结构,不解 AV1 位流。
 *
 * 支持范围说明:仅支持 32 位 box size(不支持 largesize/size==0 到文件尾的写法);
 * 首帧提取仅取第一个 `trak` 的样本表,按 spec 样本 1 恒为 chunk 1 起始样本这一事实,
 * 直接用 stco/co64 首个 offset + stsz 首个 size 定位,无需解析 stsc。
 */

import { asciiEquals, concatBytes, readBE16, readBE32, readFourCC } from "../bytes";

/**
 * Byte range of the first coded sample (AV1 OBU stream) inside the original buffer.
 *
 * 首个编码样本(AV1 OBU 码流)在原始缓冲中的字节区间。
 */
export interface AvifSampleRange {
  /** Absolute byte offset of the sample — 样本绝对字节偏移 */
  offset: number;
  /** Sample byte length — 样本字节长度 */
  size: number;
}

/**
 * Result of scanning a (possibly partial) AVIF byte buffer.
 *
 * 扫描(可能不完整的)AVIF 字节缓冲的结果。
 */
export interface AvifScan {
  /** need-more: structural boxes not fully arrived; static: single still image (no `moov`); animated: `avis`-branded sequence — 结构性 box 未收全/单帧静图(无 moov)/avis 品牌动图序列 */
  status: "need-more" | "static" | "animated";
  /** Display width from the sample entry — 样本描述项中的显示宽 */
  width?: number;
  /** Display height from the sample entry — 样本描述项中的显示高 */
  height?: number;
  /** First sample's byte range in `mdat`, once resolvable from `stbl` — 首样本在 mdat 中的字节区间(一旦可从 stbl 解出) */
  firstSample?: AvifSampleRange;
  /** Raw `av1C` box bytes (header included), copied verbatim into the repacked still image — 原始 av1C box 字节(含 box 头),原样拷入重打包的静态图 */
  av1C?: Uint8Array;
}

/** One parsed top-level/child box's content range — 单个已解析 box 的内容区间 */
interface BoxRange {
  dataStart: number;
  dataEnd: number;
}

/**
 * Find the first immediate child box of `type` within `[start, end)`; null if
 * absent or a child's declared size isn't fully within range.
 *
 * 在 `[start, end)` 内查找第一个类型为 `type` 的直接子 box;不存在或子 box 声明长度
 * 超出该区间时返回 null。
 * @param buf - Source bytes — 源字节
 * @param start - Range start — 区间起点
 * @param end - Range end (exclusive) — 区间终点(不含)
 * @param type - 4-char box type — 4 字符 box 类型
 * @returns Matched child's content range, or null — 匹配子 box 的内容区间,或 null
 */
function findChildBox(buf: Uint8Array, start: number, end: number, type: string): BoxRange | null {
  let p = start;
  while (p + 8 <= end) {
    const size = readBE32(buf, p);
    if (size < 8 || p + size > end) return null;
    if (readFourCC(buf, p + 4) === type) return { dataStart: p + 8, dataEnd: p + size };
    p += size;
  }
  return null;
}

/** VisualSampleEntry fixed-field length after its 8-byte box header (reserved[6]+data_ref_index[2]+predefined/reserved[16]+width[2]+height[2]+resolutions[8]+reserved[4]+frame_count[2]+compressorname[32]+depth[2]+predefined[2]) — VisualSampleEntry box 头后的定长字段长度 */
const VISUAL_SAMPLE_ENTRY_FIXED_LEN = 78;

/**
 * Descend `moov > trak(first) > mdia > minf > stbl` to resolve display size,
 * the first sample's byte range, and its `av1C` config box.
 *
 * 下钻 `moov > trak(第一个) > mdia > minf > stbl`,解出显示尺寸、首样本字节区间与 `av1C` 配置 box。
 * @param buf - Source bytes — 源字节
 * @param start - `moov` content start — moov 内容起点
 * @param end - `moov` content end — moov 内容终点
 * @returns Partial/complete resolution, or null when the track structure doesn't match expectations — 部分/完整解析结果,轨道结构不符时为 null
 */
function parseMoov(buf: Uint8Array, start: number, end: number): { width?: number; height?: number; firstSample?: AvifSampleRange; av1C?: Uint8Array } | null {
  const trak = findChildBox(buf, start, end, "trak");
  if (!trak) return null;
  const mdia = findChildBox(buf, trak.dataStart, trak.dataEnd, "mdia");
  if (!mdia) return null;
  const minf = findChildBox(buf, mdia.dataStart, mdia.dataEnd, "minf");
  if (!minf) return null;
  const stbl = findChildBox(buf, minf.dataStart, minf.dataEnd, "stbl");
  if (!stbl) return null;

  const stsd = findChildBox(buf, stbl.dataStart, stbl.dataEnd, "stsd");
  if (!stsd) return null;

  // stsd: fullbox(4) + entry_count(4), first SampleEntry starts right after — stsd:fullbox(4)+entry_count(4),首个 SampleEntry 紧随其后
  const entryStart = stsd.dataStart + 8;
  if (entryStart + 8 > stsd.dataEnd) return null;
  const entrySize = readBE32(buf, entryStart);
  if (entryStart + entrySize > stsd.dataEnd) return null;
  const entryDataStart = entryStart + 8; // past this SampleEntry's own size+type — 跳过该 SampleEntry 自身的 size+type

  const fixedEnd = entryDataStart + VISUAL_SAMPLE_ENTRY_FIXED_LEN;
  if (fixedEnd > entryStart + entrySize) return { width: undefined, height: undefined };
  const width = readBE16(buf, entryDataStart + 24);
  const height = readBE16(buf, entryDataStart + 26);

  const av1CBox = findChildBox(buf, fixedEnd, entryStart + entrySize, "av1C");
  const av1C = av1CBox ? buf.slice(av1CBox.dataStart - 8, av1CBox.dataEnd) : undefined;

  const stsz = findChildBox(buf, stbl.dataStart, stbl.dataEnd, "stsz");
  const stco = findChildBox(buf, stbl.dataStart, stbl.dataEnd, "stco");
  const co64 = stco ? null : findChildBox(buf, stbl.dataStart, stbl.dataEnd, "co64");
  if (!stsz || !av1C || (!stco && !co64)) return { width, height, av1C };

  // stsz: fullbox(4) + sample_size(4) + sample_count(4) [+ per-sample sizes if sample_size==0] — stsz:fullbox(4)+样本统一大小(4)+样本数(4)[样本大小为0时后跟逐样本大小表]
  const uniformSize = readBE32(buf, stsz.dataStart + 4);
  let firstSize: number;
  if (uniformSize !== 0) {
    firstSize = uniformSize;
  } else {
    const sizesStart = stsz.dataStart + 12;
    if (sizesStart + 4 > stsz.dataEnd) return { width, height, av1C };
    firstSize = readBE32(buf, sizesStart);
  }

  // Sample 1 is, by spec, always the first sample of chunk 1 — so its offset is
  // simply chunk-offset-table entry 0, with no need to interpret stsc at all.
  // 按 spec,样本 1 恒为 chunk 1 的首个样本——其偏移就是 chunk 偏移表的第 0 项,完全无需解析 stsc。
  let firstOffset: number;
  if (stco) {
    const offStart = stco.dataStart + 8;
    if (offStart + 4 > stco.dataEnd) return { width, height, av1C };
    firstOffset = readBE32(buf, offStart);
  } else {
    const offStart = co64!.dataStart + 8;
    if (offStart + 8 > co64!.dataEnd) return { width, height, av1C };
    firstOffset = readBE32(buf, offStart) * 4294967296 + readBE32(buf, offStart + 4);
  }

  return { width, height, av1C, firstSample: { offset: firstOffset, size: firstSize } };
}

/**
 * Incrementally scan an AVIF byte buffer for animation status, display size,
 * and (once resolvable) the first sample's byte range + codec config.
 *
 * 增量扫描 AVIF 字节缓冲,判定动图状态、显示尺寸,以及(一旦可解出)首样本字节区间与编解码配置。
 * @param buf - Bytes seen so far (may be partial) — 目前已收到的字节(可能不完整)
 * @returns Scan result — 扫描结果
 */
export function scanAvif(buf: Uint8Array): AvifScan {
  if (buf.length < 16 || !asciiEquals(buf, 4, "ftyp")) return { status: "need-more" };

  const ftypSize = readBE32(buf, 0);
  if (ftypSize < 16) return { status: "static" };
  if (ftypSize > buf.length) return { status: "need-more" };

  const major = readFourCC(buf, 8);
  let isAvifFamily = major === "avif" || major === "avis";
  let isAnimated = major === "avis";
  for (let i = 16; i + 4 <= ftypSize; i += 4) {
    const brand = readFourCC(buf, i);
    if (brand === "avif" || brand === "avis") isAvifFamily = true;
    if (brand === "avis") isAnimated = true;
  }
  if (!isAvifFamily || !isAnimated) return { status: "static" };

  // Walk remaining top-level boxes looking for 'moov'; 'mdat' reached first
  // means an unexpected layout — bail to 'animated' without first-frame info
  // rather than mis-reporting 'static' for a genuinely animated brand.
  //
  // 继续遍历后续顶层 box 找 'moov';先遇到 'mdat' 说明布局出乎预期——退化为无首帧信息的
  // 'animated',而不是把确凿的 animated 品牌误判成 'static'。
  let p = ftypSize;
  while (p + 8 <= buf.length) {
    const size = readBE32(buf, p);
    const type = readFourCC(buf, p + 4);
    if (size < 8) return { status: "animated" };
    if (type === "mdat") return { status: "animated" };
    if (p + size > buf.length) return { status: "need-more" };
    if (type === "moov") {
      const info = parseMoov(buf, p + 8, p + size);
      return { status: "animated", width: info?.width, height: info?.height, firstSample: info?.firstSample, av1C: info?.av1C };
    }
    p += size;
  }
  return { status: "need-more" };
}

/** Big-endian uint32 bytes — 大端 32 位字节 */
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

/** Big-endian uint16 bytes — 大端 16 位字节 */
function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, false);
  return b;
}

/** ASCII 4-char tag bytes — ASCII 4 字符标签字节 */
function fourcc(s: string): Uint8Array {
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
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concatBytes(parts);
  return concatBytes([u32(8 + body.length), fourcc(type), body]);
}

/**
 * Build one ISOBMFF FullBox: box(type, version+flags(4) + body).
 *
 * 构造单个 ISOBMFF FullBox:box(type, version+flags(4) + body)。
 * @param type - 4-char box type — 4 字符 box 类型
 * @param version - FullBox version byte — FullBox version 字节
 * @param flags - 24-bit flags (packed into the low 3 bytes) — 24 位 flags(打包进低 3 字节)
 * @param parts - Body segments — body 分段
 * @returns Encoded box bytes — 编码后的 box 字节
 */
function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
  const vf = new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]);
  return box(type, vf, ...parts);
}

/**
 * Repack the first sample into a legal single-image (still) AVIF: a
 * `meta`/`iloc`-based HEIF item pointing at the sample's coded bytes in a
 * fresh `mdat`, carrying the original `av1C` config verbatim. No `moov` —
 * this alone makes {@link scanAvif} classify the result as 'static'.
 *
 * 将首个样本重打包为合法的单帧(静态)AVIF:基于 `meta`/`iloc` 的 HEIF item,指向新
 * `mdat` 中的样本编码字节,原样带上原始 `av1C` 配置。不含 `moov`——仅此一点就足以让
 * {@link scanAvif} 把重打包结果判定为 'static'。
 * @param sampleBytes - First sample's coded AV1 bytes — 首样本的 AV1 编码字节
 * @param av1CBox - Raw `av1C` box bytes (header included) — 原始 av1C box 字节(含 box 头)
 * @param width - Display width — 显示宽
 * @param height - Display height — 显示高
 * @returns Standalone still-image AVIF bytes — 独立的静态图 AVIF 字节
 */
export function avifFirstFrame(sampleBytes: Uint8Array, av1CBox: Uint8Array, width: number, height: number): Uint8Array {
  const ftyp = box("ftyp", fourcc("avif"), u32(0), fourcc("avif"), fourcc("mif1"), fourcc("miaf"));

  const hdlr = fullBox("hdlr", 0, 0, u32(0), fourcc("pict"), new Uint8Array(12), new Uint8Array(1));
  const pitm = fullBox("pitm", 0, 0, u16(1));
  const infe = fullBox("infe", 2, 0, u16(1), u16(0), fourcc("av01"), new Uint8Array(1));
  const iinf = fullBox("iinf", 0, 0, u16(1), infe);
  const ispe = fullBox("ispe", 0, 0, u32(width), u32(height));
  const ipco = box("ipco", ispe, av1CBox);
  const ipma = fullBox("ipma", 0, 0, u32(1), u16(1), Uint8Array.from([2, 0x81, 0x82]));
  const iprp = box("iprp", ipco, ipma);

  // iloc's byte length is fixed (offset_size/length_size are constant 4 bytes
  // regardless of the actual offset value), so it can be sized analytically
  // before its content (which needs the not-yet-known mdat offset) is built.
  //
  // iloc 的字节长度是固定的(offset_size/length_size 恒为 4 字节,与偏移值本身无关),
  // 所以可以在构造其内容(需要尚未知晓的 mdat 偏移)之前就先按此算出长度。
  const ilocBoxLen = 8 + 4 + (1 + 1 + 2 + (2 + 2 + 2 + 4 + 4));
  const metaBoxLen = 8 + 4 + hdlr.length + pitm.length + iinf.length + iprp.length + ilocBoxLen;
  const mdatDataOffset = ftyp.length + metaBoxLen + 8;

  const iloc = fullBox(
    "iloc",
    0,
    0,
    Uint8Array.from([0x44, 0x00]), // offset_size=4,length_size=4; base_offset_size=0,reserved=0
    u16(1), // item_count
    u16(1), // item_ID
    u16(0), // data_reference_index
    u16(1), // extent_count
    u32(mdatDataOffset), // extent_offset
    u32(sampleBytes.length), // extent_length
  );

  const meta = fullBox("meta", 0, 0, hdlr, pitm, iinf, iprp, iloc);
  const mdat = box("mdat", sampleBytes);

  return concatBytes([ftyp, meta, mdat]);
}
