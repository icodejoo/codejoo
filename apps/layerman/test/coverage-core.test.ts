import { createManager } from "./helpers.ts";
import { DismissReason } from "../src/index.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Layerman, type LayermanOptions, type Cooldown } from "../src/index.ts";

/** 重复使用的条目编号。 */
const FIRST_ID = "a";
/** 第二个条目编号。 */
const SECOND_ID = "b";
/** 不存在的条目编号。 */
const MISSING_ID = "missing";
/** 独立的调度槽。 */
const OTHER_SLOT = "other";
/** 固定本地时刻，避免自然时间桶受运行日期影响。 */
const START = new Date(2026, 0, 1, 12).getTime();
/** 本文件创建的管理器。 */
const managers: Layerman[] = [];
/** 创建隔离的测试管理器。 */
function make(options: LayermanOptions = {}): Layerman {
  return createManager(managers, { crossTab: false, autoRemove: false, ...options });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => {
  managers.splice(0).forEach((m) => m.destroy());
  vi.useRealTimers();
});

describe("核心覆盖缺口", () => {
  it("异步存储读取失败时仍可就绪并正常展示", async () => {
    const m = make({
      storage: { get: () => Promise.reject(new Error("读取失败")), set: () => {} },
    });
    await m.ready();
    m.open({ id: FIRST_ID });
    expect(m.get(FIRST_ID)).toBeDefined();
  });

  it("默认日志器输出生命周期且销毁会取消等待计时器", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const m = make({ debug: true, gap: 100 });
      const onShow = vi.fn();
      m.open({ id: FIRST_ID, onShow });
      expect(log).toHaveBeenCalledWith("[layerman]:a:pending");
      m.destroy();
      vi.advanceTimersByTime(100);
      expect(onShow).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("条件谓词异常仅阻止该项展示而不影响其他槽位", () => {
    const m = make();
    m.open({
      id: FIRST_ID,
      when: () => {
        throw new Error("条件失败");
      },
    });
    m.open({ id: SECOND_ID, slot: OTHER_SLOT });
    expect(m.getSnapshot().queued).toEqual([FIRST_ID]);
    expect(m.get(SECOND_ID)).toBeDefined();
  });

  it("恢复时跳过已移除的叠加候选并结束条件已失效的候选", async () => {
    const m = make();
    m.pauseAll();
    const onShow = vi.fn();
    const removed = m.open({ id: FIRST_ID, overlap: true, onShow });
    const unmet = m.open({ id: SECOND_ID, overlap: true, when: (ctx) => !ctx.auth, onShow });
    m.remove(FIRST_ID);
    m.setContext({ auth: true });
    m.resumeAll();
    await expect(removed.result).resolves.toEqual({ dismissed: true, reason: DismissReason.removed });
    await expect(unmet.result).resolves.toEqual({ dismissed: true, reason: DismissReason.unmet });
    expect(onShow).not.toHaveBeenCalled();
    expect(m.getSnapshot().active).toEqual([]);
  });

  it("展示回调中暂停会冻结尚未启动的持续时间", () => {
    const m = make();
    m.open({ id: FIRST_ID, duration: 100, onShow: () => m.pauseAll() });
    vi.advanceTimersByTime(200);
    expect(m.get(FIRST_ID)?.phase).toBe("open");
    m.resumeAll();
    vi.advanceTimersByTime(99);
    expect(m.get(FIRST_ID)?.phase).toBe("open");
    vi.advanceTimersByTime(1);
    expect(m.get(FIRST_ID)?.phase).toBe("closing");
  });

  it("拒绝结果保留错误身份且忽略后续投递和未知编号", async () => {
    const m = make();
    const h = m.open({ id: FIRST_ID });
    const error = new Error("拒绝");
    const rejected = expect(h.result).rejects.toBe(error);
    m.reject(h.id, error);
    m.reject(h.id, new Error("重复"));
    m.resolve(h.id, true);
    m.reject(MISSING_ID, error);
    await rejected;
    expect(m.get(h.id)?.phase).toBe("open");
  });

  it("状态仓库方法解构后可订阅读取和退订", () => {
    const m = make();
    // 契约：这些方法在构造器里已 bind，必须能以裸引用传给 useSyncExternalStore 等消费方
    // oxlint-disable-next-line typescript/unbound-method
    const { subscribe, getSnapshot, getServerSnapshot, get } = m;
    const listener = vi.fn();
    const off = subscribe(listener, { immediate: true });
    const server = getServerSnapshot();
    m.open({ id: FIRST_ID });
    expect(get(FIRST_ID)).toEqual(getSnapshot().active[0]);
    expect(getServerSnapshot()).toBe(server);
    expect(server.active).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    m.remove(FIRST_ID);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("注入时钟决定延迟资格而非真实系统时间", () => {
    let now = START;
    const m = make({ now: () => now, gap: 100 });
    m.open({ id: FIRST_ID });
    vi.advanceTimersByTime(50);
    expect(m.get(FIRST_ID)).toBeUndefined();
    now += 100;
    m.setContext({});
    expect(m.get(FIRST_ID)?.phase).toBe("open");
  });

  it.each([
    ["小时", { hour: 1 }, 60 * 60 * 1000],
    ["分钟", { minute: 1 }, 60 * 1000],
  ] as const)("%s冷却过期不会自行唤醒，收到上下文触发才展示", (_label, cooldown, elapsed) => {
    const m = make();
    m.open({ id: FIRST_ID, cooldown });
    m.remove(FIRST_ID);
    m.open({ id: FIRST_ID, cooldown });
    expect(m.getSnapshot().queued).toEqual([FIRST_ID]);
    vi.advanceTimersByTime(elapsed);
    expect(m.get(FIRST_ID)).toBeUndefined();
    m.setContext({});
    expect(m.get(FIRST_ID)?.phase).toBe("open");
  });

  it.each([
    ["日额度仍阻止已经满足的最小间隔", { day: 1, minGap: { seconds: 1 } }, 1000, false],
    ["跨日后最小间隔仍未满足", { day: 1, minGap: { days: 2 } }, 86400000, false],
    ["日桶与最小间隔同时放行", { day: 1, minGap: { hours: 1, minutes: 1, seconds: 1 } }, 86400000, true],
  ] satisfies [string, Cooldown, number, boolean][])("组合冷却按且关系判断：%s", (_label, cooldown, elapsed, visible) => {
    const m = make();
    m.open({ id: FIRST_ID, cooldown });
    m.remove(FIRST_ID);
    vi.advanceTimersByTime(elapsed);
    m.open({ id: FIRST_ID, cooldown });
    expect(Boolean(m.get(FIRST_ID))).toBe(visible);
  });

  it("移除等待候选后按照新候选的较短延迟重新安排", () => {
    const m = make();
    m.open({ id: "slow", delay: 100, priority: 10 });
    m.open({ id: "fast", delay: 40 });
    vi.advanceTimersByTime(20);
    m.remove("slow");
    vi.advanceTimersByTime(19);
    expect(m.get("fast")).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(m.get("fast")?.phase).toBe("open");
    vi.advanceTimersByTime(100);
    expect(m.getSnapshot().active.map((o) => o.id)).toEqual(["fast"]);
  });

  it.each([null, { loaded: true }])("全局暂停期间异步数据落地必须等恢复才提交：%j", async (data) => {
    const m = make();
    let land!: (value: typeof data) => void;
    const h = m.open({
      id: FIRST_ID,
      resolve: () =>
        new Promise<typeof data>((resolve) => {
          land = resolve;
        }),
    });
    await Promise.resolve();
    m.pauseAll();
    land(data);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.getSnapshot().active).toEqual([]);
    m.resumeAll();
    if (data === null) await expect(h.result).resolves.toEqual({ dismissed: true, reason: DismissReason.empty });
    else expect(m.get(FIRST_ID)?.data).toEqual(data);
  });

  it.each(["duration", "autoRemove"] as const)("单项暂停与全局暂停叠加时%s只在两者解除后继续", (timer) => {
    const m = make();
    m.open({
      id: FIRST_ID,
      duration: timer === "duration" ? 100 : undefined,
      autoRemove: timer === "autoRemove" ? 100 : false,
    });
    if (timer === "autoRemove") m.close(FIRST_ID);
    vi.advanceTimersByTime(30);
    m.pause(FIRST_ID);
    m.pause(FIRST_ID);
    m.pauseAll();
    m.pauseAll();
    m.resume(FIRST_ID);
    vi.advanceTimersByTime(200);
    expect(m.get(FIRST_ID)?.phase).toBe(timer === "duration" ? "open" : "closing");
    m.pause(FIRST_ID);
    m.resumeAll();
    m.resumeAll();
    vi.advanceTimersByTime(200);
    expect(m.get(FIRST_ID)).toBeDefined();
    m.resume(FIRST_ID);
    m.resume(FIRST_ID);
    m.pause(MISSING_ID);
    m.resume(MISSING_ID);
    vi.advanceTimersByTime(69);
    expect(m.get(FIRST_ID)).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(m.get(FIRST_ID)?.phase).toBe(timer === "duration" ? "closing" : undefined);
  });

  it.each([false, true])("冷却不合格的替换不会顶掉当前项，固定状态为%s", (affix) => {
    const m = make();
    const cooldown = { session: 1 };
    m.open({ id: "replacement", cooldown });
    m.remove("replacement");
    const onClose = vi.fn();
    m.open({ id: "current", affix, onClose });
    m.open({ id: "replacement", replace: true, cooldown });
    expect(m.get("current")?.phase).toBe("open");
    expect(m.getSnapshot().queued).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("层序与最上层标记在叠加项移除后重新计算", () => {
    const m = make();
    m.open({ id: "base" });
    m.open({ id: "top", overlap: true });
    expect(m.getSnapshot().active.map(({ stackIndex, isTopmost }) => [stackIndex, isTopmost])).toEqual([
      [0, false],
      [1, true],
    ]);
    m.remove("top");
    expect(m.get("base")).toMatchObject({ stackIndex: 0, isTopmost: true });
  });

  it("清理队列保留活跃项，选择器收到上下文和数据并支持空返回", () => {
    const m = make();
    m.setContext({ auth: true });
    m.open({ id: "active", data: { keep: true } });
    m.open({ id: "queued" });
    m.clear();
    expect(m.getSnapshot().queued).toEqual([]);
    expect(m.get("active")).toBeDefined();
    m.clear((ctx, records) => {
      expect(ctx.auth).toBe(true);
      expect(records).toEqual([expect.objectContaining({ id: "active", active: true, data: { keep: true } })]);
      return [];
    });
    expect(m.get("active")).toBeDefined();
    m.clear(() => undefined);
    expect(m.getSnapshot().active).toEqual([]);
  });

  it("更新对象浅合并，原始值替换，排队配置在展示时生效", () => {
    const m = make();
    m.open({ id: FIRST_ID, data: { a: 1, b: 2 } });
    m.update(FIRST_ID, { b: 3 });
    expect(m.get(FIRST_ID)?.data).toEqual({ a: 1, b: 3 });
    m.update(FIRST_ID, null);
    expect(m.get(FIRST_ID)?.data).toBeNull();
    m.update(FIRST_ID, 42);
    expect(m.get(FIRST_ID)?.data).toBe(42);
    m.open({ id: SECOND_ID, data: "old" });
    m.update(SECOND_ID, "new");
    m.update(MISSING_ID, {});
    m.remove(FIRST_ID);
    expect(m.get(SECOND_ID)?.data).toBe("new");
  });

  it("排队同编号覆盖兑现旧结果且可迁移槽位", async () => {
    const m = make();
    m.open({ id: "blocker" });
    const old = m.open({ id: FIRST_ID, data: "old" });
    m.open({ id: FIRST_ID, slot: OTHER_SLOT, data: "new" });
    await expect(old.result).resolves.toEqual({ dismissed: true, reason: DismissReason.replaced });
    expect(m.get(FIRST_ID)).toMatchObject({ slot: OTHER_SLOT, data: "new" });
    expect(m.getSnapshot().queued).toEqual([]);
  });

  it("活跃同编号迁往已占用槽位时进入队列并释放旧槽", async () => {
    const m = make();
    const old = m.open({ id: FIRST_ID });
    m.open({ id: "next" });
    m.open({ id: "blocker", slot: OTHER_SLOT });
    m.open({ id: FIRST_ID, slot: OTHER_SLOT });
    await expect(old.result).resolves.toEqual({ dismissed: true, reason: DismissReason.replaced });
    expect(m.get("next")).toBeDefined();
    expect(m.getSnapshot().queued).toContain(FIRST_ID);
    m.remove("blocker");
    expect(m.get(FIRST_ID)?.slot).toBe(OTHER_SLOT);
  });
});
