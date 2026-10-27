import { describe, expect, it } from "vitest";
import { ByteAccumulator, asciiEquals, concatBytes, readBE32, readLE16, readLE24 } from "../src/shared/bytes";

describe("bytes", () => {
  it("concatBytes 拼接多段", () => {
    expect([...concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])]).toEqual([1, 2, 3]);
  });
  it("readLE16/LE24/BE32", () => {
    expect(readLE16(new Uint8Array([0x34, 0x12]), 0)).toBe(0x1234);
    expect(readLE24(new Uint8Array([0x56, 0x34, 0x12]), 0)).toBe(0x123456);
    expect(readBE32(new Uint8Array([0, 0, 0x01, 0x02]), 0)).toBe(0x102);
  });
  it("asciiEquals", () => {
    expect(asciiEquals(new Uint8Array([0x47, 0x49, 0x46]), 0, "GIF")).toBe(true);
    expect(asciiEquals(new Uint8Array([0x47]), 0, "GIF")).toBe(false); // 越界 false
  });
  it("ByteAccumulator 增量累积且 view 稳定", () => {
    const acc = new ByteAccumulator();
    acc.append(new Uint8Array([1, 2]));
    acc.append(new Uint8Array([3]));
    expect(acc.length).toBe(3);
    expect([...acc.view()]).toEqual([1, 2, 3]);
  });
});
