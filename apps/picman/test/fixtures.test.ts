import { describe, expect, it } from "vitest";
import { crc32, makeApng, makeGif, makeWebp } from "./fixtures";
import { asciiEquals, readBE32 } from "../src/shared/bytes";

describe("fixtures", () => {
  it("crc32 已知值:CRC32('IEND') = 0xAE426082", () => {
    expect(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44]))).toBe(0xae426082);
  });
  it("makeGif 签名/尾字节", () => {
    const g = makeGif({ frames: 2, loop: true });
    expect(asciiEquals(g, 0, "GIF89a")).toBe(true);
    expect(g[g.length - 1]).toBe(0x3b);
  });
  it("makeApng 动画含 acTL,静态不含,IEND 存在", () => {
    const has = (b: Uint8Array, t: string) => {
      for (let i = 8; i + 8 <= b.length; ) {
        const len = readBE32(b, i);
        if (asciiEquals(b, i + 4, t)) return true;
        i += 12 + len;
      }
      return false;
    };
    expect(has(makeApng({ animated: true }), "acTL")).toBe(true);
    expect(has(makeApng({ animated: false }), "acTL")).toBe(false);
    expect(has(makeApng({ animated: true }), "IEND")).toBe(true);
  });
  it("makeWebp RIFF size 与总长一致", () => {
    for (const w of [makeWebp({ animated: true }), makeWebp({ animated: false }), makeWebp({ animated: true, alpha: true })]) {
      expect(asciiEquals(w, 0, "RIFF")).toBe(true);
      expect(asciiEquals(w, 8, "WEBP")).toBe(true);
      const size = w[4]! | (w[5]! << 8) | (w[6]! << 16) | (w[7]! << 24);
      expect(size).toBe(w.length - 8);
    }
  });
});
