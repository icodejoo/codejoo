/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { createRoot } from "solid-js";
import { get } from "svelte/store";
import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayerman, type Layerman, type OverlayConfig, type OverlayHandle, type OverlayInstance } from "../src/index.ts";
import * as react from "../src/react.ts";
import * as vue from "../src/vue.ts";
import * as solid from "../src/solid.ts";
import * as svelte from "../src/svelte.ts";

/** 跨框架共用编号。 */
const ID = "contract";
/** 四种适配器都接受的默认配置。 */
const DEFAULTS = { priority: 1, overlap: true };
/** 测试管理器和订阅作用域的清理表。 */
const disposers: (() => void)[] = [];
/** 对齐读取方式后的适配器契约。 */
interface Harness {
  /** 读取订阅所见实例。 */
  instance: () => OverlayInstance | undefined;
  /** 读取可见状态。 */
  visible: () => boolean;
  /** 读取适配器派生的阶段。 */
  phase: () => OverlayInstance["phase"] | undefined;
  /** 打开绑定条目。 */
  open: (config?: Omit<OverlayConfig, "id">) => OverlayHandle;
  /** 请求关闭。 */
  close: () => void;
  /** 强制移除。 */
  remove: () => void;
  /** 兑现结果。 */
  resolve: (value: unknown) => void;
  /** 拒绝结果。 */
  reject: (error: unknown) => void;
  /** 暂停倒计时。 */
  pause: () => void;
  /** 恢复倒计时。 */
  resume: () => void;
  /** 释放框架作用域。 */
  dispose: () => void;
}
/** 为各框架建立真实订阅和对应销毁操作。 */
const adapters: [string, (m: Layerman) => Harness][] = [
  [
    "Vue",
    (m) => {
      const scope = effectScope();
      const o = scope.run(() => vue.useOverlay(ID, DEFAULTS, m))!;
      return {
        ...o,
        instance: () => o.instance.value,
        visible: () => o.visible.value,
        phase: () => o.phase.value,
        dispose: () => scope.stop(),
      };
    },
  ],
  [
    "React",
    (m) => {
      const hook = renderHook(() => react.useOverlay(ID, DEFAULTS, m));
      return {
        ...hook.result.current,
        instance: () => hook.result.current.instance,
        visible: () => hook.result.current.visible,
        phase: () => hook.result.current.phase,
        dispose: hook.unmount,
      };
    },
  ],
  [
    "Svelte",
    (m) => {
      const o = svelte.overlay(ID, DEFAULTS, m);
      let instance: OverlayInstance | undefined;
      let visible = false;
      let phase: OverlayInstance["phase"] | undefined;
      const off = o.instance.subscribe((value) => {
        instance = value;
      });
      const offVisible = o.visible.subscribe((value) => {
        visible = value;
      });
      // phase store 也需要实际订阅，验证它与实例阶段一致。
      const offPhase = o.phase.subscribe((value) => {
        phase = value;
      });
      expect(get(o.phase)).toBeUndefined();
      return {
        ...o,
        instance: () => instance,
        visible: () => visible,
        phase: () => phase,
        dispose: () => {
          off();
          offVisible();
          offPhase();
        },
      };
    },
  ],
  ["Solid", (m) => createRoot((dispose) => ({ ...solid.useOverlay(ID, DEFAULTS, m), dispose }))],
];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose());
  vi.useRealTimers();
});

describe.each(adapters)("%s 适配器共享契约", (_name, mount) => {
  /** 创建具有显式关闭握手的绑定。 */
  function setup(): Harness {
    const m = createLayerman({ crossTab: false, autoRemove: false });
    disposers.push(() => m.destroy());
    const h = mount(m);
    disposers.push(h.dispose);
    return h;
  }

  it("打开后可见，关闭保留离场阶段，移除后不可见", () => {
    const h = setup();
    expect(h.visible()).toBe(false);
    act(() => {
      h.open();
    });
    expect(h.visible()).toBe(true);
    expect(h.instance()?.phase).toBe("open");
    expect(h.phase()).toBe("open");
    act(h.close);
    expect(h.instance()?.phase).toBe("closing");
    expect(h.phase()).toBe("closing");
    expect(h.visible()).toBe(true);
    act(h.remove);
    expect(h.visible()).toBe(false);
    expect(h.phase()).toBeUndefined();
  });

  it("成功与失败结果保留宿主投递的值和错误", async () => {
    const h = setup();
    let handle!: OverlayHandle;
    act(() => {
      handle = h.open();
      h.resolve(42);
    });
    await expect(handle.result).resolves.toBe(42);
    act(h.remove);
    act(() => {
      handle = h.open();
    });
    const error = new Error("契约拒绝");
    const rejection = expect(handle.result).rejects.toBe(error);
    act(() => {
      h.reject(error);
    });
    await rejection;
  });

  it("每次打开合并默认配置且显式参数覆盖同名字段", () => {
    const h = setup();
    act(() => {
      h.open({ priority: 9 });
    });
    expect(h.instance()).toMatchObject({ priority: 9, overlapping: true });
    act(h.remove);
    act(() => {
      h.open();
    });
    expect(h.instance()?.priority).toBe(DEFAULTS.priority);
  });

  it("关闭命令等待守卫，拒绝后保持 open，放行后保留 closing", async () => {
    const h = setup();
    let allowed = false;
    const guard = vi.fn(async () => allowed);
    act(() => {
      h.open({ beforeClose: guard });
    });
    await act(async () => {
      h.close();
    });
    expect(h.phase()).toBe("open");
    allowed = true;
    await act(async () => {
      h.close();
    });
    expect(h.phase()).toBe("closing");
    expect(h.visible()).toBe(true);
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it("暂停恢复转发计时命令且作用域销毁后不再收到更新", () => {
    const h = setup();
    act(() => {
      h.open({ duration: 100 });
      h.pause();
      vi.advanceTimersByTime(200);
    });
    expect(h.instance()?.phase).toBe("open");
    act(() => {
      h.resume();
      vi.advanceTimersByTime(100);
    });
    expect(h.instance()?.phase).toBe("closing");
    const last = h.instance();
    h.dispose();
    act(h.remove);
    expect(h.instance()).toBe(last);
  });
});
