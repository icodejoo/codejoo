// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFull } from "./helpers.ts";

/** 假方案：什么都不做 */
const noop = { sync: (): void => {}, release: (): void => {} };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = "";
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("engine 误配的开发警告", () => {
  it("只注册了 global 却传 engine: svg：警告一次，指明该引入哪个入口", async () => {
    const { enable, registerEngine } = await loadFull();
    registerEngine({ engine: "global", ...noop });
    const el = document.createElement("div");
    enable(el, { effect: "pulse", engine: "svg" });
    enable(el, { effect: "shimmer", engine: "svg" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('engine: "svg"');
    expect(String(warn.mock.calls[0]![0])).toContain("skeletonizer/svg");
  });

  it("只注册了 svg 却传 engine: global：警告", async () => {
    const { enable, registerEngine } = await loadFull();
    registerEngine({ engine: "svg", ...noop });
    const el = document.createElement("div");
    enable(el, { effect: "pulse", engine: "global" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("skeletonizer/global");
  });

  it("没显式传 engine、或传的方案已注册：不警告", async () => {
    const { enable, registerEngine } = await loadFull();
    registerEngine({ engine: "global", ...noop });
    enable(document.createElement("div"), { effect: "pulse" });
    enable(document.createElement("div"), { effect: "pulse", engine: "global" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("生产模式不警告", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { enable } = await loadFull();
    enable(document.createElement("div"), { effect: "pulse", engine: "svg" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("完整版扩展", () => {
  it("text 扩展：写 skz-text，没传就清掉，关闭后撤掉", async () => {
    const { enable } = await loadFull();
    const el = document.createElement("div");
    const off = enable(el, { text: "leaf" });
    expect(el.getAttribute("skz-text")).toBe("leaf");
    enable(el);
    expect(el.hasAttribute("skz-text")).toBe(false);
    enable(el, { text: "tofu" });
    off();
    expect(el.getAttributeNames()).toEqual([]);
  });
});
