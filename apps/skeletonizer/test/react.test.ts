// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerExtension } from "../src/core/extension.ts";
import type { EnableOptions } from "../src/core/types.ts";

/** 被捕获的 useEffect 调用：回调与依赖数组（不真的渲染，手动执行回调） */
const effects: Array<{ fn: () => void | (() => void); deps: unknown[] }> = [];

/** 当前 useRef 要返回的 ref（测试里设成指向 jsdom 元素） */
const refHolder: { current: HTMLElement | null } = { current: null };

// 只要 Hook 的行为，不引入 react-dom：把 react 换成最小桩
vi.mock("react", () => ({
  createElement: (type: unknown, props: unknown, children: unknown) => ({ type, props, children }),
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => void effects.push({ fn, deps }),
  useRef: () => refHolder,
}));

/** 扩展收到的选项（用来确认 opts 原样透传，含自定义扩展的字段） */
const seen: Array<Record<string, unknown>> = [];

registerExtension({
  name: "react-test",
  sync: (_el, opts) => void seen.push(opts as Record<string, unknown>),
  release: () => {},
});

afterEach(() => {
  effects.length = 0;
  seen.length = 0;
  refHolder.current = null;
});

describe("react 适配层", () => {
  it("useSkeleton：依赖是选项的序列化签名，每次渲染传新对象字面量、内容不变时依赖不变", async () => {
    const { useSkeleton } = await import("../src/react.ts");
    const ref = { current: document.createElement("div") };
    useSkeleton(ref, true, { effect: "pulse", fit: true });
    useSkeleton(ref, true, { effect: "pulse", fit: true });
    useSkeleton(ref, true, { effect: "shimmer", fit: true });
    const [a, b, c] = effects.map((e) => e.deps);
    expect(a).toEqual(b);
    expect(a[2]).toBe(b[2]);
    expect(a[2]).not.toBe(c[2]);
  });

  it("useSkeleton：enable 收到原对象（自定义扩展的选项也能透传），关闭函数作为清理返回", async () => {
    const { useSkeleton } = await import("../src/react.ts");
    const el = document.createElement("div");
    const opts = { effect: "pulse", custom: "x" } as EnableOptions;
    useSkeleton({ current: el }, true, opts);
    const cleanup = effects[0].fn();
    expect(seen[0]).toBe(opts);
    expect(el.getAttribute("skz-effect")).toBe("pulse");
    expect(typeof cleanup).toBe("function");
    (cleanup as () => void)();
    expect(el.hasAttribute("skz")).toBe(false);
  });

  it("useSkeleton：loading 为假或 ref 没挂上时什么都不做", async () => {
    const { useSkeleton } = await import("../src/react.ts");
    const el = document.createElement("div");
    useSkeleton({ current: el }, false);
    useSkeleton({ current: null }, true);
    expect(effects.map((e) => e.fn())).toEqual([undefined, undefined]);
    expect(el.hasAttribute("skz")).toBe(false);
  });

  it("SkzBox：自己的 props（loading / as / children / className）不进选项，其余原样透传；as 缺省 div", async () => {
    const { SkzBox } = await import("../src/react.ts");
    const el = document.createElement("div");
    refHolder.current = el;
    const node = SkzBox({ loading: true, effect: "pulse", text: "leaf", className: "c", children: "kid", custom: 1 } as never) as unknown as {
      type: string;
      props: { className: string };
      children: string;
    };
    expect(node.type).toBe("div");
    expect(node.props.className).toBe("c");
    expect(node.children).toBe("kid");
    effects[0].fn();
    expect(Object.keys(seen[0]).toSorted()).toEqual(["custom", "effect", "text"]);

    const other = SkzBox({ loading: false, as: "section" }) as unknown as { type: string };
    expect(other.type).toBe("section");
  });
});
