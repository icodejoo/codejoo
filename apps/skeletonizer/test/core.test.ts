// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCore } from "./helpers.ts";

/**
 * 造一个挂在 body 上的根元素
 * @returns 根元素
 */
function makeRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

beforeAll(() => {
  // jsdom 没有原生 inert：补一个反射 inert 属性的访问器，让 enable 走原生分支
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("inert");
    },
    set(this: HTMLElement, v: boolean) {
      this.toggleAttribute("inert", !!v);
    },
  });
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("core 单独使用（不注册任何扩展）", () => {
  it("enable / disable：根标记、aria-busy、effect 属性，关闭后一点不留", async () => {
    const { enable, disable } = await loadCore();
    const el = makeRoot();
    const off = enable(el, { effect: "shimmer" });
    expect(el.hasAttribute("skz")).toBe(true);
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.getAttribute("skz-effect")).toBe("shimmer");
    off();
    expect(el.getAttributeNames()).toEqual([]);

    enable(el, { effect: "pulse" });
    disable(el);
    expect(el.getAttributeNames()).toEqual([]);
  });

  it("重复调用幂等：没传的 effect 会被清掉，返回同一个关闭函数", async () => {
    const { enable } = await loadCore();
    const el = makeRoot();
    const off1 = enable(el, { effect: "pulse" });
    const off2 = enable(el);
    expect(off2).toBe(off1);
    expect(el.hasAttribute("skz-effect")).toBe(false);
    expect(el.hasAttribute("skz")).toBe(true);
    off1();
  });

  it("text / engine / fallback 是完整版的选项：core 不写任何属性（没注册扩展 = 无效果；inert 是交互锁在 jsdom 补丁下的属性反射）", async () => {
    const { enable } = await loadCore();
    const el = makeRoot();
    enable(el, { effect: "pulse", text: "leaf", engine: "svg", fallback: "fade" } as never);
    expect(el.getAttributeNames().sort()).toEqual(["aria-busy", "inert", "skz", "skz-effect"]);
  });

  it("交互锁：根被 inert，关闭后解除；原本就 inert 的不动", async () => {
    const { enable } = await loadCore();
    const el = makeRoot();
    const off = enable(el);
    expect(el.inert).toBe(true);
    off();
    expect(el.inert).toBe(false);

    el.inert = true;
    enable(el)();
    expect(el.inert).toBe(true);
  });

  it("忽略区：打 skz-has-ignore，inert 只锁不含忽略区的分支；移除忽略区后重入会撤掉标记", async () => {
    const { enable } = await loadCore();
    const el = makeRoot();
    el.innerHTML = `<p id="a">a</p><section><span skz-ignore id="keep">k</span></section><p id="b">b</p>`;
    const off = enable(el);
    expect(el.hasAttribute("skz-has-ignore")).toBe(true);
    expect(el.inert).toBe(false);
    expect(el.querySelector<HTMLElement>("#a")!.inert).toBe(true);
    expect(el.querySelector<HTMLElement>("#b")!.inert).toBe(true);
    expect(el.querySelector<HTMLElement>("#keep")!.inert).toBe(false);

    el.querySelector("section")!.remove();
    enable(el);
    expect(el.hasAttribute("skz-has-ignore")).toBe(false);
    expect(el.inert).toBe(true);
    off();
    expect(el.inert).toBe(false);
    expect(el.querySelector<HTMLElement>("#a")!.inert).toBe(false);
  });
});

describe("通用扩展点 registerExtension", () => {
  it("每次 enable（含重复调用）按注册顺序 sync，关闭时按注册顺序 release", async () => {
    const { enable, registerExtension } = await loadCore();
    const log: string[] = [];
    for (const name of ["a", "b", "c"]) {
      registerExtension({ name, sync: () => void log.push(`sync:${name}`), release: () => void log.push(`release:${name}`) });
    }
    const el = makeRoot();
    const off = enable(el, { effect: "pulse" });
    enable(el);
    off();
    expect(log).toEqual(["sync:a", "sync:b", "sync:c", "sync:a", "sync:b", "sync:c", "release:a", "release:b", "release:c"]);
  });

  it("sync 收到的是本次选项，调用时根上已带 skz", async () => {
    const { enable, registerExtension } = await loadCore();
    const seen: Array<{ opts: unknown; skz: boolean }> = [];
    registerExtension({ name: "spy", sync: (el, opts) => void seen.push({ opts, skz: el.hasAttribute("skz") }), release: () => {} });
    const off = enable(makeRoot(), { effect: "solid", fit: false });
    expect(seen).toEqual([{ opts: { effect: "solid", fit: false }, skz: true }]);
    off();
  });

  it("按 name 去重：同名后注册的覆盖先注册的，位置沿用原来的", async () => {
    const { enable, registerExtension } = await loadCore();
    const log: string[] = [];
    registerExtension({ name: "x", sync: () => void log.push("x1"), release: () => {} });
    registerExtension({ name: "y", sync: () => void log.push("y"), release: () => {} });
    registerExtension({ name: "x", sync: () => void log.push("x2"), release: () => {} });
    enable(makeRoot())();
    expect(log).toEqual(["x2", "y"]);
  });

  it("扩展自己的清理：扩展在 sync 里写的属性，release 里撤掉后根上不留痕迹", async () => {
    const { enable, registerExtension } = await loadCore();
    registerExtension({
      name: "flag",
      sync: (el, opts) => el.toggleAttribute("my-flag", opts.effect === "pulse"),
      release: (el) => el.removeAttribute("my-flag"),
    });
    const el = makeRoot();
    const off = enable(el, { effect: "pulse" });
    expect(el.hasAttribute("my-flag")).toBe(true);
    enable(el, { effect: "fade" });
    expect(el.hasAttribute("my-flag")).toBe(false);
    enable(el, { effect: "pulse" });
    off();
    expect(el.getAttributeNames()).toEqual([]);
  });

  it("listExtensions：没新注册时复用同一份快照；注册后给新快照，旧快照不变（遍历中注册不影响本轮）", async () => {
    const { registerExtension } = await loadCore();
    const { listExtensions } = await import("../src/core/extension.ts");
    registerExtension({ name: "a", sync: () => {}, release: () => {} });
    const first = listExtensions();
    expect(listExtensions()).toBe(first);
    expect(first.map((e) => e.name)).toEqual(["a"]);
    registerExtension({ name: "b", sync: () => {}, release: () => {} });
    expect(first.map((e) => e.name)).toEqual(["a"]);
    expect(listExtensions().map((e) => e.name)).toEqual(["a", "b"]);
  });
});
