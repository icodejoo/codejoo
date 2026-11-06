import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLayerman, type Layerman, type OverlayConfig } from "../src/index.ts";

const SEED_COUNT = 200;
const STEP_COUNT = 60;
const IDS = ["a", "b", "c", "d"] as const;
const SLOTS = ["left", "right"] as const;
// 重入随机源独立，不改变主操作序列。
const ENABLE_REENTRANT_SUITE = true;
const REENTRANT_SEED_COUNT = 200;
const OPS = ["open", "close", "remove", "clearObject", "clearSelector", "update", "setContext", "pause", "resume", "pauseAll", "resumeAll", "advance", "resolve", "reject", "destroy", "hydrate"] as const;
const BRANCHES = [
  "queue",
  "replace",
  "overlap",
  "affix",
  "backend",
  "duration",
  "cooldown",
  "guardTrue",
  "guardFalse",
  "guardAsyncTrue",
  "guardAsyncFalse",
  "backendValue",
  "backendNull",
  "backendReject",
  "condition",
  "clearActive",
  "clearWaiting",
  "selectorIds",
  "selectorAll",
  "afterDestroy",
  "guardCalled",
  "backendCalled",
  "slowHydrate",
  "failedHydrate",
  "capped",
  "unshownDelivery",
] as const;
const coverage = new Map<string, number>([...OPS, ...BRANCHES].map((key) => [key, 0]));
const managers: Layerman[] = [];
/** 内联可复现的无依赖伪随机数生成器。 */
function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
/** 累计已实际执行的操作或分支。 */
function cover(key: string): void {
  coverage.set(key, (coverage.get(key) ?? 0) + 1);
}
/** 测试中观测单个调用的展示、移除及底层兑现次数。 */
type Ticket = {
  /** open 调用的唯一编号。 */
  key: number;
  /** 实际展示次数。 */
  shown: number;
  /** 实际关闭通知次数。 */
  closed: number;
  /** 实际移除次数。 */
  removed: number;
  /** 底层兑现次数，区别于 Promise 自身去重后的回调次数。 */
  settled: number;
  /** 已观察到的成功或被动结束结果。 */
  result?: unknown;
  /** 是否观察到宿主拒绝。 */
  rejected?: boolean;
  /** 用于验证展示与离场配对的事件序列。 */
  events: string[];
};
/** 模型检查需要的内部条目字段。 */
type ObservedEntry = {
  /** 展示身份。 */
  instanceKey: number;
  /** 生命周期阶段。 */
  phase: string;
  /** 是否曾实际展示。 */
  enteredSeq: number;
  /** 是否已经兑现。 */
  settled: boolean;
  /** 成功兑现函数。 */
  settle: (this: void, value: unknown) => void;
  /** 错误兑现函数。 */
  fail: (this: void, error: unknown) => void;
};

/** 执行固定长度序列；错误附完整日志，可直接按种子重放。 */
async function runSeed(seed: number, reentrant = false): Promise<void> {
  const random = mulberry32(seed);
  const callbackRandom = mulberry32(seed ^ 0xa5a5a5a5);
  const subscriberRandom = mulberry32(seed ^ 0x13579bdf);
  const storage = new Map<string, string>();
  const slowHydrate = seed % 2 === 0;
  let finishRead!: (raw: string | null) => void;
  let failRead!: (error: Error) => void;
  const read = new Promise<string | null>((resolve, reject) => {
    finishRead = resolve;
    failRead = reject;
  });
  let hydrationDone = !slowHydrate;
  if (slowHydrate) cover("slowHydrate");
  const m = createLayerman({
    crossTab: false,
    gap: 3,
    storage: {
      get: (key) => (slowHydrate ? read : (storage.get(key) ?? null)),
      set: (key, value) => {
        storage.set(key, value);
      },
    },
  });
  managers.push(m);
  if (!slowHydrate) await m.ready();
  const state = m as unknown as {
    /** 不变量检查入口。 */
    checkInvariants(): void;
    /** 身份索引。 */
    byId: Map<string, ObservedEntry>;
    /** 全局冻结状态。 */
    paused: boolean;
  };
  const tickets: Ticket[] = [];
  const log: string[] = [];
  let destroyed = false;
  const received = [m.getSnapshot(), m.getSnapshot()];
  for (let i = 0; i < received.length; i++) {
    m.subscribe((snapshot) => {
      received[i] = snapshot;
      if (reentrant && i === 0) {
        const action = subscriberRandom();
        if (action < 0.3) m.setContext({});
        else if (action < 0.6) m.open({ id: "subscriber-ineligible", overlap: true, when: () => false });
      }
    });
  }
  /** 每个订阅者最终持有与管理器相同的快照引用。 */
  const checkSubscribers = (): void => {
    for (const snapshot of received) expect(snapshot).toBe(m.getSnapshot());
  };
  let reentering = false;
  /** 从独立随机源选择回调重入动作，限制递归深度。 */
  const reenter = (): void => {
    if (!reentrant || reentering || callbackRandom() > 0.3) return;
    reentering = true;
    const id = IDS[Math.floor(callbackRandom() * IDS.length)]!;
    const action = Math.floor(callbackRandom() * 4);
    log.push(`callback(${action},${id})`);
    try {
      if (action === 0) m.remove(id);
      else if (action === 1) m.setContext({ auth: true });
      else if (action === 2) m.clear({ closeActive: true });
      else void m.open({ id, overlap: true }).result.catch(() => {});
    } finally {
      reentering = false;
    }
  };
  try {
    for (let step = 0; step < STEP_COUNT; step++) {
      const id = IDS[Math.floor(random() * IDS.length)]!;
      const slot = SLOTS[Math.floor(random() * SLOTS.length)]!;
      // open 加权；销毁只在后半程以低概率发生。
      const draw = Math.floor(random() * (OPS.length + 7));
      const op = draw < 8 ? "open" : OPS[draw - 7]!;
      const pausedBefore = state.paused;
      const shownBefore = tickets.reduce((sum, ticket) => sum + ticket.shown, 0);
      log.push(`${step}: ${op}(${id},${slot})`);
      if (destroyed) {
        cover("afterDestroy");
        const snapshot = m.getSnapshot();
        m.get(id);
        m.getSnapshot();
        m.getServerSnapshot();
        expect(m.getSnapshot()).toBe(snapshot);
      } else if (op === "open") {
        cover(op);
        const mode = Math.floor(random() * 5);
        const backend = random() < 0.35 && mode !== 2;
        const duration = random() < 0.5;
        const cooldown = random() < 0.4;
        const capped = cooldown && random() < 0.3;
        if (capped) cover("capped");
        const guard = Math.floor(random() * 5);
        const outcome = Math.floor(random() * 3);
        const condition = random() < 0.3;
        const ticket: Ticket = { key: tickets.length, shown: 0, closed: 0, removed: 0, settled: 0, events: [] };
        tickets.push(ticket);
        const modeName = ["queue", "replace", "overlap", "affix", "queue"][mode]!;
        cover(modeName);
        if (backend) cover("backend");
        if (duration) cover("duration");
        if (cooldown) cover("cooldown");
        if (condition) cover("condition");
        log.push(`  open#${ticket.key} mode=${modeName} backend=${backend}:${outcome} duration=${duration} cooldown=${cooldown} guard=${guard} condition=${condition}`);
        const config: OverlayConfig = {
          id,
          slot,
          replace: mode === 1,
          overlap: mode === 2,
          affix: mode === 3,
          priority: Math.floor(random() * 3),
          duration: duration ? 7 : undefined,
          cooldown: capped ? (random() < 0.5 ? { session: 0 } : { total: 0 }) : cooldown ? { session: 3, total: 4, minGap: { seconds: 0.01 } } : undefined,
          when: condition
            ? (context) => {
                reenter();
                return !!context.auth;
              }
            : undefined,
          beforeClose: guard
            ? () => {
                cover("guardCalled");
                cover(BRANCHES[6 + guard]!);
                reenter();
                return guard > 2 ? Promise.resolve(guard === 3) : guard === 1;
              }
            : undefined,
          resolve: backend
            ? async () => {
                cover("backendCalled");
                reenter();
                cover(["backendValue", "backendNull", "backendReject"][outcome]!);
                if (outcome === 2) throw new Error("随机请求失败");
                return outcome === 1 ? null : { seed, step };
              }
            : undefined,
          onShow: () => {
            ticket.shown++;
            ticket.events.push("show");
            reenter();
          },
          onClose: () => {
            ticket.closed++;
            ticket.events.push("close");
            reenter();
          },
          onRemove: () => {
            ticket.removed++;
            ticket.events.push("remove");
            reenter();
          },
        };
        const handle = m.open(config);
        // 注册拒绝处理器，避免随机 reject 变成未处理拒绝。
        void handle.result.then(
          (value) => {
            ticket.result = value;
          },
          () => {
            ticket.rejected = true;
          },
        );
        const entry = state.byId.get(id);
        if (entry) {
          const settle = entry.settle;
          const fail = entry.fail;
          entry.settle = (value) => {
            ticket.settled++;
            settle(value);
          };
          entry.fail = (error) => {
            ticket.settled++;
            fail(error);
          };
        } else {
          // 不合格 overlap 在 open 返回前已同步移除并兑现。
          ticket.settled = 1;
        }
      } else if (op === "destroy" && (step < STEP_COUNT / 2 || random() > 0.15)) {
        log.push("  destroy 未抽中，改为读取快照");
        m.getSnapshot();
      } else {
        cover(op);
        switch (op) {
          case "close": {
            const entry = state.byId.get(id);
            const untouched = entry && entry.phase !== "open";
            const settled = entry?.settled;
            m.close(id);
            if (untouched) {
              expect(state.byId.get(id)).toBe(entry);
              expect(entry.settled).toBe(settled);
            }
            break;
          }
          case "remove":
            m.remove(id);
            break;
          case "clearObject": {
            const closeActive = random() < 0.5;
            cover(closeActive ? "clearActive" : "clearWaiting");
            log.push(`  closeActive=${closeActive}`);
            m.clear({ closeActive });
            break;
          }
          case "clearSelector": {
            const all = random() < 0.3;
            cover(all ? "selectorAll" : "selectorIds");
            log.push(`  selectorAll=${all}`);
            m.clear((_, records) => (all ? undefined : records.filter((r) => r.slot === slot).map((r) => r.id)));
            break;
          }
          case "update":
            m.update(id, { step });
            break;
          case "setContext": {
            const auth = random() < 0.5;
            log.push(`  auth=${auth}`);
            m.setContext({ auth });
            break;
          }
          case "pause":
            m.pause(id);
            break;
          case "resume":
            m.resume(id);
            break;
          case "pauseAll":
            m.pauseAll();
            break;
          case "resumeAll":
            m.resumeAll();
            break;
          case "advance": {
            const ms = Math.floor(random() * 20);
            log.push(`  ms=${ms}`);
            await vi.advanceTimersByTimeAsync(ms);
            break;
          }
          case "resolve":
          case "reject": {
            const entry = state.byId.get(id);
            const settled = entry?.settled;
            if (op === "resolve") m.resolve(id, step);
            else m.reject(id, new Error(`随机拒绝 ${step}`));
            if (entry && entry.enteredSeq === 0) {
              cover("unshownDelivery");
              expect(entry.settled).toBe(settled);
            }
            break;
          }
          case "hydrate":
            if (!hydrationDone) {
              hydrationDone = true;
              if (seed % 4 === 0) {
                cover("failedHydrate");
                failRead(new Error("慢读取失败"));
              } else
                finishRead(JSON.stringify({ a: { total: 4, dayBucket: "2026-01-01", dayCount: 4, hourBucket: "2026-01-01T00", hourCount: 4, minuteBucket: "2026-01-01T00:00", minuteCount: 4, lastShownAt: Date.now() } }));
              await m.ready();
            }
            break;
          case "destroy":
            m.destroy();
            destroyed = true;
            break;
        }
      }
      await vi.advanceTimersByTimeAsync(0);
      state.checkInvariants();
      checkSubscribers();
      for (const ticket of tickets) {
        if (ticket.shown === 0) {
          expect(ticket.rejected, `ticket#${ticket.key} 未展示却被拒绝`).not.toBe(true);
          if (ticket.result !== undefined) {
            expect(ticket.result).toMatchObject({ dismissed: true });
            expect(ticket.result).toHaveProperty("reason");
          }
        }
        expect(ticket.settled, `ticket#${ticket.key} 重复兑现`).toBeLessThanOrEqual(1);
        expect(ticket.removed, `ticket#${ticket.key} 重复移除`).toBeLessThanOrEqual(1);
        expect(ticket.closed, `ticket#${ticket.key} 关闭缺少展示`).toBeLessThanOrEqual(ticket.shown);
        let visible = false;
        let removed = false;
        for (const event of ticket.events) {
          expect(removed, `ticket#${ticket.key} 移除后仍有回调`).toBe(false);
          if (event === "show") {
            expect(visible, `ticket#${ticket.key} 重复展示`).toBe(false);
            visible = true;
          } else if (event === "close") {
            expect(visible, `ticket#${ticket.key} 关闭未展示条目`).toBe(true);
            visible = false;
          } else {
            visible = false;
            removed = true;
          }
        }
        if (destroyed) expect(ticket.settled, `ticket#${ticket.key} 销毁后未兑现`).toBe(1);
      }
      if (pausedBefore && state.paused) expect(tickets.reduce((sum, ticket) => sum + ticket.shown, 0)).toBe(shownBefore);
      for (const active of m.getSnapshot().active) {
        expect(state.byId.get(active.id)?.instanceKey).toBe(active.instanceKey);
        expect(state.byId.get(active.id)?.phase).toBe(active.phase);
      }
    }
    m.destroy();
    if (!hydrationDone) finishRead(null);
    await m.ready();
    await vi.advanceTimersByTimeAsync(0);
    state.checkInvariants();
    checkSubscribers();
    for (const ticket of tickets) expect(ticket.settled, `ticket#${ticket.key} 最终未兑现`).toBe(1);
  } catch (error) {
    throw new Error(`seed=${seed} REENTRANT=${reentrant}\n${log.join("\n")}\n${String(error)}`, { cause: error });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1));
});
afterEach(() => {
  for (const m of managers) m.destroy();
  managers.length = 0;
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("固定种子状态机随机序列", () => {
  for (let seed = 1; seed <= SEED_COUNT; seed++) {
    it(`种子 ${seed} 的六十步操作保持不变量`, async () => {
      await runSeed(seed);
    });
  }
  it("操作池与配置分支都实际执行过", () => {
    for (const [key, count] of coverage) expect(count, key).toBeGreaterThan(0);
  });
});

describe.skipIf(!ENABLE_REENTRANT_SUITE)("回调重入随机序列（阶段一开启）", () => {
  for (let seed = 1; seed <= REENTRANT_SEED_COUNT; seed++) {
    it(`[A1–A3][阶段1] 重入种子 ${seed} 保持不变量`, async () => {
      await runSeed(seed, true);
    });
  }
});
