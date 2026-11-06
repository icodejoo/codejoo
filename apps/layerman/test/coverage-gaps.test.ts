import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayerman, type Layerman, type LayermanOptions } from "../src/index.ts";
import { defaultStorage } from "../src/cooldown.ts";

/** 本文件拥有的管理器。 */
const managers: Layerman[] = [];
/** 创建独立管理器并登记清理。 */
function make(options: LayermanOptions = {}): Layerman {
  const manager = createLayerman({ crossTab: false, ...options });
  managers.push(manager);
  return manager;
}
/** 只暴露诊断反向测试所需的内部状态。 */
type Diagnostics = {
  /** 检查稳定状态的不变量。 */
  checkInvariants(): void;
  /** 等待队列，仅注入条目编号即可先触发销毁诊断。 */
  queues: Map<string, { id: string }[]>;
  /** 开场计时器。 */
  openTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** 对外快照。 */
  snap: ReturnType<Layerman["getSnapshot"]>;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.destroy());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("剩余覆盖场景", () => {
  it("默认存储把冷却记录写入宿主 localStorage", async () => {
    const disk = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => disk.set(key, value),
    });
    const m = make();
    await m.ready();
    m.open({ id: "persisted", cooldown: { total: 2 } });
    expect(JSON.parse(disk.get("layerman:v1")!).persisted.total).toBe(1);
    expect(defaultStorage()?.get("layerman:v1")).toBe(disk.get("layerman:v1"));
  });

  it("广播忽略损坏消息和销毁前已排入任务队列的消息", () => {
    const channel = { onmessage: null as null | ((event: MessageEvent) => void), close: vi.fn(), postMessage: vi.fn() };
    /** 模拟浏览器消息任务已出队后销毁频道的时序。 */
    function Channel() {
      return channel;
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    const m = make({ crossTab: true });
    const deliver = channel.onmessage!;
    const snapshot = m.getSnapshot();
    for (const data of [null, {}, { id: 1, rec: {} }, { id: "x" }]) deliver({ data } as MessageEvent);
    expect(m.getSnapshot()).toBe(snapshot);
    const cooldown = (m as unknown as { cooldown: { persisted: Map<string, unknown> } }).cooldown;
    const rec = { total: 1, dayBucket: "2026-01-01", dayCount: 1, hourBucket: "2026-01-01T00", hourCount: 1, minuteBucket: "2026-01-01T00:00", minuteCount: 1, lastShownAt: 1 };
    deliver({ data: { id: "before", rec } } as MessageEvent);
    expect(cooldown.persisted.get("before")).toEqual(rec);
    const records = [...cooldown.persisted];
    m.destroy();
    deliver({ data: { id: "before", rec: { ...rec, total: 2 } } } as MessageEvent);
    deliver({ data: { id: "after", rec } } as MessageEvent);
    expect([...cooldown.persisted]).toEqual(records);
    expect(channel.close).toHaveBeenCalledOnce();
    expect(m.getSnapshot().active).toEqual([]);
    expect(m.getSnapshot().queued).toEqual([]);
  });

  it("先通知的订阅者取消后续订阅时不再调用已退订者", () => {
    const m = make();
    const later = vi.fn();
    let unsubscribe = () => {};
    const first = vi.fn(() => unsubscribe());
    m.subscribe(first);
    unsubscribe = m.subscribe(later);
    m.open({ id: "first" });
    expect(first).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
  });

  it("已经移除的实例收到旧展示计时任务时不关闭同编号新实例", () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const m = make();
    m.open({ id: "reused", duration: 100 });
    const deliver = timers.mock.calls[0]![0] as () => void;
    m.remove("reused");
    m.open({ id: "reused" });
    const snapshot = m.getSnapshot();
    deliver();
    expect(m.getSnapshot()).toBe(snapshot);
    expect(m.get("reused")?.phase).toBe("open");
  });

  it.each(["queue", "timer"] as const)("销毁诊断能用残留%s定位编号", (kind) => {
    const m = make();
    m.destroy();
    const internal = m as unknown as Diagnostics;
    if (kind === "queue") internal.queues.set("slot", [{ id: "residual" }]);
    else
      internal.openTimers.set(
        "residual",
        setTimeout(() => {}, 100),
      );
    expect(() => internal.checkInvariants()).toThrow("invariant h: id=residual");
    internal.queues.clear();
    internal.openTimers.clear();
  });

  it("快照出现没有内部条目的幽灵实例时诊断能定位快照编号", () => {
    const m = make();
    const internal = m as unknown as Diagnostics;
    const snapshot = internal.snap;
    internal.snap = { active: [{ id: "ghost", instanceKey: 1, phase: "open", slot: "", priority: 0, overlapping: false, stackIndex: 0, isTopmost: true, data: undefined }], queued: [] };
    expect(() => internal.checkInvariants()).toThrow("invariant g: id=ghost");
    internal.snap = snapshot;
  });
});
