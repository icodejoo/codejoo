import { get, type Readable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLayerman, type Layerman, type OverlayState } from "../src/index.ts";
import { getLayerman, overlay, overlays, overlayState, provideCurrentOverlay, setLayerman } from "../src/svelte.ts";

const managers: Layerman[] = [];

function make(): Layerman {
  const m = createLayerman({ crossTab: false });
  managers.push(m);
  return m;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00"));
});

afterEach(() => {
  for (const m of managers) m.destroy();
  managers.length = 0;
  vi.useRealTimers();
});

describe("@codejoo/layerman/svelte", () => {
  it("overlayState：桥成 Readable，open/remove 推送新值（active/queued 变化）", () => {
    const m = make();
    const state = overlayState(m);
    const seen: OverlayState[] = [];
    const unsub = state.subscribe((s) => seen.push(s));

    // 首次订阅立即回填当前快照（空）。
    expect(seen[0].active).toEqual([]);
    expect(seen[0].queued).toEqual([]);

    m.open({ id: "a" });
    expect(get(state).active.map((o) => o.id)).toEqual(["a"]);

    m.open({ id: "b" }); // 串行槽被 a 占用 → b 入队
    expect(get(state).active.map((o) => o.id)).toEqual(["a"]);
    expect(get(state).queued).toEqual(["b"]);

    m.remove("a"); // a 退场 → b 顶上
    const last = get(state);
    expect(last.active.map((o) => o.id)).toEqual(["b"]);
    expect(last.queued).toEqual([]);

    // 至少收到：初始 + 每次核心变更的推送。
    expect(seen.length).toBeGreaterThanOrEqual(4);
    unsub();
  });

  it("overlays：active / queued 拆成两个只读 store", () => {
    const m = make();
    const { active, queued } = overlays(m);
    m.open({ id: "a" });
    m.open({ id: "b" });
    expect(get(active).map((o) => o.id)).toEqual(["a"]);
    expect(get(queued)).toEqual(["b"]);
  });

  it("overlay：visible open 后为 true；close 后 instance.phase='closing'", () => {
    const m = make();
    const o = overlay("promo", undefined, m);
    expect(get(o.visible)).toBe(false);
    expect(get(o.instance)).toBeUndefined();
    expect(get(o.phase)).toBeUndefined();

    o.open({ priority: 5 });
    expect(get(o.visible)).toBe(true);
    expect(get(o.phase)).toBe("open");
    expect(get(o.instance)?.priority).toBe(5);

    o.close(); // 两阶段关闭：进入 closing（autoRemove 定时器未推进，实例仍在）
    expect(get(o.instance)?.phase).toBe("closing");
    expect(get(o.phase)).toBe("closing");
    expect(get(o.visible)).toBe(true); // closing 仍算 active
  });

  it("overlay：open().result 经 resolve 兑现", async () => {
    const m = make();
    const o = overlay<unknown>("confirm", undefined, m);
    const h = o.open<boolean>();
    o.resolve(true);
    await expect(h.result).resolves.toBe(true);
  });

  it("overlay：被动 remove → result 以 { dismissed:true } 兑现", async () => {
    const m = make();
    const o = overlay("toast", undefined, m);
    const h = o.open();
    o.remove();
    await expect(h.result).resolves.toEqual({ dismissed: true });
  });

  it("overlay：defaults 与 open(config) 合并，config 覆盖 defaults", () => {
    const m = make();
    const o = overlay("d", { priority: 1, overlap: true }, m);
    o.open({ priority: 9 }); // 覆盖 priority，保留 overlap
    expect(get(o.instance)?.priority).toBe(9);
    expect(get(o.instance)?.overlapping).toBe(true);
  });

  it("overlay：defaults 支持 getter，每次 open 取最新值", () => {
    const m = make();
    let pri = 1;
    const o = overlay("x", () => ({ priority: pri, overlap: true }), m);
    o.open();
    expect(get(o.instance)?.priority).toBe(1);
    pri = 9;
    o.open(); // 同 id 活跃 → 丢弃重开，取最新 defaults
    expect(get(o.instance)?.priority).toBe(9);
  });

  it("store 退订：unsubscribe 后核心不再向该监听推送（无泄漏）", () => {
    const m = make();
    const state = overlayState(m);
    const listener = vi.fn();
    const unsub = state.subscribe(listener);
    listener.mockClear(); // 忽略首次同步回填

    m.open({ id: "a" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub(); // 最后一个订阅者离开 → store stop 回调 → 退订核心
    listener.mockClear();
    m.open({ id: "b" });
    m.remove("a");
    expect(listener).not.toHaveBeenCalled(); // 退订后不再收到推送
  });

  it("显式 om 优先：不触碰 context，纯逻辑/测试环境可用", () => {
    const m = make();
    // 组件外调用（无 svelte 组件实例）仍可用，因为显式传入 om 跳过 getContext。
    expect(() => get(overlayState(m))).not.toThrow();
    const o = overlay("k", undefined, m);
    o.open();
    expect(get(o.visible)).toBe(true);
  });

  it("context 限制：不传 om 且不在组件 init 期 → getContext 抛生命周期错误", () => {
    // setContext/getContext 依赖组件实例；node 纯逻辑环境下 getContext 抛错。
    // 这记录了「组件外必须显式传 om」的约束。
    expect(() => overlayState()).toThrow();
    expect(() => setLayerman(make())).toThrow();
    expect(() => getLayerman()).toThrow();
    expect(() => provideCurrentOverlay("x")).toThrow();
  });

  it("Readable 契约：store 为纯对象 { subscribe }，无需 DOM/编译器", () => {
    const m = make();
    const state: Readable<OverlayState> = overlayState(m);
    expect(typeof state.subscribe).toBe("function");
    // 契约：subscribe 返回退订函数，且立即同步回调一次。
    let calls = 0;
    const unsub = state.subscribe(() => calls++);
    expect(calls).toBe(1);
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
