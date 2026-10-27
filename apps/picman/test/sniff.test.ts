import { describe, expect, it } from "vitest";
import { adam7Pass1Bytes, sniff } from "../src/shared/sniff";
import { makeApng, makeBigPng, makeGif, makeWebp } from "./fixtures";

describe("sniff", () => {
  it("三格式动图识别 + mime", () => {
    expect(sniff(makeGif({ frames: 2, loop: true }))).toMatchObject({ status: "animated", format: "gif", mime: "image/gif" });
    expect(sniff(makeApng({ animated: true }))).toMatchObject({ status: "animated", format: "apng", mime: "image/png" });
    expect(sniff(makeWebp({ animated: true }))).toMatchObject({ status: "animated", format: "webp", mime: "image/webp" });
  });
  it("静图/未知容器(JPEG 魔数)→ static", () => {
    expect(sniff(makeGif({ frames: 1 })).status).toBe("static");
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])).status).toBe("static");
  });
  it("adam7Pass1Bytes:小图远低于 4096,大图随尺寸增长,各颜色类型/位深按通道算", () => {
    expect(adam7Pass1Bytes(100, 100, 8, 2)).toBeLessThan(4096);
    // 4000x3000 RGB8:pw=500, ph=375, 行=1+1500 → raw=562875,余量 563+16
    expect(adam7Pass1Bytes(4000, 3000, 8, 2)).toBe(562875 + 563 + 16);
    // 灰度 1 位:pw=ceil(80/8)=10 → 行=1+ceil(10/8)=3, ph=10 → raw=30
    expect(adam7Pass1Bytes(80, 80, 1, 0)).toBe(30 + 1 + 16);
    // RGBA16 通道数 4、位深 16
    expect(adam7Pass1Bytes(8, 8, 16, 6)).toBe(9 + 1 + 16); // pw=ph=1,行=1+8
    expect(adam7Pass1Bytes(undefined, 10, 8, 2)).toBe(0);
    expect(adam7Pass1Bytes(10, 10, 8, 9)).toBe(0);
  });
  it("大尺寸隔行 PNG:IDAT 门槛随尺寸增长,小图仍是 4096", () => {
    // 2000x2000 RGB8 第 1 遍约 188KB:20KB 不够,200KB 够
    const lo = makeBigPng({ idatBytes: 20000, interlaced: true, width: 2000, height: 2000 });
    const hi = makeBigPng({ idatBytes: 200000, interlaced: true, width: 2000, height: 2000 });
    expect(sniff(lo).staticDisplayable).toBe(false);
    expect(sniff(hi).staticDisplayable).toBe(true);
    // 100x100 小图门槛仍为 4096
    expect(sniff(makeBigPng({ idatBytes: 4096, interlaced: true })).staticDisplayable).toBe(true);
    expect(sniff(makeBigPng({ idatBytes: 3000, interlaced: true })).staticDisplayable).toBe(false);
  });
  it("不足 12 字节 → need-more", () => {
    expect(sniff(new Uint8Array([0x47])).status).toBe("need-more");
  });
});
