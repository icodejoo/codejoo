/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createLayerman, type Layerman } from "../src/index.ts";
import { LayermanProvider, useCurrentOverlay, useOverlay, useLayerman, useOverlays, useOverlayState } from "../src/react.ts";
import { CurrentOverlayContext } from "../src/react.ts";

const managers: Layerman[] = [];

function make(): Layerman {
  const m = createLayerman({ crossTab: false });
  managers.push(m);
  return m;
}

afterEach(() => {
  for (const m of managers) m.destroy();
  managers.length = 0;
});

describe("@codejoo/layerman/react", () => {
  it("useOverlayState：桥成 React 状态，open 后更新（SSR 空态起步）", () => {
    const m = make();
    const { result } = renderHook(() => useOverlayState(m));
    expect(result.current.active).toEqual([]);
    act(() => {
      m.open({ id: "a" });
    });
    expect(result.current.active.map((o) => o.id)).toEqual(["a"]);
  });

  it("useOverlays：active/queued 随 open/remove 响应式更新", () => {
    const m = make();
    const { result } = renderHook(() => useOverlays(m));
    expect(result.current.active).toEqual([]);
    expect(result.current.queued).toEqual([]);

    act(() => {
      m.open({ id: "a" });
      m.open({ id: "b" });
    });
    expect(result.current.active.map((o) => o.id)).toEqual(["a"]);
    expect(result.current.queued).toEqual(["b"]);

    act(() => {
      m.remove("a");
    });
    // a 移除 → b 补位到 active
    expect(result.current.active.map((o) => o.id)).toEqual(["b"]);
    expect(result.current.queued).toEqual([]);
  });

  it("useOverlay：open() → visible=true / phase 'open'；close() → phase 'closing'", () => {
    const m = make();
    const { result } = renderHook(() => useOverlay("promo", undefined, m));
    expect(result.current.visible).toBe(false);

    act(() => {
      result.current.open({ priority: 5 });
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.phase).toBe("open");
    expect(result.current.instance?.priority).toBe(5);

    act(() => {
      result.current.close();
    });
    expect(result.current.phase).toBe("closing");
  });

  it("useOverlay：defaults 与 open(config) 合并，config 覆盖 defaults", () => {
    const m = make();
    const { result } = renderHook(() => useOverlay("d", { priority: 1, overlap: true }, m));
    act(() => {
      result.current.open({ priority: 9 });
    });
    expect(result.current.instance?.priority).toBe(9);
    expect(result.current.instance?.overlapping).toBe(true);
  });

  it("useOverlay：defaults 支持函数形态，每次 open 取最新值", () => {
    const m = make();
    let pri = 1;
    const { result } = renderHook(() => useOverlay("x", () => ({ priority: pri, overlap: true }), m));
    act(() => {
      result.current.open();
    });
    expect(result.current.instance?.priority).toBe(1);
    pri = 9;
    act(() => {
      result.current.open(); // 同 id 活跃 → 丢弃重开，取最新 defaults
    });
    expect(result.current.instance?.priority).toBe(9);
  });

  it("useOverlay：open().result 经 resolve 兑现", async () => {
    const m = make();
    const { result } = renderHook(() => useOverlay<unknown>("confirm", undefined, m));
    let handle: ReturnType<typeof result.current.open<boolean>>;
    act(() => {
      handle = result.current.open<boolean>();
      result.current.resolve(true);
    });
    await expect(handle!.result).resolves.toBe(true);
  });

  it("Provider 注入：不传 om 时经 <LayermanProvider> 取到 manager", () => {
    const m = make();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(LayermanProvider, { manager: m }, children);
    const { result } = renderHook(() => useOverlay("fromProvider"), { wrapper });
    act(() => {
      result.current.open();
    });
    expect(result.current.visible).toBe(true);
    expect(m.get("fromProvider")?.id).toBe("fromProvider");
  });

  it("useLayerman：既未传参又未注入 → 抛错", () => {
    expect(() => renderHook(() => useLayerman())).toThrow(/no manager/);
  });

  it("useCurrentOverlay：经 Context 拿到自身 id 的控制句柄（无需透传）", () => {
    const m = make();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(LayermanProvider, { manager: m }, createElement(CurrentOverlayContext.Provider, { value: "cur" }, children));
    const { result } = renderHook(() => useCurrentOverlay(), { wrapper });
    act(() => {
      result.current.open();
    });
    expect(result.current.instance?.id).toBe("cur");
    expect(result.current.visible).toBe(true);
  });

  it("useCurrentOverlay：无当前 overlay 注入 → 抛错", () => {
    const m = make();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(LayermanProvider, { manager: m }, children);
    expect(() => renderHook(() => useCurrentOverlay(), { wrapper })).toThrow(/current overlay/);
  });
});
