import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asEl, FakeEl, fresh, stubSvgEnv } from "./helpers.ts";
import type { SvgEnv } from "./helpers.ts";

/** svg 环境桩的状态（生成的 blob / 释放的 URL） */
let env: SvgEnv;

/**
 * 重新加载一份干净的核心，并导入 global 变体（导入即注册）
 * @returns 新模块里的 enable 和 global 变体模块
 */
async function load(): Promise<{ enable: typeof import("../src/core/enable.ts").enable; globalMod: typeof import("../src/full/variants/global.ts") }> {
  const enable = await fresh(["global"]);
  return { enable, globalMod: await import("../src/full/variants/global.ts") };
}

beforeEach(() => {
  env = stubSvgEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("supportsRootDriven", () => {
  it("没有 CSS（SSR）或没有 CSS.supports：视为不支持，导入模块本身不访问 CSS", async () => {
    vi.stubGlobal("CSS", undefined);
    const { globalMod } = await load();
    globalMod.resetRootDrivenCache();
    expect(globalMod.supportsRootDriven()).toBe(false);
    vi.stubGlobal("CSS", {});
    globalMod.resetRootDrivenCache();
    expect(globalMod.supportsRootDriven()).toBe(false);
  });

  it("按相对颜色语法判断，结果惰性缓存只算一次", async () => {
    const supports = vi.fn(() => true);
    vi.stubGlobal("CSS", { supports });
    const { globalMod } = await load();
    globalMod.resetRootDrivenCache();
    expect(globalMod.supportsRootDriven()).toBe(true);
    expect(globalMod.supportsRootDriven()).toBe(true);
    expect(supports).toHaveBeenCalledTimes(1);
    expect(supports).toHaveBeenCalledWith("color", "rgb(from red r g b)");
    // 缓存住了：换 mock 也不重算，重置后才重算
    vi.stubGlobal("CSS", { supports: () => false });
    expect(globalMod.supportsRootDriven()).toBe(true);
    globalMod.resetRootDrivenCache();
    expect(globalMod.supportsRootDriven()).toBe(false);
  });
});

describe("global 变体：老浏览器降级到 SVG", () => {
  beforeEach(() => {
    vi.stubGlobal("CSS", { supports: () => false });
  });

  it("只加载 global：pulse 会挂上 blob SVG 并写 skz-engine，关闭时全部撤掉", async () => {
    const { enable } = await load();
    const f = new FakeEl();
    const off = enable(asEl(f), { effect: "pulse" });
    expect(f.getAttribute("skz-engine")).toBe("svg");
    expect(f.props.get("--skz-svg-pulse")).toBe('url("blob:2")');
    off();
    expect(f.getAttribute("skz-engine")).toBeNull();
    expect(f.props.size).toBe(0);
    expect(env.revoked).toEqual(["blob:1", "blob:2"]);
  });

  it('fallback: "fade" 不挂 SVG，保持基底的 fade', async () => {
    const { enable } = await load();
    const f = new FakeEl();
    enable(asEl(f), { effect: "shimmer", fallback: "fade" });
    expect(f.getAttribute("skz-engine")).toBeNull();
    expect(env.made).toHaveLength(0);
  });

  it("改 fallback 或换成 fade 效果后，已挂的 SVG 会被撤掉", async () => {
    const { enable } = await load();
    const f = new FakeEl();
    enable(asEl(f), { effect: "pulse" });
    expect(f.getAttribute("skz-engine")).toBe("svg");
    enable(asEl(f), { effect: "pulse", fallback: "fade" });
    expect(f.getAttribute("skz-engine")).toBeNull();
    enable(asEl(f), { effect: "pulse" });
    expect(f.getAttribute("skz-engine")).toBe("svg");
    enable(asEl(f), { effect: "fade" });
    expect(f.getAttribute("skz-engine")).toBeNull();
  });

  it("blob 生成失败（读不到主题变量）：不写 engine，退回 fade", async () => {
    const { enable } = await load();
    const f = new FakeEl();
    f.vars = {};
    enable(asEl(f), { effect: "pulse" });
    expect(f.getAttribute("skz-engine")).toBeNull();
  });

  it("global 和 svg 同时注册（模拟 all）：global 挂的 SVG 不会被 svg 扩展的 release 撤掉", async () => {
    const { enable } = await load();
    await import("../src/full/variants/svg.ts");
    const f = new FakeEl();
    enable(asEl(f), { effect: "shimmer" });
    expect(f.getAttribute("skz-engine")).toBe("svg");
    expect(f.props.has("--skz-svg-shimmer")).toBe(true);
    // 重入也一样
    enable(asEl(f), { effect: "pulse" });
    expect(f.getAttribute("skz-engine")).toBe("svg");
    expect(f.props.has("--skz-svg-pulse")).toBe(true);
  });

  it("all 里显式 engine: svg：同样挂上并保留", async () => {
    const { enable } = await load();
    await import("../src/full/variants/svg.ts");
    const f = new FakeEl();
    enable(asEl(f), { effect: "shimmer", engine: "svg" });
    expect(f.getAttribute("skz-engine")).toBe("svg");
  });
});

describe("global 变体：支持根驱动的浏览器", () => {
  it("不挂 SVG、不写 engine；从老路径切回来时撤掉已挂的 SVG", async () => {
    vi.stubGlobal("CSS", { supports: () => true });
    const { enable, globalMod } = await load();
    globalMod.resetRootDrivenCache();
    const f = new FakeEl();
    enable(asEl(f), { effect: "pulse" });
    expect(f.getAttribute("skz-engine")).toBeNull();
    expect(env.made).toHaveLength(0);
    // 假装之前在老路径上挂过
    const { applySvg } = await import("../src/full/svg.ts");
    expect(applySvg(asEl(f))).toBe(true);
    enable(asEl(f), { effect: "pulse" });
    expect(f.getAttribute("skz-engine")).toBeNull();
    expect(f.props.size).toBe(0);
  });
});
