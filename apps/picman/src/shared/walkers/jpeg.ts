/**
 * Minimal JPEG marker walker: dimensions from the first SOF segment, plus the
 * structural "displayable" signal for the static-progressive thumbnail stage —
 * the moment the byte stream has entered entropy-coded scan data (past SOS).
 * For progressive JPEGs it additionally detects the end of the first scan,
 * which is the earliest point a full-coverage (blurry) image can decode.
 *
 * 最小 JPEG marker 遍历器:从第一个 SOF 段取尺寸,并为静态渐进缩略图阶段提供结构性
 * "可显示"信号——字节流越过 SOS、进入熵编码扫描数据的时刻。对渐进式 JPEG 额外检测
 * 第一个 scan 的结束位置,那是全图覆盖(模糊)图像最早可解码的点。
 */

import { readBE16 } from "../bytes";

/**
 * Result of scanning a (possibly partial) JPEG byte buffer.
 *
 * 扫描(可能不完整的)JPEG 字节缓冲的结果。
 */
export interface JpegScan {
  /** need-more: SOF not reached yet; static: SOF parsed (JPEG is always static) — SOF 未到/已解析(JPEG 恒为静图) */
  status: "need-more" | "static";
  /** Frame width from SOF — SOF 中的帧宽 */
  width?: number;
  /** Frame height from SOF — SOF 中的帧高 */
  height?: number;
  /** Whether this is a progressive JPEG (SOF2) — 是否渐进式 JPEG(SOF2) */
  progressive?: boolean;
  /** Byte offset where the first SOS's entropy-coded data begins — 首个 SOS 的熵编码数据起始偏移 */
  scanDataStart?: number;
  /** End offset of the first scan (next marker after its data) — progressive only, the earliest full-coverage decode point — 第一个 scan 的结束偏移(其数据后的下一个 marker)——仅渐进式,全图覆盖最早可解码点 */
  firstScanEnd?: number;
}

/** Standalone markers with no length payload (RSTn, TEM, SOI, EOI) — 无长度负载的独立 marker */
function isStandaloneMarker(byte: number): boolean {
  return (byte >= 0xd0 && byte <= 0xd9) || byte === 0x01;
}

/** SOF0-SOF15 excluding DHT(C4)/JPG(C8)/DAC(CC), which share the C0-CF range — SOF0-15,排除同段范围内的 DHT/JPG/DAC */
function isSofMarker(byte: number): boolean {
  return byte >= 0xc0 && byte <= 0xcf && byte !== 0xc4 && byte !== 0xc8 && byte !== 0xcc;
}

/**
 * Scan forward through entropy-coded data for the next real marker (0xFF
 * followed by anything but 0x00 stuffing or RSTn), i.e. the end of a scan.
 *
 * 在熵编码数据中前扫,找下一个真实 marker(0xFF 后非 0x00 填充、非 RSTn),即一个 scan 的结束。
 * @param buf - Source bytes — 源字节
 * @param start - Offset where entropy data begins — 熵数据起始偏移
 * @returns Marker offset, or -1 when the buffer ends inside the scan — marker 偏移,缓冲在 scan 内结束则 -1
 */
function findScanEnd(buf: Uint8Array, start: number): number {
  for (let p = start; p + 1 < buf.length; p++) {
    if (buf[p] !== 0xff) continue;
    const next = buf[p + 1]!;
    if (next === 0x00) continue; // byte stuffing — 字节填充
    if (next >= 0xd0 && next <= 0xd7) continue; // RSTn stays inside the scan — RSTn 属于 scan 内部
    return p;
  }
  return -1;
}

/**
 * Incrementally scan a JPEG byte buffer for dimensions and the structural
 * displayability signals.
 *
 * 增量扫描 JPEG 字节缓冲,取尺寸与结构性可显示信号。
 * @param buf - Bytes seen so far (may be partial) — 目前已收到的字节(可能不完整)
 * @returns Scan result — 扫描结果
 */
export function scanJpeg(buf: Uint8Array): JpegScan {
  if (buf.length < 4) return { status: "need-more" };
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return { status: "static" }; // not JPEG — treated as unrecognized-static by the caller — 非 JPEG,调用方按未识别静图处理

  let width: number | undefined;
  let height: number | undefined;
  let progressive: boolean | undefined;

  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return { status: "static", width, height, progressive }; // marker desync — bail with whatever was parsed — marker 失步,带已解析信息退出
    const marker = buf[p + 1]!;

    if (isStandaloneMarker(marker)) {
      p += 2;
      continue;
    }

    const segLen = readBE16(buf, p + 2);
    if (segLen < 2) return { status: "static", width, height, progressive };

    if (isSofMarker(marker)) {
      // SOF payload: precision(1) + height(2) + width(2) — SOF 负载:精度(1)+高(2)+宽(2)
      if (p + 4 + 5 > buf.length) return { status: "need-more", width, height, progressive };
      height = readBE16(buf, p + 5);
      width = readBE16(buf, p + 7);
      progressive = marker === 0xc2;
    }

    if (marker === 0xda) {
      const scanDataStart = p + 2 + segLen;
      const scanEnd = findScanEnd(buf, scanDataStart);
      return {
        status: "static",
        width,
        height,
        progressive,
        scanDataStart,
        firstScanEnd: progressive && scanEnd !== -1 ? scanEnd : undefined,
      };
    }

    p += 2 + segLen;
  }
  return { status: "need-more", width, height, progressive };
}
