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
  it("截断在第 2 帧中间:已判 animated,firstFrameEnd 为首帧边界", () => {
    const g = makeGif({ frames: 3, loop: true });
    const full = scanGif(g);
    const end = full.firstFrameEnd!;
    // 第 2 帧先是 8 字节的图形控制扩展,其后才是图像描述符(0x2c);只多出标记及其后若干字节
    for (const extra of [9, 15]) {
      const r = scanGif(g.subarray(0, end + extra));
      expect(r.status).toBe("animated");
      expect(r.firstFrameEnd).toBe(end);
    }
    // 还没看到第 2 个图像描述符时仍待定
    expect(scanGif(g.subarray(0, end + 8)).status).toBe("need-more");
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
