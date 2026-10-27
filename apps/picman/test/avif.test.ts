import { describe, expect, it } from "vitest";
import { avifFirstFrame, scanAvif } from "../src/shared/walkers/avif";
import { makeAvif } from "./fixtures";
import { asciiEquals, readBE32 } from "../src/shared/bytes";

/**
 * 按路径在 ISOBMFF box 树里定位 box(meta 是 FullBox,孩子起点多 4 字节)。
 * @param buf - 字节
 * @param start - 搜索区间起点
 * @param end - 搜索区间终点
 * @param path - 从外到内的 fourcc 路径
 * @returns box 的 [起点, 终点),找不到为 null
 */
function findBox(buf: Uint8Array, start: number, end: number, path: string[]): [number, number] | null {
  let p = start;
  while (p + 8 <= end) {
    const size = readBE32(buf, p);
    if (size < 8) return null;
    if (asciiEquals(buf, p + 4, path[0]!)) {
      if (path.length === 1) return [p, p + size];
      return findBox(buf, p + 8 + (path[0] === "meta" ? 4 : 0), p + size, path.slice(1));
    }
    p += size;
  }
  return null;
}

/** 把 ftyp 的 major 与所有 compatible brands 改写成给定品牌(循环使用) */
function rewriteBrands(buf: Uint8Array, brands: string[]): void {
  const ftypSize = readBE32(buf, 0);
  // major(8) + minor(12,保留)+ compatible(16..)
  const slots = [8];
  for (let i = 16; i + 4 <= ftypSize; i += 4) slots.push(i);
  slots.forEach((off, i) => buf.set(Uint8Array.from(brands[i % brands.length]!.split("").map((c) => c.charCodeAt(0))), off));
}

describe("scanAvif / avifFirstFrame", () => {
  it("ftyp brand 判定:avis→animated,avif→static", () => {
    expect(scanAvif(makeAvif({ animated: true })).status).toBe("animated");
    expect(scanAvif(makeAvif({ animated: false })).status).toBe("static");
  });

  it("animated 时解出 width/height/firstSample/av1C", () => {
    const r = scanAvif(makeAvif({ animated: true, width: 8, height: 6 }));
    expect(r.status).toBe("animated");
    expect(r.width).toBe(8);
    expect(r.height).toBe(6);
    expect(r.firstSample).toBeDefined();
    expect(r.av1C).toBeDefined();
  });

  it("增量喂:最终拿到 firstSample 区间,且区间落在总长度内", () => {
    const a = makeAvif({ animated: true });
    let last = scanAvif(a.subarray(0, 1));
    for (let n = 2; n <= a.length; n++) last = scanAvif(a.subarray(0, n));
    expect(last.firstSample).toBeDefined();
    expect(last.firstSample!.offset + last.firstSample!.size).toBeLessThanOrEqual(a.length);
  });

  it("firstSample 指向的字节与原始 sampleBytes 一致", () => {
    const sampleBytes = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55]);
    const a = makeAvif({ animated: true, sampleBytes });
    const r = scanAvif(a);
    const { offset, size } = r.firstSample!;
    expect(a.subarray(offset, offset + size)).toEqual(sampleBytes);
  });

  it("字节不足只判定 need-more,不误判", () => {
    const a = makeAvif({ animated: true });
    expect(scanAvif(a.subarray(0, 8)).status).toBe("need-more");
    expect(scanAvif(a.subarray(0, 15)).status).toBe("need-more");
  });

  it("重打包:产出合法 ftyp+meta+mdat 静态 AVIF,尺寸与原样本一致,自身被判为 static", () => {
    const sampleBytes = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
    const a = makeAvif({ animated: true, sampleBytes, width: 12, height: 9 });
    const r = scanAvif(a);
    const ff = avifFirstFrame(sampleBytes, r.av1C!, 12, 9);

    expect(asciiEquals(ff, 4, "ftyp")).toBe(true);
    expect(scanAvif(ff).status).toBe("static"); // no moov in the recomposed still image — 重打包结果不含 moov

    // mdat 位于 ftyp+meta 之后,其内容应与原样本字节完全一致
    let p = 0;
    const ftypSize = readBE32(ff, 0);
    p += ftypSize;
    const metaSize = readBE32(ff, p);
    p += metaSize;
    expect(asciiEquals(ff, p + 4, "mdat")).toBe(true);
    const mdatPayload = ff.subarray(p + 8, ff.length);
    expect(mdatPayload).toEqual(sampleBytes);

    // ispe 宽高 = 12x9(FullBox:payload 起于 +12)
    const ispe = findBox(ff, 0, ff.length, ["meta", "iprp", "ipco", "ispe"])!;
    expect(ispe).not.toBeNull();
    expect(readBE32(ff, ispe[0] + 12)).toBe(12);
    expect(readBE32(ff, ispe[0] + 16)).toBe(9);

    // iloc 的 extent offset/length 指向 mdat 负载,与 sampleBytes 一致
    const iloc = findBox(ff, 0, ff.length, ["meta", "iloc"])!;
    expect(iloc).not.toBeNull();
    const extentOffset = readBE32(ff, iloc[0] + 22);
    const extentLength = readBE32(ff, iloc[0] + 26);
    expect(extentOffset).toBe(p + 8);
    expect(extentLength).toBe(sampleBytes.length);
    expect(ff.subarray(extentOffset, extentOffset + extentLength)).toEqual(sampleBytes);
  });

  it("非 AVIF/HEIF 系族的 ftyp brand 判 static", () => {
    // 用 animated fixture(默认会判 animated),把 major 与全部 compatible brands 换成非 avif 系,才有区分度
    const notAvif = makeAvif({ animated: true });
    rewriteBrands(notAvif, ["isom", "mp41"]);
    expect(scanAvif(notAvif).status).toBe("static");
  });

  it("major 为 isom、仅 compatible 含 avis → animated", () => {
    const a = makeAvif({ animated: true });
    rewriteBrands(a, ["isom", "mp41", "mp41", "avis", "mp41", "mp41"]);
    expect(scanAvif(a).status).toBe("animated");
  });
});
