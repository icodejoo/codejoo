import { describe, expect, it } from "vitest";
import { apngFirstFrame, scanPng } from "../src/shared/walkers/apng";
import { makeApng, makeBigPng } from "./fixtures";
import { asciiEquals, readBE32 } from "../src/shared/bytes";

const chunkTypes = (b: Uint8Array): string[] => {
  const out: string[] = [];
  for (let i = 8; i + 8 <= b.length; ) {
    const len = readBE32(b, i);
    out.push(String.fromCharCode(...b.subarray(i + 4, i + 8)));
    i += 12 + len;
  }
  return out;
};

describe("scanPng / apngFirstFrame", () => {
  it("acTL → animated;无 → static", () => {
    expect(scanPng(makeApng({ animated: true })).status).toBe("animated");
    expect(scanPng(makeApng({ animated: false })).status).toBe("static");
  });
  it("只收到首个 IDAT 块头(单个巨大 IDAT)即可定 status", () => {
    const png = makeBigPng({ idatBytes: 100000, chunkSize: 100000, interlaced: true });
    const r = scanPng(png.subarray(0, 8 + 25 + 8 + 100));
    expect(r.status).toBe("static");
    expect(r.interlaced).toBe(true);
    expect(r.idatBytes).toBeGreaterThan(0);
  });
  it("增量喂:最终 animated 且 firstFrameReady", () => {
    const a = makeApng({ animated: true });
    let last = scanPng(a.subarray(0, 1));
    for (let n = 2; n <= a.length; n++) last = scanPng(a.subarray(0, n));
    expect(last.status).toBe("animated");
    expect(last.firstFrameReady).toBe(true);
  });
  it("重组产物无动画 chunk、IEND 收尾、判静图", () => {
    const ff = apngFirstFrame(makeApng({ animated: true }));
    expect(ff[0]).toBe(0x89);
    expect(asciiEquals(ff, 1, "PNG")).toBe(true);
    const types = chunkTypes(ff);
    expect(types).not.toContain("acTL");
    expect(types).not.toContain("fcTL");
    expect(types).not.toContain("fdAT");
    expect(types[types.length - 1]).toBe("IEND");
    expect(types).toContain("IDAT");
    expect(scanPng(ff).status).toBe("static");
  });
});
