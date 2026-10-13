// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKZ_API_KEY } from "../src/core/api-key.ts";

/** 测试用的 globalThis 视图：私有键与公开 skz */
const g = globalThis as unknown as Record<symbol | string, unknown>;

beforeEach(() => {
  vi.resetModules();
  delete g[SKZ_API_KEY];
  delete g.skz;
});

afterEach(() => {
  delete g[SKZ_API_KEY];
  delete g.skz;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("私有全局键", () => {
  it("键是 Symbol.for('skeletonizer')，多份拷贝共用", () => {
    expect(SKZ_API_KEY).toBe(Symbol.for("skeletonizer"));
  });

  it("core 入口执行后私有键指向公开的 skz 对象（含 enable / disable）", async () => {
    await import("../src/core/index.ts");
    const api = g[SKZ_API_KEY] as { enable: unknown; disable: unknown };
    expect(api).toBe(g.skz);
    expect(typeof api.enable).toBe("function");
    expect(typeof api.disable).toBe("function");
  });

  it("公开的 skz 被别人占用时：公开变量不覆盖，私有键照挂", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const theirs = { mine: true };
    g.skz = theirs;
    await import("../src/core/index.ts");
    expect(g.skz).toBe(theirs);
    expect(typeof (g[SKZ_API_KEY] as { enable: unknown }).enable).toBe("function");
  });

  it("完整版入口执行后私有键指向公开的 skz 对象", async () => {
    await import("../src/full/index.ts");
    const api = g[SKZ_API_KEY] as { enable: unknown };
    expect(api).toBe(g.skz);
    expect(typeof api.enable).toBe("function");
  });
});

describe("适配层经私有键调用实现", () => {
  it("有实现：enable / disable / toggle 都转发过去，enable 的返回值是关闭函数", async () => {
    const off = vi.fn();
    const impl = { enable: vi.fn(() => off), disable: vi.fn() };
    g[SKZ_API_KEY] = impl;
    const { enable, disable, toggle } = await import("../src/adapter-api.ts");
    const el = document.createElement("div");
    expect(enable(el, { effect: "pulse" })).toBe(off);
    expect(impl.enable).toHaveBeenCalledWith(el, { effect: "pulse" });
    disable(el);
    expect(impl.disable).toHaveBeenCalledWith(el);
    toggle(el, true, { fit: true });
    expect(impl.enable).toHaveBeenLastCalledWith(el, { fit: true });
    toggle(el, false);
    expect(impl.disable).toHaveBeenCalledTimes(2);
  });

  it("没有实现：开发模式只警告一次、不抛错，enable 返回空函数", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { enable, disable, toggle } = await import("../src/adapter-api.ts");
    const el = document.createElement("div");
    expect(typeof enable(el)).toBe("function");
    disable(el);
    toggle(el, true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("skeletonizer/lite");
  });

  it("没有实现：生产模式静默", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { toggle } = await import("../src/adapter-api.ts");
    toggle(document.createElement("div"), true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("svelte action 经私有键开关骨架", async () => {
    await import("../src/core/index.ts");
    const { skeleton } = await import("../src/svelte.ts");
    const el = document.createElement("div");
    el.innerHTML = "<p>hi</p>";
    document.body.appendChild(el);
    const action = skeleton(el, { loading: true });
    expect(el.hasAttribute("skz")).toBe(true);
    action.update({ loading: false });
    expect(el.hasAttribute("skz")).toBe(false);
    action.destroy();
    el.remove();
  });
});
