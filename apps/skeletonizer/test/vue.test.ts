// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
// 引入 core 入口：它执行时把 API 挂到私有全局键，适配层靠这个键取 enable / disable
import "../src/core/index.ts";
import { createApp, defineComponent, h, nextTick, reactive, ref, shallowRef, toRef } from "vue";
import type { App, Ref } from "vue";
import { registerExtension } from "../src/core/extension.ts";
import type { SkzEffect } from "../src/core/types.ts";
import type { SkzTextMode } from "../src/full/types.ts";
import { SkzBox, useSkeleton } from "../src/vue.ts";

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

/** 当前用例创建的 app：afterEach 里卸载，免得旧 app 继续订阅共享的 state 污染后面的用例 */
let app: App | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
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
  app = createApp({
    render: () => h(SkzBox, { loading: state.loading, effect: state.effect, text: state.text, fit: state.fit }, () => state.label),
  });
  app.mount(host);
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

  it("as 变化换了元素：旧元素的骨架被撤掉，新元素带上 skz", async () => {
    const tag = ref("div");
    host = document.createElement("div");
    document.body.appendChild(host);
    app = createApp({ render: () => h(SkzBox, { loading: true, as: tag.value }, () => "x") });
    app.mount(host);
    const oldEl = host.firstElementChild!;
    expect(oldEl.hasAttribute("skz")).toBe(true);

    tag.value = "section";
    await nextTick();
    await nextTick();
    const newEl = host.firstElementChild!;
    expect(newEl).not.toBe(oldEl);
    expect(newEl.tagName).toBe("SECTION");
    expect(newEl.hasAttribute("skz")).toBe(true);
    expect(oldEl.hasAttribute("skz")).toBe(false);
  });
});

describe("vue useSkeleton", () => {
  /**
   * 挂一个调用 useSkeleton 的组件，loading 跟随 state
   * @param target 目标元素引用
   */
  function mountComposable(target: Ref<HTMLElement | null>): void {
    host = document.createElement("div");
    document.body.appendChild(host);
    app = createApp(
      defineComponent({
        setup() {
          useSkeleton(target, toRef(state, "loading"));
          return () => h("div");
        },
      }),
    );
    app.mount(host);
  }

  it("目标晚挂载：target 由 null 变成元素后立即带上 skz；换成另一个元素时旧的撤掉、新的挂上；卸载全部撤掉", async () => {
    const target = shallowRef<HTMLElement | null>(null);
    state.loading = true;
    mountComposable(target);

    const a = document.createElement("div");
    const b = document.createElement("div");
    target.value = a;
    await nextTick();
    expect(a.hasAttribute("skz")).toBe(true);

    target.value = b;
    await nextTick();
    expect(a.hasAttribute("skz")).toBe(false);
    expect(b.hasAttribute("skz")).toBe(true);

    target.value = null;
    await nextTick();
    expect(b.hasAttribute("skz")).toBe(false);

    target.value = a;
    await nextTick();
    expect(a.hasAttribute("skz")).toBe(true);
    app!.unmount();
    app = undefined;
    expect(a.hasAttribute("skz")).toBe(false);
  });

  it("真实模板 ref：挂载过程中 ref 被赋值，只同步 1 次（不会 onMounted 与 watcher 各同步一次）", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    app = createApp(
      defineComponent({
        setup() {
          const el = ref<HTMLElement>();
          useSkeleton(el, ref(true));
          return () => h("div", { ref: el });
        },
      }),
    );
    app.mount(host);
    await nextTick();
    expect(seen.length).toBe(1);
    expect(host.firstElementChild?.hasAttribute("skz")).toBe(true);
  });

  it("loading 变化照常开关当前目标", async () => {
    const el = document.createElement("div");
    const target = shallowRef<HTMLElement | null>(el);
    mountComposable(target);
    expect(el.hasAttribute("skz")).toBe(false);
    state.loading = true;
    await nextTick();
    expect(el.hasAttribute("skz")).toBe(true);
    state.loading = false;
    await nextTick();
    expect(el.hasAttribute("skz")).toBe(false);
  });
});
