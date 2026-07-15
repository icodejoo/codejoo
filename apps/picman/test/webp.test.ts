import { describe, expect, it } from "vitest";
import { scanWebp, webpFirstFrame } from "../src/shared/walkers/webp";
import { makeWebp } from "./fixtures";
import { asciiEquals } from "../src/shared/bytes";

describe("scanWebp / webpFirstFrame", () => {
  it("VP8X 动画位判定", () => {
    expect(scanWebp(makeWebp({ animated: true })).status).toBe("animated");
    expect(scanWebp(makeWebp({ animated: false })).status).toBe("static");
  });
  it("增量喂:最终拿到 anmf 区间", () => {
    const w = makeWebp({ animated: true });
    let last = scanWebp(w.subarray(0, 1));
    for (let n = 2; n <= w.length; n++) last = scanWebp(w.subarray(0, n));
    expect(last.anmf).toBeDefined();
  });
  it("重打包:RIFF size 正确、判静图;alpha 走 VP8X 路径", () => {
    for (const alpha of [false, true]) {
      const w = makeWebp({ animated: true, alpha });
      const ff = webpFirstFrame(w, scanWebp(w).anmf!)!;
      expect(asciiEquals(ff, 0, "RIFF")).toBe(true);
      const size = ff[4]! | (ff[5]! << 8) | (ff[6]! << 16) | (ff[7]! << 24);
      expect(size).toBe(ff.length - 8);
      expect(asciiEquals(ff, 12, "VP8X")).toBe(alpha);
      expect(scanWebp(ff).status).toBe("static");
    }
  });
  it("结构不符返回 null", () => {
    expect(webpFirstFrame(new Uint8Array(30), [0, 30])).toBeNull();
  });
});
