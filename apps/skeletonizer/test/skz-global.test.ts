// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 测试用的 globalThis 视图 */
const g = globalThis as unknown as { skz?: Record<string, unknown> };

/** 读当前的全局 skz（经函数读取，避免 TS 把 g.skz 按前面的 delete 窄化成 undefined） */
const currentSkz = (): Record<string, unknown> | undefined => g.skz;

beforeEach(() => {
  vi.resetModules();
  delete g.skz;
});

afterEach(() => {
  delete g.skz;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("全局 skz", () => {
  it("core 入口执行时挂上 enable / disable / bone", async () => {
    await import("../src/core/index.ts");
    const { Bone } = await import("../src/core/bone.ts");
    const { enable, disable } = await import("../src/core/enable.ts");
    expect(g.skz).toBeDefined();
    expect(g.skz!.enable).toBe(enable);
    expect(g.skz!.disable).toBe(disable);
    expect(g.skz!.bone).toBe(Bone);
    expect(typeof (g.skz!.bone as typeof Bone).text(3)).toBe("string");
    // 全局 skz 只有这三个成员（<skz-box> 已拆到 skeletonizer/element）
    expect(Object.keys(g.skz!).toSorted()).toEqual(["bone", "disable", "enable"]);
  });

  it("已存在不是我们的 skz：不覆盖，开发模式警告一次", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const theirs = { mine: true };
    g.skz = theirs;
    await import("../src/core/index.ts");
    expect(g.skz).toBe(theirs);
    expect(warn).toHaveBeenCalledTimes(1);
    // 再次挂载（如另一个入口也引了）不重复警告
    const { mountGlobal } = await import("../src/core/global.ts");
    expect(mountGlobal()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("生产模式下被占用也不警告", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    g.skz = { mine: true };
    await import("../src/core/index.ts");
    expect(warn).not.toHaveBeenCalled();
  });

  it("已存在我们自己挂的：直接刷新，不警告", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../src/core/index.ts");
    const first = g.skz;
    vi.resetModules();
    await import("../src/core/index.ts");
    expect(g.skz).toBeDefined();
    expect(g.skz).not.toBe(first);
    expect(warn).not.toHaveBeenCalled();
  });

  it("完整版与 core 共用同一个 skz 对象：先 core 后 full 不换对象，成员不变", async () => {
    await import("../src/core/index.ts");
    const coreOnly = currentSkz();
    await import("../src/full/index.ts");
    expect(currentSkz()).toBe(coreOnly);
    expect(Object.keys(currentSkz()!).toSorted()).toEqual(["bone", "disable", "enable"]);
  });

  it("默认导出就是挂到全局的那个 skz 对象", async () => {
    const mod = await import("../src/core/index.ts");
    expect(mod.default).toBe(g.skz);
    expect(typeof mod.default.bone.text(2)).toBe("string");
  });

  it("全局被别人占用时，默认导出照样可用", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    g.skz = { mine: true };
    const mod = await import("../src/core/index.ts");
    expect(g.skz).not.toBe(mod.default);
    expect(typeof mod.default.enable).toBe("function");
  });

  it("框架适配层不经过 core 入口，不会挂全局", async () => {
    await import("../src/svelte.ts");
    expect(g.skz).toBeUndefined();
  });
});
