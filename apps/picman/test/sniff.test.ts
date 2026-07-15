import { describe, expect, it } from "vitest";
import { sniff } from "../src/shared/sniff";
import { makeApng, makeGif, makeWebp } from "./fixtures";

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
  it("不足 12 字节 → need-more", () => {
    expect(sniff(new Uint8Array([0x47])).status).toBe("need-more");
  });
});
