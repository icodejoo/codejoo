import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vCountUp } from "./vue";
import { clear as countupClear, tick as countupTick } from "./count-up/count-up";

/** 指令钩子的最小调用面：vue.ts 运行时不依赖 vue，直接传伪造 binding 即可 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dir: any = vCountUp;

describe("vCountUp", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    countupClear("grp");
    countupClear();
    vi.unstubAllGlobals();
  });

  it("updated 重定目标且未传 label 时，沿用引擎保留的旧 label，卸载能删掉任务", () => {
    const el = document.createElement("div");
    dir.mounted(el, { value: { to: 10, label: "grp", duration: 1000 }, modifiers: {} });
    dir.updated(el, { value: { to: 20, duration: 1000 }, oldValue: { to: 10, label: "grp", duration: 1000 }, modifiers: {} });
    expect(countupTick(0, 0)).toBe(true); // 任务仍在 grp 分组里
    dir.unmounted(el);
    expect(countupTick(100, 100)).toBe(false); // 修复前记录成 default 分组，grp 里的任务删不掉
  });

  it("旧任务已完成被 autoKill 后 updated 不传 label：引擎新建任务，记录按默认分组，卸载仍能删掉", () => {
    const el = document.createElement("div");
    const linear = { duration: 1000, fps: 0, easing: (t: number) => t };
    dir.mounted(el, { value: { to: 10, label: "grp", ...linear }, modifiers: {} });
    countupTick(0, 0);
    expect(countupTick(1000, 1000)).toBe(false); // 完成 → autoKill 出队
    dir.updated(el, { value: { to: 20, ...linear }, oldValue: { to: 10, label: "grp", ...linear }, modifiers: {} }); // 不传 label → 新任务落在 default
    expect(countupTick(1100, 100)).toBe(true); // 新任务在跑
    dir.unmounted(el);
    expect(countupTick(1200, 100)).toBe(false); // 沿用旧 label 会去 grp 里删，default 里的新任务删不掉
  });
});
