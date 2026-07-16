import { describe, expect, it } from "vitest";
import { avifFirstFrame, scanAvif } from "../src/shared/walkers/avif";
import { makeAvif } from "./fixtures";
import { asciiEquals, readBE32 } from "../src/shared/bytes";

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
  });

  it("非 AVIF/HEIF 系族的 ftyp brand 判 static", () => {
    // major_brand 既非 avif 也非 avis(如 mp4 的 'isom')— 判 static
    const notAvif = makeAvif({ animated: false });
    notAvif.set(Uint8Array.from("isom".split("").map((c) => c.charCodeAt(0))), 8);
    expect(scanAvif(notAvif).status).toBe("static");
  });
});
