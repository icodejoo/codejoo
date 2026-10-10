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
  it("core 入口执行时挂上 enable / disable / bone / defineSkzBox", async () => {
    await import("../src/core/index.ts");
    const { Bone } = await import("../src/core/bone.ts");
    const { enable, disable } = await import("../src/core/enable.ts");
    const { defineSkzBox } = await import("../src/core/element.ts");
    expect(g.skz).toBeDefined();
    expect(g.skz!.enable).toBe(enable);
    expect(g.skz!.disable).toBe(disable);
    expect(g.skz!.bone).toBe(Bone);
    expect(g.skz!.defineSkzBox).toBe(defineSkzBox);
    expect(typeof (g.skz!.bone as typeof Bone).text(3)).toBe("string");
    // 只有 core：没有完整版的 API
    expect(g.skz!.registerCustomElements).toBeUndefined();
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

  it("完整版往同一个 skz 上补 registerCustomElements：单独导入、或先 core 后 full 都是同一个对象", async () => {
    // 单独导入完整版（core 入口作为它的依赖执行）
    await import("../src/full/index.ts");
    const { registerCustomElements } = await import("../src/full/hosts.ts");
    expect(g.skz!.registerCustomElements).toBe(registerCustomElements);
    expect(typeof g.skz!.enable).toBe("function");

    // 先 core 后 full：共用同一个 skz 对象，full 在上面补属性
    vi.resetModules();
    delete g.skz;
    await import("../src/core/index.ts");
    const coreOnly = currentSkz();
    expect(coreOnly!.registerCustomElements).toBeUndefined();
    await import("../src/full/index.ts");
    expect(currentSkz()).toBe(coreOnly);
    expect(currentSkz()!.registerCustomElements).toBeDefined();
  });

  it("全局 skz 被别人占用时：完整版不碰它，但默认导出照样带 registerCustomElements", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const theirs: Record<string, unknown> = { mine: true };
    g.skz = theirs;
    const mod = await import("../src/full/index.ts");
    const { registerCustomElements } = await import("../src/full/hosts.ts");
    expect(g.skz).toBe(theirs);
    expect(theirs.registerCustomElements).toBeUndefined();
    expect(mod.default.registerCustomElements).toBe(registerCustomElements);
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
