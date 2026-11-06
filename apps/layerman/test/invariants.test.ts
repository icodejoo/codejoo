import { createManager } from "./helpers.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Layerman } from "../src/index.ts";

/** 供反向测试使用的可损坏条目视图。 */
type TestEntry = Record<string, unknown> & {
  /** 可供反向破坏的条目计时状态。 */
  timers: Record<string, unknown>;
  /** 可供反向破坏的请求状态。 */
  resolveState: Record<string, unknown>;
  /** 可供反向破坏的关闭守卫状态。 */
  close: Record<string, unknown>;
};
/** 只暴露检查器和反向测试需要的内部容器。 */
type Internals = {
  /** 只读不变量检查入口。 */
  checkInvariants(): void;
  /** 按标识索引的条目。 */
  byId: Map<string, TestEntry>;
  /** 等待队列。 */
  queues: Map<string, TestEntry[]>;
  /** 串行槽。 */
  serial: Map<string, TestEntry>;
  /** 已展示叠加条目。 */
  overlapping: TestEntry[];
  /** 冻结的叠加条目。 */
  pendingOverlaps: TestEntry[];
  /** 开场计时器。 */
  openTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** 全局冻结标记。 */
  paused: boolean;
  /** 已完成释放的标记。 */
  destroyed?: boolean;
  /** 活跃快照。 */
  snap: { active: { id: string; instanceKey: number }[]; queued: string[] };
};
const ID = "invariant-entry";
const SLOT = "invariant-slot";
const managers: Layerman[] = [];

/** 创建隔离存储的管理器。 */
function make(): Layerman {
  return createManager(managers, { crossTab: false, storage: { get: () => null, set: () => {} } });
}
/** 获取仅供测试的内部视图。 */
function internal(m: Layerman): Internals {
  return m as unknown as Internals;
}
/** 断言操作后的状态满足全部不变量。 */
function check(m: Layerman): void {
  expect(() => internal(m).checkInvariants()).not.toThrow();
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const m of managers) m.destroy();
  managers.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("内部不变量", () => {
  it("队列、固定、替换、叠加、关闭和销毁后保持一致", async () => {
    const m = make();
    await m.ready();
    check(m);
    for (const config of [
      { id: ID, affix: true, duration: 100 },
      { id: "queued", replace: true },
      { id: "overlap", overlap: true },
      { id: "other", slot: SLOT, delay: 20 },
    ]) {
      m.open(config);
      check(m);
    }
    m.pause(ID);
    check(m);
    m.resume(ID);
    check(m);
    m.pauseAll();
    check(m);
    m.open({ id: "frozen", overlap: true });
    check(m);
    m.resumeAll();
    check(m);
    m.close(ID);
    check(m);
    m.remove(ID);
    check(m);
    m.open({ id: "replacement", replace: true });
    check(m);
    m.update("replacement", { value: 1 });
    check(m);
    m.setContext({ auth: true });
    check(m);
    await vi.advanceTimersByTimeAsync(25);
    check(m);
    m.clear((_, records) => records.filter((r) => r.slot === SLOT).map((r) => r.id));
    check(m);
    m.clear();
    check(m);
    m.clear({ closeActive: true });
    check(m);
    m.destroy();
    check(m);
    expect(internal(m).destroyed).toBe(true);
    expect(internal(m).byId.size).toBe(0);
    expect(internal(m).openTimers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("检查时不调用谓词或钩子、不修改快照与条目", () => {
    const m = make();
    const when = vi.fn(() => true);
    const hook = vi.fn();
    m.open({ id: ID, when, onShow: hook });
    when.mockClear();
    hook.mockClear();
    const snapshot = m.getSnapshot();
    const entry = { ...internal(m).byId.get(ID) };
    check(m);
    check(m);
    expect(when).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(m.getSnapshot()).toBe(snapshot);
    expect(internal(m).byId.get(ID)).toEqual(entry);
  });

  it("请求占槽、暂停缓存、空结果及拒绝均保持一致", async () => {
    const m = make();
    m.open({ id: ID, resolve: async () => null });
    check(m);
    m.pauseAll();
    check(m);
    await vi.advanceTimersByTimeAsync(0);
    check(m);
    m.resumeAll();
    check(m);
    m.open({
      id: ID,
      resolve: async () => {
        throw new Error("请求失败");
      },
    });
    check(m);
    await vi.advanceTimersByTimeAsync(0);
    check(m);
  });

  it("单条与全局暂停冻结关闭后的自动移除", async () => {
    const m = make();
    m.open({ id: ID, duration: 10 });
    check(m);
    m.close(ID);
    check(m);
    m.pause(ID);
    check(m);
    m.pauseAll();
    check(m);
    m.resume(ID);
    check(m);
    m.resumeAll();
    check(m);
    await vi.advanceTimersByTimeAsync(300);
    check(m);
  });

  it.each<[string, (s: Internals, e: TestEntry) => void]>([
    [
      "a",
      (s) => {
        s.serial.delete(SLOT);
      },
    ],
    [
      "a",
      (s, e) => {
        s.byId.set("wrong-id", e);
      },
    ],
    [
      "a",
      (s, e) => {
        s.overlapping.push(e);
        Object.assign(e, { overlapping: true });
      },
    ],
    [
      "b",
      (s) => {
        s.byId.delete(ID);
      },
    ],
    [
      "c",
      (_, e) => {
        e.phase = "pending";
      },
    ],
    [
      "c",
      (s, e) => {
        s.serial.clear();
        s.queues.set(SLOT, [e]);
      },
    ],
    [
      "c",
      (s, e) => {
        s.serial.clear();
        s.pendingOverlaps.push(e);
      },
    ],
    [
      "c",
      (s, e) => {
        s.serial.clear();
        s.overlapping.push(e);
      },
    ],
    [
      "d",
      (_, e) => {
        e.slot = "wrong-slot";
      },
    ],
    [
      "e",
      (_, e) => {
        Object.assign(e.timers, { durationTimer: 1, paused: true });
      },
    ],
    [
      "e",
      (_, e) => {
        e.timers.durationTimer = 1;
        e.phase = "closing";
      },
    ],
    [
      "e",
      (_, e) => {
        e.timers.autoRemoveTimer = 1;
      },
    ],
    [
      "e",
      (_, e) => {
        Object.assign(e.timers, { autoRemoveTimer: 1, paused: true });
        e.phase = "closing";
      },
    ],
    [
      "e",
      (_, e) => {
        e.timers.durationRemaining = 0;
      },
    ],
    [
      "e",
      (_, e) => {
        e.timers.autoRemoveRemaining = 0;
      },
    ],
    [
      "e",
      (_, e) => {
        e.resolveState.abort = new AbortController();
      },
    ],
    [
      "e",
      (_, e) => {
        e.close.pending = true;
        e.phase = "closing";
      },
    ],
    [
      "e",
      (_, e) => {
        e.resolveState.hasPendingResolve = true;
      },
    ],
    [
      "f",
      (s) => {
        s.openTimers.set(
          SLOT,
          setTimeout(() => {}, 100),
        );
      },
    ],
    [
      "g",
      (s) => {
        s.snap = { active: [], queued: [] };
      },
    ],
    [
      "g",
      (s) => {
        s.snap.active[0]!.instanceKey++;
      },
    ],
    [
      "h",
      (s) => {
        s.destroyed = true;
      },
    ],
  ])("损坏内部状态时报告编号 %s 与条目标识", (code, corrupt) => {
    const m = make();
    m.open({ id: ID, slot: SLOT });
    const s = internal(m);
    const e = s.byId.get(ID)!;
    // 避免坏状态污染 afterEach 的释放逻辑。
    managers.pop();
    corrupt(s, e);
    const reportedId = s.byId.has("wrong-id") ? "wrong-id" : code === "f" ? SLOT : ID;
    expect(() => s.checkInvariants()).toThrow(`[layerman] invariant ${code}: id=${reportedId}`);
  });

  it("[B-F1][阶段1] 请求成功展示后不保留 resolving 专属的 abort", async () => {
    const m = make();
    m.open({ id: ID, resolve: async () => ({ value: 1 }) });
    await vi.advanceTimersByTimeAsync(0);
    check(m);
  });

  it("[N1][阶段1] 移除冻结叠加条目后所有容器均解除引用", () => {
    const m = make();
    m.pauseAll();
    m.open({ id: ID, overlap: true });
    m.remove(ID);
    check(m);
  });

  it("[B-F2][阶段1] 清空延迟队列后不残留开场计时器", () => {
    const m = make();
    m.open({ id: ID, slot: SLOT, delay: 100 });
    check(m);
    m.clear();
    check(m);
  });

  it("[B-F2][阶段1] 待开场条目换槽重开后清理旧槽计时器", () => {
    const m = make();
    m.open({ id: ID, slot: SLOT, delay: 100 });
    check(m);
    m.open({ id: ID, slot: "new-slot", delay: 100 });
    check(m);
  });

  it("同槽替换开场后不残留此前队列的开场计时器", () => {
    const m = make();
    m.open({ id: ID, slot: SLOT, delay: 100 });
    m.open({ id: "immediate", slot: SLOT, replace: true });
    check(m);
  });

  it("[B-F3][阶段1] 暂停中以冻结叠加条目接替活跃实例后刷新快照", () => {
    const m = make();
    m.open({ id: ID });
    check(m);
    m.pauseAll();
    m.open({ id: ID, overlap: true });
    check(m);
  });

  it("[B-F3][阶段1] 活跃实例重开进入异步请求时移除旧展示快照", () => {
    const m = make();
    m.open({ id: ID });
    check(m);
    m.open({ id: ID, resolve: () => new Promise(() => {}) });
    check(m);
  });
});

it("永久耗尽条目不得残留等待队列，反向破坏报告 i", () => {
  const m = make();
  m.pauseAll();
  m.open({ id: ID });
  const s = internal(m);
  s.byId.get(ID)!.cfg = { cooldown: { session: 0 } };
  expect(() => s.checkInvariants()).toThrow(`invariant i: id=${ID}`);
});

it("未暂停且不等待 hydrate 的叠加候选属于非法持有，报告 j", () => {
  const m = make();
  m.pauseAll();
  m.open({ id: ID, overlap: true });
  const s = internal(m);
  s.paused = false;
  expect(() => s.checkInvariants()).toThrow(`invariant j: id=${ID}`);
});

it("慢 hydrate 持有的串行与 overlap 属于合法等待状态", async () => {
  let finish!: (value: null) => void;
  const m = createManager(managers, {
    crossTab: false,
    storage: {
      get: () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        }),
      set: () => {},
    },
  });
  m.open({ id: ID, cooldown: { total: 1 } });
  m.open({ id: SLOT, overlap: true, cooldown: { minGap: { seconds: 1 } } });
  check(m);
  finish(null);
  await m.ready();
  check(m);
});
