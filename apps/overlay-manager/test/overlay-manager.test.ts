import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AsyncableStorage, createOverlayManager, type OverlayManager, type OverlayManagerOptions } from "../src/index.ts";

const managers: OverlayManager[] = [];

function make(opts: OverlayManagerOptions = {}): OverlayManager {
  const m = createOverlayManager({ crossTab: false, ...opts });
  managers.push(m);
  return m;
}

/** 内存存储 + 其后备 Map，用于跨"刷新"持久化断言。 */
function memStorage(): { storage: AsyncableStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      get: (k) => map.get(k) ?? null,
      set: (k, v) => {
        map.set(k, v);
      },
    },
  };
}

/** 当前活跃 id（排序，便于断言）。 */
function ids(m: OverlayManager): string[] {
  return m
    .getSnapshot()
    .active.map((o) => o.id)
    .sort();
}

/** 冲刷 microtask + 到期定时器。 */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
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

describe("@codejoo/overlaymanager", () => {
  it("串行：一次只显示一个，前一个 remove 后才显示下一个", async () => {
    const m = make();
    await m.ready();
    m.open({ id: "a" });
    m.open({ id: "b" });
    expect(ids(m)).toEqual(["a"]);
    expect(m.getSnapshot().queued).toEqual(["b"]);

    m.close("a"); // → closing，仍占用串行槽
    expect(ids(m)).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(300); // autoRemove 默认 300ms
    expect(ids(m)).toEqual(["b"]);
  });

  it("gap：下一个等待 gap 毫秒", async () => {
    const m = make({ gap: 1000 });
    m.open({ id: "a" });
    m.open({ id: "b" });
    m.remove("a");
    expect(ids(m)).toEqual([]);
    await vi.advanceTimersByTimeAsync(999);
    expect(ids(m)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ids(m)).toEqual(["b"]);
  });

  it("delay 覆盖全局 gap", async () => {
    const m = make({ gap: 5000 });
    m.open({ id: "a" });
    m.open({ id: "b", delay: 200 });
    m.remove("a");
    await vi.advanceTimersByTimeAsync(200);
    expect(ids(m)).toEqual(["b"]);
  });

  it("priority：高优先级先出队", () => {
    const m = make();
    m.open({ id: "a" });
    m.open({ id: "b" });
    m.open({ id: "c", priority: 10 });
    expect(ids(m)).toEqual(["a"]);
    m.remove("a");
    expect(ids(m)).toEqual(["c"]);
  });

  it("replace：替换当前，被替换者退回队列，新的立即显示", () => {
    const m = make();
    m.open({ id: "a" });
    m.open({ id: "b", replace: true });
    expect(ids(m)).toEqual(["b"]);
    expect(m.getSnapshot().queued).toEqual(["a"]);
    m.remove("b");
    expect(ids(m)).toEqual(["a"]);
  });

  it("affix：固定展示不被 replace 顶掉，replace 进队首等待", () => {
    const m = make();
    m.open({ id: "a", affix: true });
    m.open({ id: "b", replace: true });
    expect(ids(m)).toEqual(["a"]);
    expect(m.getSnapshot().queued).toEqual(["b"]);
    m.remove("a");
    expect(ids(m)).toEqual(["b"]);
  });

  it("affix：replace 项排在普通高优先级项之前（先判 replace 再比 priority）", () => {
    const m = make();
    m.open({ id: "a", affix: true });
    m.open({ id: "n", priority: 100 }); // 普通高优先
    m.open({ id: "r", replace: true, priority: 1 }); // replace 被 affix 拦 → jumped
    m.remove("a");
    expect(ids(m)).toEqual(["r"]); // jumped 压过普通高优先
  });

  it("replace + 条件不满足：不顶掉当前活跃者，自己排队等待", () => {
    const m = make();
    m.open({ id: "a" });
    m.open({ id: "b", replace: true, when: () => false }); // 不满足条件
    expect(ids(m)).toEqual(["a"]); // a 未被顶掉
    expect(m.getSnapshot().queued).toEqual(["b"]); // b 排队
  });

  it("overlap：叠加显示，绕过串行", () => {
    const m = make();
    m.open({ id: "a" });
    m.open({ id: "f", overlap: true });
    expect(ids(m)).toEqual(["a", "f"]);
  });

  it("overlap：不满足条件则丢弃，result 兑现 dismissed", async () => {
    const m = make();
    const h = m.open({ id: "f", overlap: true, requiresAuth: true }); // ctx.auth 未定义
    expect(ids(m)).toEqual([]);
    await expect(h.result).resolves.toEqual({ dismissed: true });
  });

  it("条件：route 匹配才显示；setContext 触发重评", () => {
    const m = make();
    m.setContext({ route: "/home" });
    m.open({ id: "a", route: "/other" });
    expect(ids(m)).toEqual([]);
    expect(m.getSnapshot().queued).toEqual(["a"]);
    m.setContext({ route: "/other" });
    expect(ids(m)).toEqual(["a"]);
  });

  it("条件：when 覆盖 route/requiresAuth", () => {
    const m = make();
    m.setContext({ route: "/x", auth: false });
    m.open({ id: "a", route: "/y", requiresAuth: true, when: () => true });
    expect(ids(m)).toEqual(["a"]);
  });

  it("条件：route 支持数组与 RegExp", () => {
    const m = make();
    m.setContext({ route: "/user/42" });
    m.open({ id: "arr", route: ["/a", "/b"] });
    m.open({ id: "re", route: /^\/user\/\d+$/ });
    expect(ids(m)).toEqual(["re"]);
  });

  it("冷却：session 一次会话只一次", () => {
    const m = make();
    m.open({ id: "a", cooldown: { session: 1 } });
    m.remove("a");
    m.open({ id: "a", cooldown: { session: 1 } });
    expect(ids(m)).toEqual([]);
    expect(m.getSnapshot().queued).toEqual(["a"]);
  });

  it("冷却：minGap 间隔内不显示，过后经触发可显示", () => {
    const m = make();
    m.open({ id: "a", cooldown: { minGap: { seconds: 10 } } });
    m.remove("a");
    m.open({ id: "a", cooldown: { minGap: { seconds: 10 } } });
    expect(ids(m)).toEqual([]);
    vi.advanceTimersByTime(10_000); // 推进时钟
    m.setContext({}); // 触发重评
    expect(ids(m)).toEqual(["a"]);
  });

  it("冷却：day 跨自然日重置", () => {
    vi.setSystemTime(new Date("2026-01-01T23:59:00"));
    const { storage } = memStorage();
    const m = make({ storage });
    m.open({ id: "a", cooldown: { day: 1 } });
    m.remove("a");
    m.open({ id: "a", cooldown: { day: 1 } }); // 同一天 → 拦
    expect(ids(m)).toEqual([]);
    vi.advanceTimersByTime(2 * 60_000); // 跨过午夜进入 01-02
    m.setContext({});
    expect(ids(m)).toEqual(["a"]);
  });

  it("冷却：total 跨刷新持久化", async () => {
    const { storage } = memStorage();
    const m1 = make({ storage });
    await m1.ready();
    m1.open({ id: "a", cooldown: { total: 1 } });
    m1.destroy();

    const m2 = make({ storage });
    await m2.ready();
    m2.open({ id: "a", cooldown: { total: 1 } }); // total 已耗尽
    expect(ids(m2)).toEqual([]);
  });

  it("两阶段关闭 + autoRemove 默认 300ms", async () => {
    const m = make();
    const onClose = vi.fn();
    const onRemove = vi.fn();
    m.open({ id: "a", onClose, onRemove });
    m.close("a");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(m.getSnapshot().active[0]?.phase).toBe("closing");
    await vi.advanceTimersByTimeAsync(299);
    expect(ids(m)).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ids(m)).toEqual([]);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("autoRemove:false → 需手动 remove", async () => {
    const m = make({ autoRemove: false });
    m.open({ id: "a" });
    m.close("a");
    await vi.advanceTimersByTimeAsync(5000);
    expect(ids(m)).toEqual(["a"]); // 仍 closing
    m.remove("a");
    expect(ids(m)).toEqual([]);
  });

  it("duration：显示 N ms 后自动 close", async () => {
    const m = make({ autoRemove: false });
    const onClose = vi.fn();
    m.open({ id: "a", duration: 1000, onClose });
    await vi.advanceTimersByTimeAsync(999);
    expect(onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pause/resume：冻结 duration 计时", async () => {
    const m = make({ autoRemove: false });
    m.open({ id: "a", duration: 1000 });
    await vi.advanceTimersByTimeAsync(500);
    m.pause("a");
    await vi.advanceTimersByTimeAsync(2000); // 暂停期间不推进 duration
    expect(m.getSnapshot().active[0]?.phase).toBe("open");
    m.resume("a");
    await vi.advanceTimersByTimeAsync(499);
    expect(m.getSnapshot().active[0]?.phase).toBe("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(m.getSnapshot().active[0]?.phase).toBe("closing");
  });

  it("pauseAll：全冻结（串行 + overlap 均不显示），resumeAll 放行", () => {
    const m = make();
    m.pauseAll();
    m.open({ id: "s" }); // 普通串行
    m.open({ id: "o", overlap: true }); // overlap 也被冻结,不立即显示
    expect(ids(m)).toEqual([]);
    m.resumeAll();
    expect(ids(m)).toEqual(["o", "s"]);
  });

  it("resolve：返回 data 才显示，data 注入实例", async () => {
    const m = make();
    m.open({ id: "a", resolve: async () => ({ x: 1 }) });
    await flush();
    expect(ids(m)).toEqual(["a"]);
    expect(m.get("a")?.data).toEqual({ x: 1 });
  });

  it("resolve：返回 null 跳过，下一个显示", async () => {
    const m = make();
    m.open({ id: "a", resolve: async () => null });
    m.open({ id: "b" });
    await flush();
    expect(ids(m)).toEqual(["b"]);
  });

  it("resolve：resolving 期间不被更高优先级插队打断", async () => {
    const m = make();
    m.open({ id: "a", resolve: async () => ({}) });
    m.open({ id: "b", priority: 100 }); // 更高优先，但 a 已提交 resolving
    await flush();
    expect(ids(m)).toEqual(["a"]);
    expect(m.getSnapshot().queued).toEqual(["b"]);
  });

  it("slot：不同 slot 各自独立串行", () => {
    const m = make();
    m.open({ id: "a", slot: "top" });
    m.open({ id: "b", slot: "mid" });
    expect(ids(m)).toEqual(["a", "b"]); // 两 slot 各显示一个
    m.open({ id: "a2", slot: "top" });
    expect(ids(m)).toEqual(["a", "b"]); // a2 在 top 队列等待
    expect(m.getSnapshot().queued).toEqual(["a2"]);
  });

  it("promise result：resolve(id, value) 投递给 await 方", async () => {
    const m = make();
    const h = m.open<unknown, boolean>({ id: "a" });
    m.resolve("a", true);
    await expect(h.result).resolves.toBe(true);
  });

  it("被动关闭 → result 兑现 dismissed", async () => {
    const m = make();
    const h = m.open({ id: "a" });
    m.remove("a");
    await expect(h.result).resolves.toEqual({ dismissed: true });
  });

  it("重复 id：正在展示 → 直接 replace，旧的丢弃不回队列", async () => {
    const m = make();
    const h1 = m.open({ id: "a", data: 1 });
    const key1 = m.get("a")?.instanceKey;
    const h2 = m.open({ id: "a", data: 2 });
    expect(ids(m)).toEqual(["a"]);
    expect(m.get("a")?.data).toBe(2);
    expect(m.get("a")?.instanceKey).not.toBe(key1);
    expect(m.getSnapshot().queued).toEqual([]); // 未回队列
    await expect(h1.result).resolves.toEqual({ dismissed: true });
    // h2 仍活跃、未兑现
    m.resolve("a", "ok");
    await expect(h2.result).resolves.toBe("ok");
  });

  it("重复 id：在队列中 → 覆盖旧配置", async () => {
    const m = make();
    m.open({ id: "block" }); // 占住串行槽
    const h1 = m.open({ id: "a", priority: 1, data: 1 });
    m.open({ id: "a", priority: 5, data: 2 }); // 覆盖队列里的 a
    await expect(h1.result).resolves.toEqual({ dismissed: true });
    m.remove("block");
    expect(ids(m)).toEqual(["a"]);
    expect(m.get("a")?.data).toBe(2);
  });

  it("subscribe：immediate 立即回调 + 变化通知", () => {
    const m = make();
    const cb = vi.fn();
    m.subscribe(cb, { immediate: true });
    expect(cb).toHaveBeenCalledTimes(1);
    m.open({ id: "a" });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].active[0].id).toBe("a");
  });

  it("clear：清空队列；closeActive 连活跃一起关", () => {
    const m = make();
    m.open({ id: "a" });
    m.open({ id: "b" });
    m.clear();
    expect(ids(m)).toEqual(["a"]); // 活跃不动
    expect(m.getSnapshot().queued).toEqual([]);
    m.clear({ closeActive: true });
    expect(ids(m)).toEqual([]);
  });

  it("getServerSnapshot 恒为空态；getSnapshot 引用稳定", () => {
    const m = make();
    expect(m.getServerSnapshot().active).toEqual([]);
    const s1 = m.getSnapshot();
    const s2 = m.getSnapshot();
    expect(s1).toBe(s2); // 未变化 → 同引用
    m.open({ id: "a" });
    expect(m.getSnapshot()).not.toBe(s1); // 变化 → 换引用
  });

  it("日志：debug 开启时按格式输出", () => {
    const logger = vi.fn();
    const m = make({ debug: true, logger });
    m.open({ id: "a" });
    m.close("a");
    expect(logger).toHaveBeenCalledWith("[overlays-manager]:a:pending");
    expect(logger).toHaveBeenCalledWith("[overlays-manager]:a:open");
    expect(logger).toHaveBeenCalledWith("[overlays-manager]:a:closing");
  });

  it("beforeClose 关闭守卫：返回 false 取消关闭；其余放行", async () => {
    const m = make({ autoRemove: false });
    let allow = false;
    m.open({ id: "a", beforeClose: () => allow });
    m.close("a");
    await flush();
    expect(m.get("a")?.phase).toBe("open"); // 被守卫拦下
    allow = true;
    m.close("a");
    await flush();
    expect(m.get("a")?.phase).toBe("closing"); // 放行
  });

  it("beforeClose 支持异步", async () => {
    const m = make({ autoRemove: false });
    m.open({ id: "a", beforeClose: async () => false });
    m.close("a");
    await flush();
    expect(m.get("a")?.phase).toBe("open");
  });

  it("update(id, patch)：就地浅合并 data，不动队列", () => {
    const m = make();
    m.open({ id: "a", data: { n: 1, keep: "x" } });
    m.open({ id: "b" }); // 队列
    m.update("a", { n: 2 });
    expect(m.get("a")?.data).toEqual({ n: 2, keep: "x" });
    expect(m.getSnapshot().queued).toEqual(["b"]); // 队列未变
  });

  it("clear 选择器：返回 id 数组精确清理", () => {
    const m = make();
    m.open({ id: "keep-1" });
    m.open({ id: "drop-1" }); // 队列
    m.open({ id: "drop-2" }); // 队列
    m.clear((_ctx, recs) => recs.filter((r) => r.id.startsWith("drop")).map((r) => r.id));
    expect(ids(m)).toEqual(["keep-1"]);
    expect(m.getSnapshot().queued).toEqual([]);
  });

  it("clear 选择器：返回非数组 → 全部清理（含活跃）", () => {
    const m = make();
    m.open({ id: "a" });
    m.open({ id: "b" });
    m.clear(() => undefined);
    expect(ids(m)).toEqual([]);
    expect(m.getSnapshot().queued).toEqual([]);
  });

  it("stackIndex / isTopmost：叠加层序", () => {
    const m = make();
    m.open({ id: "base" });
    m.open({ id: "ov1", overlap: true });
    m.open({ id: "ov2", overlap: true });
    const a = m.getSnapshot().active;
    expect(a.map((o) => o.stackIndex)).toEqual([0, 1, 2]);
    expect(a.map((o) => o.isTopmost)).toEqual([false, false, true]);
    expect(a[a.length - 1].id).toBe("ov2");
  });

  it("dismissWhenUnmet：条件不再满足时自动撤下并推进（默认 true）", () => {
    const m = make();
    m.setContext({ route: "/home" });
    m.open({ id: "a", route: "/home" });
    m.open({ id: "b" }); // 无条件，排队
    expect(ids(m)).toEqual(["a"]);
    m.setContext({ route: "/other" }); // a 条件不再满足
    expect(ids(m)).toEqual(["b"]); // a 自动撤下，b 顶上
  });

  it("dismissWhenUnmet:false：条件不满足也保留", () => {
    const m = make();
    m.setContext({ route: "/home" });
    m.open({ id: "a", route: "/home", dismissWhenUnmet: false });
    m.setContext({ route: "/other" });
    expect(ids(m)).toEqual(["a"]); // 保留
  });
});
