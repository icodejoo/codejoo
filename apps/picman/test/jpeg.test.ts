import { describe, expect, it } from "vitest";
import { scanJpeg } from "../src/shared/walkers/jpeg";
import { sniff } from "../src/shared/sniff";
import { makeBigPng, makeJpeg } from "./fixtures";

describe("scanJpeg", () => {
  it("SOF 尺寸解析:baseline 与 progressive", () => {
    const b = scanJpeg(makeJpeg({ width: 640, height: 480 }));
    expect(b.status).toBe("static");
    expect(b.width).toBe(640);
    expect(b.height).toBe(480);
    expect(b.progressive).toBe(false);

    const p = scanJpeg(makeJpeg({ progressive: true, width: 320, height: 240 }));
    expect(p.progressive).toBe(true);
  });

  it("SOS 之前字节不足:need-more", () => {
    const j = makeJpeg({});
    expect(scanJpeg(j.subarray(0, 6)).status).toBe("need-more");
  });

  it("scanDataStart 指向 SOS 段后的熵数据起点", () => {
    const j = makeJpeg({ scanBytes: 100 });
    const r = scanJpeg(j);
    expect(r.scanDataStart).toBeDefined();
    // SOI(2)+SOF(2+11)+SOS(2+8) = 25
    expect(r.scanDataStart).toBe(25);
  });

  it("progressive:第二个 SOS 出现前 firstScanEnd 未定义,出现后有值", () => {
    const withoutEnd = scanJpeg(makeJpeg({ progressive: true, scanBytes: 200 }).subarray(0, 100));
    expect(withoutEnd.firstScanEnd).toBeUndefined();

    const withEnd = scanJpeg(makeJpeg({ progressive: true, scanBytes: 200, endFirstScan: true }));
    expect(withEnd.firstScanEnd).toBeDefined();
  });

  it("非 JPEG 魔数判 static(由 sniff 兜底为未识别)", () => {
    expect(scanJpeg(Uint8Array.from([0x00, 0x11, 0x22, 0x33])).status).toBe("static");
  });
});

describe("sniff 的静态可显示信号(staticDisplayable)", () => {
  it("baseline JPEG:熵数据不足 4096 时 false,够了 true——门槛随图动态", () => {
    const small = sniff(makeJpeg({ scanBytes: 1000 }));
    expect(small.format).toBe("jpeg");
    expect(small.staticDisplayable).toBe(false);

    const big = sniff(makeJpeg({ scanBytes: 8192 }));
    expect(big.staticDisplayable).toBe(true);
  });

  it("progressive JPEG:首 scan 收完即可显示,与字节数无关", () => {
    const j = makeJpeg({ progressive: true, scanBytes: 500, endFirstScan: true });
    const r = sniff(j);
    expect(r.staticDisplayable).toBe(true);

    // 同样 500 字节但首 scan 未结束:不可显示
    const cut = sniff(makeJpeg({ progressive: true, scanBytes: 500 }).subarray(0, 400));
    expect(cut.staticDisplayable).toBeFalsy();
  });

  it("静态 PNG:IDAT 累计字节跨过门槛才可显示,含未收全的尾部 chunk", () => {
    const png = makeBigPng({ idatBytes: 20000, chunkSize: 4096 });
    // 只收到首个 IDAT 一半:IHDR(8+25)+首 chunk 头(8)+2048 数据
    const partial = sniff(png.subarray(0, 33 + 8 + 2048));
    expect(partial.format).toBe("apng");
    expect(partial.staticDisplayable).toBe(false);

    const enough = sniff(png.subarray(0, 33 + (8 + 4096 + 4) + 8 + 4096));
    expect(enough.staticDisplayable).toBe(true);
  });
});
