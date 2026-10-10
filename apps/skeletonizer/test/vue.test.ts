// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createApp, h, nextTick, reactive } from "vue";
import { registerExtension } from "../src/core/extension.ts";
import type { SkzEffect } from "../src/core/types.ts";
import type { SkzTextMode } from "../src/full/types.ts";
import { SkzBox } from "../src/vue.ts";

/** 扩展收到的选项快照（每次 enable 一条，用来数同步次数） */
const seen: Array<Record<string, unknown>> = [];

registerExtension({
  name: "vue-test",
  sync: (_el, opts) => void seen.push({ ...opts }),
  release: () => {},
});

/** 父组件的响应式状态 */
const state = reactive<{ loading: boolean; effect?: SkzEffect; text?: SkzTextMode; fit?: boolean; label: string }>({ loading: false, label: "a" });

/** 挂载点 */
let host: HTMLElement;

afterEach(() => {
  host?.remove();
  seen.length = 0;
  state.loading = false;
  state.effect = undefined;
  state.text = undefined;
  state.fit = undefined;
  state.label = "a";
});

/**
 * 挂一个 SkzBox，props 随 state 变化；插槽内容读 state.label
 * @returns 组件根元素
 */
function mount(): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  createApp({
    render: () => h(SkzBox, { loading: state.loading, effect: state.effect, text: state.text, fit: state.fit }, () => state.label),
  }).mount(host);
  return host.firstElementChild as HTMLElement;
}

describe("vue SkzBox", () => {
  it("loading 开关根元素的骨架；effect / text 变化会重新同步", async () => {
    const root = mount();
    expect(root.hasAttribute("skz")).toBe(false);

    state.loading = true;
    state.effect = "pulse";
    await nextTick();
    expect(root.hasAttribute("skz")).toBe(true);
    expect(root.getAttribute("skz-effect")).toBe("pulse");

    state.effect = "shimmer";
    await nextTick();
    expect(root.getAttribute("skz-effect")).toBe("shimmer");

    state.text = "leaf";
    await nextTick();
    expect(seen.at(-1)!.text).toBe("leaf");

    state.loading = false;
    await nextTick();
    expect(root.hasAttribute("skz")).toBe(false);
  });

  it("只有插槽内容变化时不重复同步", async () => {
    const root = mount();
    state.loading = true;
    await nextTick();
    const before = seen.length;
    state.label = "b";
    await nextTick();
    expect(root.textContent).toBe("b");
    expect(seen.length).toBe(before);
  });
});
