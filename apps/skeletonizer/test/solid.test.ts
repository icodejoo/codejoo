// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createComponent, createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
// 引入 core 入口：它执行时把 API 挂到私有全局键，适配层靠这个键取 enable / disable
import "../src/core/index.ts";
import { registerExtension } from "../src/core/extension.ts";
import { SkzBox, skeleton } from "../src/solid.ts";
import type { SkzParams } from "../src/solid.ts";

/** 扩展收到的选项（确认 opts 原样透传，含自定义扩展的字段） */
const seen: Array<Record<string, unknown>> = [];

registerExtension({
  name: "solid-test",
  sync: (_el, opts) => void seen.push(opts as Record<string, unknown>),
  release: () => {},
});

/** 本用例挂载的清理函数 */
const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  seen.length = 0;
  document.body.innerHTML = "";
});

/**
 * 把 Solid 组件挂到新容器
 * @param fn 返回根节点的函数
 * @returns 容器元素
 */
function mount(fn: () => never): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  disposers.push(render(fn, host));
  return host;
}

describe("solid 适配层", () => {
  it("skeleton 指令：loading 切换时开 / 关骨架，选项透传", () => {
    const el = document.createElement("div");
    const [loading, setLoading] = createSignal(true);
    const [effect, setEffect] = createSignal<SkzParams["effect"]>("pulse");
    disposers.push(
      createRoot((dispose) => {
        skeleton(el, () => ({ loading: loading(), effect: effect(), custom: "x" }) as SkzParams);
        return dispose;
      }),
    );
    // createEffect 在 createRoot 内延后到微任务外同步执行完毕
    expect(el.getAttribute("skz-effect")).toBe("pulse");
    expect(seen[0].custom).toBe("x");
    setEffect("shimmer");
    expect(el.getAttribute("skz-effect")).toBe("shimmer");
    setLoading(false);
    expect(el.hasAttribute("skz")).toBe(false);
    setLoading(true);
    expect(el.hasAttribute("skz")).toBe(true);
  });

  it("skeleton 指令：卸载时 disable", () => {
    const el = document.createElement("div");
    const dispose = createRoot((d) => {
      skeleton(el, () => ({ loading: true }));
      return d;
    });
    expect(el.hasAttribute("skz")).toBe(true);
    dispose();
    expect(el.hasAttribute("skz")).toBe(false);
  });

  it("SkzBox：渲染包裹元素（缺省 div、可换标签、class 与 children 透传），自己的 props 不进选项", () => {
    const host = mount((() => createComponent(SkzBox, { loading: true, effect: "pulse", class: "c", children: "kid", custom: 1 } as never)) as never);
    const box = host.firstElementChild as HTMLElement;
    expect(box.tagName).toBe("DIV");
    expect(box.className).toBe("c");
    expect(box.textContent).toBe("kid");
    expect(box.getAttribute("skz-effect")).toBe("pulse");
    expect(Object.keys(seen[0]).toSorted()).toEqual(["custom", "effect"]);

    const other = mount((() => createComponent(SkzBox, { as: "section" })) as never);
    expect(other.firstElementChild!.tagName).toBe("SECTION");
    expect(other.firstElementChild!.hasAttribute("skz")).toBe(false);
  });

  it("SkzBox：loading 响应式切换，卸载后关闭", () => {
    const [loading, setLoading] = createSignal(true);
    let dispose!: () => void;
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(
      (() =>
        createComponent(SkzBox, {
          get loading() {
            return loading();
          },
        })) as never,
      host,
    );
    const box = host.firstElementChild as HTMLElement;
    expect(box.hasAttribute("skz")).toBe(true);
    setLoading(false);
    expect(box.hasAttribute("skz")).toBe(false);
    setLoading(true);
    expect(box.hasAttribute("skz")).toBe(true);
    dispose();
    expect(box.hasAttribute("skz")).toBe(false);
  });
});
