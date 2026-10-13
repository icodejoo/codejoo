// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKZ_API_KEY } from "../src/core/api-key.ts";

/** 测试用的 globalThis 视图：私有键与公开 skz */
const g = globalThis as unknown as Record<symbol | string, unknown>;

/** 自定义元素标签名 */
const TAG = "skz-box";

beforeEach(() => {
  vi.resetModules();
  delete g[SKZ_API_KEY];
  delete g.skz;
});

afterEach(() => {
  delete g[SKZ_API_KEY];
  delete g.skz;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("skeletonizer/element 入口", () => {
  it("导入没有副作用：不注册 <skz-box>，也不挂全局 skz / 私有键；调用 defineSkzBox 才注册，重复调用安全", async () => {
    const mod = await import("../src/element.ts");
    expect(Object.keys(mod).toSorted()).toEqual(["SkzBox", "defineSkzBox"]);
    expect(customElements.get(TAG)).toBeUndefined();
    expect(g.skz).toBeUndefined();
    expect(g[SKZ_API_KEY]).toBeUndefined();
    mod.defineSkzBox();
    mod.defineSkzBox();
    expect(customElements.get(TAG)).toBe(mod.SkzBox);
  });

  it("没导入 lite / 完整版：开发模式提示一次（指向实现入口），不抛错，子根不变", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { defineSkzBox } = await import("../src/element.ts");
    defineSkzBox("skz-box-dev");
    const el = document.createElement("skz-box-dev");
    el.setAttribute("loading", "");
    el.appendChild(document.createElement("div"));
    document.body.appendChild(el);
    (el as unknown as { loading: boolean }).loading = false;
    (el as unknown as { loading: boolean }).loading = true;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("skeletonizer/lite");
    expect(el.firstElementChild!.hasAttribute("skz")).toBe(false);
  });

  it("生产模式没有实现时静默", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { defineSkzBox } = await import("../src/element.ts");
    defineSkzBox("skz-box-prod");
    const el = document.createElement("skz-box-prod");
    el.setAttribute("loading", "");
    el.appendChild(document.createElement("div"));
    document.body.appendChild(el);
    expect(warn).not.toHaveBeenCalled();
  });

  it("导入 core 后经私有键开关子根；用不同的标签名也能注册", async () => {
    await import("../src/core/index.ts");
    const { defineSkzBox } = await import("../src/element.ts");
    defineSkzBox("my-box");
    const el = document.createElement("my-box");
    const child = document.createElement("div");
    el.appendChild(child);
    document.body.appendChild(el);
    el.setAttribute("loading", "");
    expect(child.hasAttribute("skz")).toBe(true);
    el.removeAttribute("loading");
    expect(child.hasAttribute("skz")).toBe(false);
  });
});
