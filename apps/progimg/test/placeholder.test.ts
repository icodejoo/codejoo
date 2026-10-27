import { describe, expect, it, vi } from "vitest";
import { normalizeHexColor } from "../src/shared/placeholder";
import { avgColor, lightDark, makeFirstFramePlaceholder, rgbHex, svgColorBlock } from "../src/sw/placeholder";

describe("svgColorBlock", () => {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
  ];
  it("solid 用平均色", () => {
    const svg = svgColorBlock({ width: 4, height: 3, palette, mode: "solid", fallbackColor: "#e0e0e0" });
    expect(svg).toContain(`fill="${rgbHex(avgColor(palette))}"`);
    expect(svg).toContain('width="4"');
    expect(svg).toContain('viewBox="0 0 4 3"');
  });
  it("gradient 有两个 stop,亮色在前", () => {
    const svg = svgColorBlock({ width: 4, height: 3, palette, mode: "gradient", fallbackColor: "#e0e0e0" });
    const [light, dark] = lightDark(palette);
    expect(svg).toContain(rgbHex(light));
    expect(svg).toContain(rgbHex(dark));
    expect(svg.indexOf(rgbHex(light))).toBeLessThan(svg.indexOf(rgbHex(dark)));
  });
  it("无 palette 回退 fallbackColor", () => {
    expect(svgColorBlock({ width: 1, height: 1, mode: "solid", fallbackColor: "#123456" })).toContain("#123456");
  });
});

describe("normalizeHexColor", () => {
  it("接受 #rgb / #rrggbb,无 # 与大小写均可,输出小写 #rrggbb", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("e0E0e0")).toBe("#e0e0e0");
    expect(normalizeHexColor(" #123456 ")).toBe("#123456");
  });
  it("非法输入返回 null", () => {
    for (const bad of ["", "red", "#12", "#12345", "#gggggg", "#1234567"]) expect(normalizeHexColor(bad)).toBeNull();
  });
  it("gradient 回退色非法时不产生 NaN", () => {
    const svg = svgColorBlock({ width: 1, height: 1, mode: "gradient", fallbackColor: "not-a-color" });
    expect(svg).not.toContain("NaN");
  });
});

describe("makeFirstFramePlaceholder", () => {
  const okDeps = () => {
    const ctx = { filter: "", drawImage: vi.fn() };
    const canvas = { getContext: () => ctx, convertToBlob: vi.fn().mockResolvedValue(new Blob(["png"])) };
    return { ctx, deps: { decode: vi.fn().mockResolvedValue({ width: 1024, height: 512 }), createCanvas: vi.fn().mockReturnValue(canvas) } };
  };
  it("sharp:长边 1024 缩到 512,不设 blur", async () => {
    const { ctx, deps } = okDeps();
    const blob = await makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "sharp", blurRadius: 12 }, deps);
    expect(blob).not.toBeNull();
    expect(deps.createCanvas).toHaveBeenCalledWith(512, 256);
    expect(ctx.filter).toBe("");
  });
  it("blur:设置 blur filter", async () => {
    const { ctx, deps } = okDeps();
    await makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "blur", blurRadius: 12 }, deps);
    expect(ctx.filter).toBe("blur(12px)");
  });
  it("decode 失败返回 null 不抛", async () => {
    const { deps } = okDeps();
    deps.decode = vi.fn().mockRejectedValue(new Error("bad"));
    await expect(makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "sharp", blurRadius: 12 }, deps)).resolves.toBeNull();
  });
  it("convertToBlob reject 时返回 null,且 bitmap 仍被关闭", async () => {
    const close = vi.fn();
    const ctx = { filter: "", drawImage: vi.fn() };
    const canvas = { getContext: () => ctx, convertToBlob: vi.fn().mockRejectedValue(new Error("boom")) };
    const deps = { decode: vi.fn().mockResolvedValue({ width: 10, height: 10, close }), createCanvas: vi.fn().mockReturnValue(canvas) };
    await expect(makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "sharp", blurRadius: 12 }, deps)).resolves.toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
  it("极端长宽比缩放后宽高至少 1px", async () => {
    const { deps } = okDeps();
    deps.decode = vi.fn().mockResolvedValue({ width: 4000, height: 1 });
    await makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "sharp", blurRadius: 12 }, deps);
    expect(deps.createCanvas).toHaveBeenCalledWith(512, 1);
  });
});
