/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { transformWithOxc } from "vite-plus";
import { renderToString } from "react-dom/server";
import { createRoot } from "solid-js";
import { createApp, effectScope, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayerman, type Layerman } from "../src/index.ts";
import * as react from "../src/react.ts";
import * as vue from "../src/vue.ts";
import * as solid from "../src/solid.ts";

/** 当前绑定的固定编号。 */
const ID = "coverage";
/** 默认自动移除时长。 */
const AUTO_REMOVE_MS = 300;
/** 本文件资源清理列表。 */
const disposers: (() => void)[] = [];
/** 创建不跨标签页的管理器。 */
function make(): Layerman {
  const m = createLayerman({ crossTab: false });
  disposers.push(() => m.destroy());
  return m;
}
/** 仅通过公开订阅接口统计仍在使用的监听。 */
function countSubscriptions(m: Layerman): () => number {
  const original = m.subscribe.bind(m);
  let count = 0;
  vi.spyOn(m, "subscribe").mockImplementation((listener, options) => {
    const unsubscribe = original(listener, options);
    count++;
    let active = true;
    return () => {
      if (active) count--;
      active = false;
      unsubscribe();
    };
  });
  return () => count;
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Vue 可见模型关闭矩阵", () => {
  it("模型打开被拒绝后释放打开闩锁并允许再次打开", async () => {
    const m = make();
    const scope = effectScope();
    disposers.push(() => scope.stop());
    const overlay = scope.run(() => vue.useOverlay(ID, undefined, m))!;
    overlay.model.value = true;
    overlay.reject(new Error("宿主拒绝"));
    overlay.remove();
    await vi.advanceTimersByTimeAsync(0);
    overlay.model.value = true;
    expect(overlay.visible.value).toBe(true);
    expect(overlay.phase.value).toBe("open");
  });

  /** 守卫类型与其最终关闭决议。 */
  const guards = [
    ["无守卫", undefined, true],
    ["同步放行", () => true, true],
    ["同步拒绝", () => false, false],
    ["异步放行", () => Promise.resolve(true), true],
    ["异步拒绝", () => Promise.resolve(false), false],
    ["异步异常", () => Promise.reject(new Error("异步取消")), false],
    [
      "抛错",
      () => {
        throw new Error("拒绝关闭");
      },
      false,
    ],
  ] as const;
  for (const [label, beforeClose, allowed] of guards) {
    for (const autoRemove of [true, false, 50] as const) {
      it(`${beforeClose && allowed ? "[C2][阶段4] " : ""}${label}且自动移除为${autoRemove}时模型关闭遵守守卫并及时收尾`, async () => {
        const m = make();
        const subscriptions = countSubscriptions(m);
        const scope = effectScope();
        disposers.push(() => scope.stop());
        const o = scope.run(() => vue.useOverlay(ID, { beforeClose, autoRemove }, m))!;
        o.model.value = true;
        const key = o.instance.value?.instanceKey;
        o.model.value = true;
        expect(o.instance.value?.instanceKey).toBe(key);
        o.model.value = false;
        await vi.advanceTimersByTimeAsync(0);
        expect(o.model.value).toBe(!allowed);
        expect(m.get(ID)?.phase).toBe(allowed ? undefined : "open");
        expect(subscriptions()).toBe(1);
      });
    }
  }

  it("守卫等待期间移除并重开同编号，旧守卫不得关闭新实例", async () => {
    const m = make();
    const scope = effectScope();
    disposers.push(() => scope.stop());
    let accept!: (value: boolean) => void;
    const beforeClose = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const o = scope.run(() => vue.useOverlay(ID, { beforeClose }, m))!;
    o.model.value = true;
    o.model.value = false;
    o.model.value = false;
    expect(beforeClose).toHaveBeenCalledTimes(1);
    o.remove();
    await Promise.resolve();
    o.model.value = true;
    const key = o.instance.value?.instanceKey;
    expect(key).toBeDefined();
    accept(true);
    await vi.advanceTimersByTimeAsync(AUTO_REMOVE_MS);
    expect(o.instance.value?.instanceKey).toBe(key);
    expect(o.phase.value).toBe("open");
  });

  for (const autoRemove of [true, false, 50] as const) {
    for (const action of ["remove", "reopen", "dispose"] as const) {
      for (const allowed of [true, false] as const) {
        it(`等待守卫时 ${action}，决议 ${allowed}、自动移除 ${autoRemove} 不误删且退订`, async () => {
          const m = make();
          const subscriptions = countSubscriptions(m);
          const scope = effectScope();
          disposers.push(() => scope.stop());
          let settle!: (value: boolean) => void;
          const o = scope.run(() =>
            vue.useOverlay(
              ID,
              {
                autoRemove,
                beforeClose: () =>
                  new Promise<boolean>((resolve) => {
                    settle = resolve;
                  }),
              },
              m,
            ),
          )!;
          o.open();
          const originalKey = m.get(ID)!.instanceKey;
          o.model.value = false;
          expect(subscriptions()).toBe(2);
          if (action === "dispose") scope.stop();
          else if (action === "remove") m.remove(ID);
          else m.open({ id: ID, autoRemove });
          expect(subscriptions()).toBe(action === "dispose" ? 0 : 1);
          const currentKey = m.get(ID)?.instanceKey;
          if (action === "reopen") expect(currentKey).not.toBe(originalKey);
          settle(allowed);
          await vi.advanceTimersByTimeAsync(0);
          expect(m.get(ID)?.instanceKey).toBe(currentKey);
          if (action === "dispose") expect(m.get(ID)?.phase).toBe(allowed ? "closing" : "open");
          else if (action === "reopen") expect(m.get(ID)?.phase).toBe("open");
          expect(subscriptions()).toBe(action === "dispose" ? 0 : 1);
        });
      }
    }
  }

  it("守卫拒绝后手动关闭仍保留 closing，模型再次关闭可重新请求", async () => {
    const m = make();
    const subscriptions = countSubscriptions(m);
    const scope = effectScope();
    disposers.push(() => scope.stop());
    const guard = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const o = scope.run(() => vue.useOverlay(ID, { beforeClose: guard, autoRemove: false }, m))!;
    o.open();
    o.model.value = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptions()).toBe(1);
    o.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(o.phase.value).toBe("closing");
    expect(guard).toHaveBeenCalledTimes(2);
    o.model.value = false;
    expect(o.model.value).toBe(false);
  });

  it("普通 close 已在等待时 model 关闭复用守卫，拒绝后也释放监听", async () => {
    const m = make();
    const subscriptions = countSubscriptions(m);
    const scope = effectScope();
    disposers.push(() => scope.stop());
    let settle!: (value: boolean) => void;
    const guard = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
    );
    const o = scope.run(() => vue.useOverlay(ID, { beforeClose: guard, autoRemove: false }, m))!;
    o.open();
    o.close();
    o.model.value = false;
    o.model.value = false;
    expect(guard).toHaveBeenCalledTimes(1);
    settle(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(o.phase.value).toBe("open");
    expect(subscriptions()).toBe(1);
    o.model.value = false;
    settle(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(o.model.value).toBe(false);
    expect(subscriptions()).toBe(1);
  });

  it("旧实例守卫拒绝不取消新实例的模型关闭监听", async () => {
    const m = make();
    const subscriptions = countSubscriptions(m);
    const scope = effectScope();
    disposers.push(() => scope.stop());
    const decisions: ((value: boolean) => void)[] = [];
    const o = scope.run(() =>
      vue.useOverlay(
        ID,
        {
          autoRemove: false,
          beforeClose: () =>
            new Promise<boolean>((resolve) => {
              decisions.push(resolve);
            }),
        },
        m,
      ),
    )!;
    o.open();
    o.model.value = false;
    o.open();
    o.model.value = false;
    decisions[0]!(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(subscriptions()).toBe(2);
    decisions[1]!(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(o.model.value).toBe(false);
    expect(subscriptions()).toBe(1);
  });

  it("open 参数可覆盖默认守卫，外部打开的放行实例也可由 model 收尾", async () => {
    const m = make();
    const scope = effectScope();
    disposers.push(() => scope.stop());
    const o = scope.run(() => vue.useOverlay(ID, { beforeClose: () => false, autoRemove: false }, m))!;
    o.open({ beforeClose: () => true });
    o.model.value = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(o.model.value).toBe(false);
    m.open({ id: ID, beforeClose: async () => true, autoRemove: false });
    o.model.value = false;
    await vi.advanceTimersByTimeAsync(0);
    expect(o.model.value).toBe(false);
  });

  it("排队模型重复开启不覆盖实例，取消后可以再次开启", async () => {
    const m = make();
    m.open({ id: "blocker" });
    const scope = effectScope();
    disposers.push(() => scope.stop());
    const o = scope.run(() => vue.useOverlay(ID, undefined, m))!;
    o.model.value = true;
    o.model.value = true;
    expect(m.getSnapshot().queued).toEqual([ID]);
    o.model.value = false;
    await vi.advanceTimersByTimeAsync(0);
    o.model.value = true;
    expect(m.getSnapshot().queued).toEqual([ID]);
  });

  it("组件内提供管理器与当前编号供子组件读取", () => {
    const m = make();
    let binding!: ReturnType<typeof vue.useCurrentOverlay>;
    const child = {
      setup() {
        binding = vue.useCurrentOverlay();
        return () => null;
      },
    };
    const app = createApp({
      setup() {
        vue.provideLayerman(m);
        vue.provideCurrentOverlay(ID);
        return () => h(child);
      },
    });
    app.mount(document.createElement("div"));
    disposers.push(() => app.unmount());
    binding.open();
    expect(binding.instance.value?.id).toBe(ID);
  });
});

describe("React 生命周期与服务端", () => {
  it("严格模式重复挂载仍只保留一个订阅且卸载后不再渲染", () => {
    const m = make();
    const original = m.subscribe.bind(m);
    const off = vi.fn();
    const subscribe = vi.spyOn(m, "subscribe").mockImplementation((listener, options) => {
      const unsubscribe = original(listener, options);
      return () => {
        off();
        unsubscribe();
      };
    });
    const renderState = vi.fn(() => react.useOverlayState(m));
    /** 严格模式包装以触发挂载检查。 */
    const wrapper = ({ children }: { children?: ReactNode }) => createElement(StrictMode, null, children);
    const hook = renderHook(renderState, { wrapper, reactStrictMode: true });
    expect(subscribe.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(subscribe.mock.calls.length - off.mock.calls.length).toBe(1);
    hook.unmount();
    const calls = renderState.mock.calls.length;
    act(() => {
      m.open({ id: ID });
    });
    expect(renderState).toHaveBeenCalledTimes(calls);
    expect(off.mock.calls.length).toBe(subscribe.mock.calls.length);
  });

  it("切换管理器会退订旧实例并绑定新实例", () => {
    const first = make();
    const second = make();
    const hook = renderHook(({ manager }) => react.useOverlay(ID, undefined, manager), {
      initialProps: { manager: first },
    });
    act(() => {
      hook.result.current.open();
    });
    expect(hook.result.current.visible).toBe(true);
    hook.rerender({ manager: second });
    expect(hook.result.current.visible).toBe(false);
    act(() => {
      hook.result.current.open({ priority: 7 });
    });
    const current = hook.result.current;
    act(() => {
      first.remove(ID);
    });
    expect(hook.result.current).toBe(current);
    expect(second.get(ID)?.priority).toBe(7);
  });

  it("服务端渲染读取空快照且不订阅，预绑定提供器可以注入", () => {
    const m = make();
    m.open({ id: ID });
    const getServerSnapshot = vi.spyOn(m, "getServerSnapshot");
    const subscribe = vi.spyOn(m, "subscribe");
    const Provider = react.createLayermanProvider(m);
    /** 服务端消费者输出服务端快照的数量。 */
    function Consumer() {
      return createElement("span", null, react.useOverlays().active.length);
    }
    expect(renderToString(createElement(Provider, null, createElement(Consumer)))).toBe("<span>0</span>");
    expect(getServerSnapshot).toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("现有当前编号提供器通过函数组件调用时可注入", () => {
    const m = make();
    /** 使用实际函数引用，覆盖当前导出的运行路径。 */
    const wrapper = ({ children }: { children?: ReactNode }) => createElement(react.provideCurrentOverlay, { id: ID }, children);
    const hook = renderHook(() => react.useCurrentOverlay(m), { wrapper });
    act(() => {
      hook.result.current.open();
    });
    expect(hook.result.current.instance?.id).toBe(ID);
  });

  it("缺少当前编号时错误提示推荐大写 Provider", () => {
    expect(() => renderHook(() => react.useCurrentOverlay(make()))).toThrow("<CurrentOverlayProvider id={id}>");
  });

  it("[C3][阶段4] 导出可在 JSX 中使用的大写当前弹层提供器", async () => {
    expect(react.provideCurrentOverlay).toBe(react.CurrentOverlayProvider);
    const m = make();
    let binding!: ReturnType<typeof react.useCurrentOverlay>;
    /** 实际挂载的子组件通过上下文读取编号。 */
    function Consumer() {
      binding = react.useCurrentOverlay(m);
      return createElement("span", null, binding.instance?.id);
    }
    const { code } = await transformWithOxc("return <CurrentOverlayProvider id={id}><Consumer /></CurrentOverlayProvider>;", "current-overlay.tsx", { jsx: { runtime: "classic", pragma: "createElement" } });
    // 只执行本测试上方的固定 JSX 经编译后的产物，不接受外部输入。
    // eslint-disable-next-line typescript-eslint/no-implied-eval
    const element = new Function("createElement", "CurrentOverlayProvider", "Consumer", "id", code)(createElement, react.CurrentOverlayProvider, Consumer, ID);
    const view = render(element);
    act(() => {
      binding.open();
    });
    expect(binding.instance?.id).toBe(ID);
    expect(view.getByText(ID)).toBeDefined();
  });
});

describe("Solid 作用域护栏", () => {
  it("没有所有者时提供上下文明确抛错", () => {
    const m = make();
    expect(() => solid.provideLayerman(m)).toThrow(/reactive scope/);
    expect(() => solid.provideCurrentOverlay(ID)).toThrow(/reactive scope/);
  });

  it("现状护栏：没有所有者的状态订阅仍会更新且需要调用方手动退订", () => {
    const m = make();
    const original = m.subscribe.bind(m);
    vi.spyOn(m, "subscribe").mockImplementation((listener, options) => {
      const off = original(listener, options);
      disposers.push(off);
      return off;
    });
    const state = solid.useOverlayState(m);
    m.open({ id: ID });
    expect(state().active[0]?.id).toBe(ID);
  });

  it("根作用域释放后当前编号绑定不再更新", () => {
    const m = make();
    const binding = createRoot((dispose) => {
      disposers.push(dispose);
      solid.provideLayerman(m);
      solid.provideCurrentOverlay(ID);
      return { overlay: solid.useCurrentOverlay(), dispose };
    });
    binding.overlay.open();
    const previous = binding.overlay.instance();
    binding.dispose();
    m.remove(ID);
    expect(binding.overlay.instance()).toBe(previous);
  });
});
