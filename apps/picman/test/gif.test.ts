import { describe, expect, it } from "vitest";
import { gifFirstFrame, scanGif } from "../src/shared/walkers/gif";
import { makeGif } from "./fixtures";

describe("scanGif", () => {
  it("循环动图 + 宽高 + 调色板", () => {
    const r = scanGif(makeGif({ frames: 2, loop: true, width: 3, height: 2 }));
    expect(r.status).toBe("animated");
    expect(r.width).toBe(3);
    expect(r.height).toBe(2);
    expect(r.palette).toHaveLength(4);
    expect(r.firstFrameEnd).toBeGreaterThan(13);
  });
  it("无 Netscape 两帧 → 动图;单帧 → 静图", () => {
    expect(scanGif(makeGif({ frames: 2, loop: false })).status).toBe("animated");
    expect(scanGif(makeGif({ frames: 1, loop: false })).status).toBe("static");
  });
  it("增量 1 字节喂:无异常,最终结论一致", () => {
    const g = makeGif({ frames: 2, loop: true });
    let last = scanGif(g.subarray(0, 1));
    for (let n = 2; n <= g.length; n++) last = scanGif(g.subarray(0, n));
    expect(last.status).toBe("animated");
    expect(last.firstFrameEnd).toBeDefined();
  });
  it("gifFirstFrame 产物尾 0x3B 且自身判静图", () => {
    const g = makeGif({ frames: 3, loop: true });
    const ff = gifFirstFrame(g, scanGif(g).firstFrameEnd!);
    expect(ff[ff.length - 1]).toBe(0x3b);
    expect(scanGif(ff).status).toBe("static");
  });
});
