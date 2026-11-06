/**
 * 终审缺陷回归集：按缺陷分组，修复后均以普通 it 验证预期行为。
 * B1（多 Tab 后写覆盖）与 B3（跨 Tab 最终一致）属文档/设计取舍，不设回归。
 * N2(D5)/N3/N5 已按阶段 5 的推荐语义落实；N6 的异步守卫契约是设计取舍，已文档化。
 */
import { createManager, deferred, memStorage } from "./helpers.ts";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Layerman, type LayermanOptions, type OverlayHandle, OverlayPhase, type OverlayState } from "../src/index.ts";

const A = "a";
const B = "b";
const BLOCK = "block";
const OVERLAP = "overlap";
const OTHER = "other";
const KEY = "layerman:v1";
const DISMISSED = { dismissed: true, reason: "removed" };
const CLEARED = { dismissed: true, reason: "cleared" };
const REPLACED = { dismissed: true, reason: "replaced" };
const DESTROYED = { dismissed: true, reason: "destroyed" };
const EMPTY = { dismissed: true, reason: "empty" };
const CAPPED = { dismissed: true, reason: "capped" };
const DURATION = 150;
const ELAPSED = 60;
const GUARD_DURATION = 10;
const SOURCE_URL = new URL("../src/index.ts", import.meta.url);
// 并发覆盖率运行会挤占子进程启动时间；有限预算仍能捕获通道保活。
const CHILD_EXIT_TIMEOUT_MS = 10_000;
const NOTIFY_ROUND_LIMIT = 100;
const REENTRY_TEST_GUARD = 150;
const NOTIFY_LIMIT_MESSAGE = `[layerman] 订阅者重入通知超过 ${NOTIFY_ROUND_LIMIT} 轮，已停止补发，请确认订阅者里的变更有收敛条件`;
const NODE_TYPE_ARGS = ["--experimental-strip-types", "--input-type=module", "-e"];
const PENDING = Symbol("尚未兑现");
const managers: Layerman[] = [];

/** 创建不使用真实广播、默认手动移除的管理器。 */
function make(options: LayermanOptions = {}): Layerman {
  return createManager(managers, { crossTab: false, autoRemove: false, storage: memStorage().storage, ...options });
}

/** 观察结果而不等待可能永久 pending 的 Promise。 */
function observe(promise: Promise<unknown>): () => unknown {
  let value: unknown = PENDING;
  void promise.then(
    (result) => {
      value = result;
      return result;
    },
    (error: unknown) => {
      value = error;
    },
  );
  return () => value;
}

/** 读取渲染顺序中的活跃 id。 */
function ids(m: Layerman): string[] {
  return m.getSnapshot().active.map((entry) => entry.id);
}

/** 冲刷微任务与当前时刻到期的假定时器。 */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** 构造完整有效的持久化记录。 */
function record(total: number) {
  return { total, dayBucket: "", dayCount: 0, hourBucket: "", hourCount: 0, minuteBucket: "", minuteCount: 0, lastShownAt: 0 };
}

/** 从隔离磁盘解析 JSON，以便验证存储契约。 */
function disk(map: Map<string, string>): Record<string, ReturnType<typeof record>> {
  return JSON.parse(map.get(KEY) ?? "{}") as Record<string, ReturnType<typeof record>>;
}

/** 仅在需要模拟广播时暴露内部冷却入口，与现有核心测试保持一致。 */
function mergeRemote(m: Layerman, id: string, value: unknown): void {
  (m as unknown as { cooldown: { mergeRemote(id: string, value: unknown): void } }).cooldown.mergeRemote(id, value);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
});

afterEach(() => {
  for (const m of managers) m.destroy();
  managers.length = 0;
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("[A1][阶段1] 谓词移除候选", () => {
  it("[A1][阶段1] when 移除自身后不留下失管的槽占用者", () => {
    const m = make();
    let first = true;
    m.open({
      id: A,
      when: () => {
        if (first) {
          first = false;
          m.remove(A);
        }
        return true;
      },
    });
    // D1：remove 在修改状态前被拒绝，候选保留在队列。
    expect(ids(m)).toEqual([]);
    expect(m.getSnapshot().queued).toEqual([A]);
    m.remove(A);
    m.open({ id: B });
    expect(ids(m)).toEqual([B]);
  });
});

describe("[A1b][阶段1] 谓词重入上下文", () => {
  it("[A1b][阶段1] when 调用 setContext 不会重复展示和扣减冷却", () => {
    const m = make();
    let first = true;
    const shown = vi.fn();
    m.open({
      id: A,
      cooldown: { session: 2 },
      when: () => {
        if (first) {
          first = false;
          m.setContext({ go: true });
        }
        return true;
      },
      onShow: shown,
    });
    // D1：谓词内变更抛错并被门控捕获，条件不满足且上下文保持原样。
    expect(shown).not.toHaveBeenCalled();
    expect(ids(m)).toEqual([]);
    expect(m.getSnapshot().queued).toEqual([A]);
    m.remove(A);
    m.open({ id: A, cooldown: { session: 2 } });
    expect(ids(m)).toEqual([A]);
  });
});

describe("[A2][阶段1] 同 id 重开钩子重入", () => {
  it("[A2][阶段1] onClose 重开产生的每个句柄都在 destroy 后兑现", async () => {
    const m = make();
    let inner: OverlayHandle | undefined;
    m.open({
      id: A,
      onClose: () => {
        inner ??= m.open({ id: A });
      },
    });
    const outer = m.open({ id: A });
    expect(inner).toBeDefined();
    const innerResult = observe(inner!.result);
    const outerResult = observe(outer.result);
    m.remove(A);
    m.destroy();
    await flush();
    expect([innerResult(), outerResult()]).toEqual([DISMISSED, REPLACED]);
  });
});

describe("[A3][阶段1] 清队列期间重入", () => {
  it("[A3][阶段1] onRemove 重调度不使 clear 漏掉后续条目", async () => {
    const m = make();
    m.open({ id: BLOCK });
    const first = observe(m.open({ id: A, onRemove: () => m.remove(BLOCK) }).result);
    const second = observe(m.open({ id: B }).result);
    m.clear();
    await flush();
    expect([first(), second(), ids(m)]).toEqual([CLEARED, CLEARED, []]);
  });
});

describe("[A4][阶段1] 选择器清理必须原子摘除", () => {
  it("[A4][阶段1] 清理待删项时不短暂展示或消耗其冷却", () => {
    const m = make();
    const shown = vi.fn();
    m.open({ id: A });
    m.open({ id: B, cooldown: { session: 1 }, onShow: shown });
    m.clear(() => undefined);
    expect(shown).not.toHaveBeenCalled();
    m.open({ id: B, cooldown: { session: 1 } });
    expect(ids(m)).toEqual([B]);
  });
});

describe("[A5][阶段1] 展示钩子替换与旧计时器", () => {
  it("[A5][阶段1] onShow 顶回队列后重新展示享有完整 duration", async () => {
    const m = make();
    let replaced = false;
    m.open({
      id: A,
      duration: DURATION,
      onShow: () => {
        if (!replaced) {
          replaced = true;
          m.open({ id: B, replace: true });
        }
      },
    });
    await vi.advanceTimersByTimeAsync(ELAPSED);
    m.remove(B);
    await vi.advanceTimersByTimeAsync(DURATION - ELAPSED);
    expect(m.get(A)?.phase).toBe(OverlayPhase.open);
    await vi.advanceTimersByTimeAsync(ELAPSED);
    expect(m.get(A)?.phase).toBe(OverlayPhase.closing);
  });
});

describe("[A6][阶段1] 关闭守卫代次", () => {
  it("[A6][阶段1] 旧 beforeClose 决议不能关闭重新展示的实例", async () => {
    const m = make();
    const guard = deferred<boolean>();
    m.open({ id: A, beforeClose: () => guard.promise });
    m.close(A);
    m.open({ id: B, replace: true });
    m.remove(B);
    guard.resolve(true);
    await flush();
    expect(m.get(A)?.phase).toBe(OverlayPhase.open);
  });
});

describe("[A7][阶段1] 暂停缓存的 resolve 代次", () => {
  it("[A7][阶段1] 重入替换后丢弃旧缓存并接收新请求数据", async () => {
    const m = make();
    const oldRequest = deferred<{ version: number }>();
    const newRequest = deferred<{ version: number }>();
    const request = vi.fn().mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    m.open({ id: A, resolve: request });
    await flush();
    m.pauseAll();
    oldRequest.resolve({ version: 1 });
    await flush();
    m.open({
      id: OVERLAP,
      overlap: true,
      onShow: () => {
        m.open({ id: B, replace: true });
        m.remove(B);
      },
    });
    m.resumeAll();
    newRequest.resolve({ version: 2 });
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(m.get(A)?.data).toEqual({ version: 2 });
  });
});

describe("[A8][阶段1] 恢复期间重新暂停", () => {
  it("[A8][阶段1] 首个 overlap 的 onShow 暂停后保留其余待放行项", () => {
    const m = make();
    m.pauseAll();
    m.open({ id: A, overlap: true, onShow: () => m.pauseAll() });
    m.open({ id: B, overlap: true });
    m.resumeAll();
    expect(ids(m)).toEqual([A]);
    m.resumeAll();
    expect(ids(m)).toEqual([A, B]);
  });

  it("[A8][阶段1] overlap 钩子重新暂停后不落地缓存的 resolve", async () => {
    const m = make();
    const request = deferred<object>();
    m.open({ id: A, resolve: () => request.promise });
    await flush();
    m.pauseAll();
    request.resolve({});
    await flush();
    m.open({ id: OVERLAP, overlap: true, onShow: () => m.pauseAll() });
    m.resumeAll();
    expect(ids(m)).toEqual([OVERLAP]);
    m.resumeAll();
    expect(ids(m)).toContain(A);
  });
});

describe("[A9][阶段1] 释放期间与释放之后", () => {
  it("[A9][阶段1] destroy 钩子重开的条目立即兑现且不展示", async () => {
    const m = make();
    let result: (() => unknown) | undefined;
    m.open({
      id: A,
      onRemove: () => {
        result = observe(m.open({ id: B, duration: DURATION }).result);
      },
    });
    m.destroy();
    await flush();
    expect({ active: ids(m), result: result?.(), timers: vi.getTimerCount() }).toEqual({ active: [], result: DESTROYED, timers: 0 });
  });

  it("[A9][阶段1] destroy 后 open 不展示不启动计时器不写存储", async () => {
    const { map, storage } = memStorage();
    const m = make({ storage });
    await m.ready();
    m.destroy();
    const result = observe(m.open({ id: A, duration: DURATION, cooldown: { total: 1 } }).result);
    await flush();
    expect({ active: ids(m), result: result(), timers: vi.getTimerCount(), writes: map.size }).toEqual({ active: [], result: DESTROYED, timers: 0, writes: 0 });
  });
});

describe("[A10][阶段2] 入场层序", () => {
  it("[A10][阶段2] 较早创建但较晚入场的条目位于顶层", () => {
    const m = make();
    m.open({ id: A, when: (context) => context.go === true });
    m.open({ id: OVERLAP, overlap: true });
    m.setContext({ go: true });
    expect(m.getSnapshot().active.map(({ id, stackIndex, isTopmost }) => ({ id, stackIndex, isTopmost }))).toEqual([
      { id: OVERLAP, stackIndex: 0, isTopmost: false },
      { id: A, stackIndex: 1, isTopmost: true },
    ]);
  });

  it("替换后重新入场更新层序，保留原实例标识", () => {
    const m = make();
    m.open({ id: A });
    const key = m.get(A)!.instanceKey;
    m.open({ id: OVERLAP, overlap: true });
    m.open({ id: B, replace: true });
    m.remove(B);
    expect(ids(m)).toEqual([OVERLAP, A]);
    expect(m.get(A)).toMatchObject({ instanceKey: key, stackIndex: 1, isTopmost: true });
    m.close(A);
    expect(m.get(A)).toMatchObject({ instanceKey: key, stackIndex: 1, isTopmost: true });
  });
});

describe("[A11][阶段2] 排队更新通知", () => {
  it("[A11][阶段2] 更新不可见项不通知渲染订阅者但保留新数据", () => {
    const m = make();
    m.open({ id: A });
    m.open({ id: B, data: { version: 1 } });
    const listener = vi.fn();
    m.subscribe(listener);
    const snapshot = m.getSnapshot();
    m.update(B, { version: 2 });
    expect(listener).not.toHaveBeenCalled();
    expect(m.getSnapshot()).toBe(snapshot);
    m.remove(A);
    expect(m.get(B)?.data).toEqual({ version: 2 });
  });
});

describe("[B2][阶段3] 异步存储写入顺序", () => {
  it("[B2][阶段3] 旧写入较晚完成也不能覆盖最新累计次数", async () => {
    const map = new Map<string, string>();
    const writes: Array<() => void> = [];
    const m = make({
      storage: {
        get: () => null,
        set: (key, value) =>
          new Promise<void>((resolve) => {
            writes.push(() => {
              map.set(key, value);
              resolve();
            });
          }),
      },
    });
    await m.ready();
    m.open({ id: A, cooldown: { total: 3 } });
    m.remove(A);
    m.open({ id: A, cooldown: { total: 3 } });
    // 对当前并发实现倒序完成；对修复后的串行实现先结束首写，再结束补写。
    if (writes.length > 1) writes.pop()!();
    writes.shift()!();
    await flush();
    while (writes.length) {
      writes.shift()!();
      // 串行写必须等前一轮兑现才能取得下一轮补写。
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
    expect(disk(map)[A].total).toBe(2);
  });
});

describe("[B4][阶段1] 日志异常隔离", () => {
  it("[B4][阶段1] logger 抛错不阻断结果兑现和队列推进", async () => {
    let shouldThrow = true;
    const m = make({
      debug: true,
      logger: (message) => {
        if (shouldThrow && message.endsWith(":closed")) {
          shouldThrow = false;
          throw new Error("日志异常");
        }
      },
    });
    const result = observe(m.open({ id: A }).result);
    m.open({ id: B });
    m.remove(A);
    await flush();
    expect({ result: result(), active: ids(m) }).toEqual({ result: DISMISSED, active: [B] });
  });
});

describe("[B5][阶段3] 冷却记录校验", () => {
  /** 合法历史桶，避免以空标签夹具冒充有效记录。 */
  const buckets = { dayBucket: "2026-01-01", hourBucket: "2026-01-01T00", minuteBucket: "2026-01-01T00:00" };
  it("[B5][阶段3] 忽略坏广播而不把累计计数污染成 NaN", async () => {
    const m = make();
    await m.ready();
    m.open({ id: A, cooldown: { total: 1 } });
    m.remove(A);
    mergeRemote(m, A, {});
    m.open({ id: A, cooldown: { total: 1 } });
    expect(ids(m)).toEqual([]);
  });

  it("[B5][阶段3] 丢弃字符串计数的坏存储记录并从数值一重新计数", async () => {
    const { map, storage } = memStorage();
    map.set(KEY, JSON.stringify({ [A]: { ...record(1), ...buckets, total: "1" }, [OTHER]: { ...record(7), ...buckets } }));
    const m = make({ storage });
    await m.ready();
    m.open({ id: A, cooldown: { total: 5 } });
    await flush();
    expect(disk(map)[A].total).toBe(1);
    expect(disk(map)[OTHER].total).toBe(7);
  });
});

describe("[B6][阶段3] 特殊 id 持久化", () => {
  it("[B6][阶段3] __proto__ 作为普通 id 写入冷却记录", async () => {
    const { map, storage } = memStorage();
    const m = make({ storage });
    await m.ready();
    const id = "__proto__";
    m.open({ id, cooldown: { total: 1 } });
    await flush();
    expect(Object.hasOwn(disk(map), id)).toBe(true);
    expect(disk(map)[id].total).toBe(1);
  });
});

describe("[B7][阶段3] Node 默认广播保活", () => {
  it(
    "[B7][阶段3] 默认创建管理器后 Node 能自然退出",
    () => {
      const source = SOURCE_URL.href;
      let timedOut = false;
      try {
        execFileSync(
          process.execPath,
          [...NODE_TYPE_ARGS, `const { createLayerman } = await import(${JSON.stringify(source)}); const m = createLayerman(); if (m.channel) throw new Error("Node 默认不应建立通道"); await m.ready();`],
          {
            timeout: CHILD_EXIT_TIMEOUT_MS,
            encoding: "utf8",
          },
        );
      } catch (error) {
        // 只有确切的保活超时才交给断言；导入/脚本错误必须另行暴露。
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ETIMEDOUT") throw error;
        timedOut = true;
      }
      expect(timedOut).toBe(false);
    },
    CHILD_EXIT_TIMEOUT_MS + 1000,
  );
});

describe("[B8][阶段3] 夏令时回拨", () => {
  it("[B8][阶段3] 跨回拨合并按时间戳保留较新的分钟桶", () => {
    // Windows 的 worker 内动态 TZ 不一定影响 Date，子进程启动时注入 TZ。
    const script = `
      const { createLayerman } = await import(${JSON.stringify(SOURCE_URL.href)});
      const id = ${JSON.stringify(A)};
      let now = Date.parse('2026-11-01T05:50:00Z');
      const m = createLayerman({ crossTab: false, autoRemove: false, now: () => now });
      await m.ready();
      m.open({ id, cooldown: { minute: 1 } });
      const old = { ...m.cooldown.persisted.get(id) };
      m.remove(id);
      now = Date.parse('2026-11-01T06:10:00Z');
      m.open({ id, cooldown: { minute: 1 } });
      m.remove(id);
      m.cooldown.mergeRemote(id, old);
      m.open({ id, cooldown: { minute: 1 } });
      console.log(JSON.stringify({ hours: [new Date(old.lastShownAt).getHours(), new Date(now).getHours()], active: m.getSnapshot().active.map(e => e.id) }));
      m.destroy();
    `;
    const output = execFileSync(process.execPath, [...NODE_TYPE_ARGS, script], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, TZ: "America/New_York" },
      timeout: 5000,
      encoding: "utf8",
    });
    const result = JSON.parse(output) as { hours: number[]; active: string[] };
    // 同时检验 TZ 确实生效，不能靠错误时区得到预期失败。
    expect(result.hours).toEqual([1, 1]);
    expect(result.active).toEqual([]);
  });
});

describe("[N1][阶段1] 已移除的暂停 overlap", () => {
  it("[N1][阶段1] 移除待放行 overlap 后 clear 不重复触发 onRemove", () => {
    const m = make();
    const removed = vi.fn();
    m.pauseAll();
    m.open({ id: A, overlap: true, onRemove: removed });
    m.remove(A);
    m.clear();
    expect(removed).toHaveBeenCalledTimes(1);
  });
});

describe("[N2][阶段3] hydrate 前写入", () => {
  /** 合法历史桶，用于检验 hydrate 的逐条合并。 */
  const buckets = { dayBucket: "2026-01-01", hourBucket: "2026-01-01T00", minuteBucket: "2026-01-01T00:00" };
  it("[N2][阶段3] 未等 ready 的写入不丢失无关 id 历史", async () => {
    const { map, storage } = memStorage();
    map.set(KEY, JSON.stringify({ [OTHER]: { ...record(7), ...buckets } }));
    const m = make({ storage });
    m.open({ id: A, cooldown: { total: 9 } });
    await m.ready();
    await flush();
    expect(disk(map)[OTHER]?.total).toBe(7);
  });

  it("[N2][阶段3] 异步 hydrate 前不能绕过磁盘上已耗尽的 total", async () => {
    const snapshot = deferred<string | null>();
    const m = make({ storage: { get: () => snapshot.promise, set: () => {} } });
    const shown = vi.fn();
    m.open({ id: A, cooldown: { total: 1 }, onShow: shown });
    snapshot.resolve(JSON.stringify({ [A]: { ...record(1), ...buckets } }));
    await m.ready();
    await flush();
    expect(shown).not.toHaveBeenCalled();
  });
});

describe("[N3][阶段5] 永久耗尽的串行额度", () => {
  it("[N3][阶段5] session 耗尽的串行请求立即以 dismissed 兑现", async () => {
    const m = make();
    m.open({ id: A, cooldown: { session: 1 } });
    m.remove(A);
    const result = observe(m.open({ id: A, cooldown: { session: 1 } }).result);
    await flush();
    expect(result()).toEqual(CAPPED);
  });

  it("[N3][阶段5] total 耗尽的串行请求立即以 dismissed 兑现", async () => {
    const m = make();
    await m.ready();
    m.open({ id: A, cooldown: { total: 1 } });
    m.remove(A);
    const result = observe(m.open({ id: A, cooldown: { total: 1 } }).result);
    await flush();
    expect(result()).toEqual(CAPPED);
  });
});

describe("[N4][阶段1] 已到期的 duration 句柄", () => {
  it("[N4][阶段1] 到期关闭被拒绝后暂停恢复不重复请求守卫", async () => {
    const m = make();
    const guard = vi.fn(() => false);
    m.open({ id: A, duration: GUARD_DURATION, beforeClose: guard });
    await vi.advanceTimersByTimeAsync(GUARD_DURATION);
    expect(guard).toHaveBeenCalledTimes(1);
    m.pause(A);
    m.resume(A);
    await flush();
    expect(guard).toHaveBeenCalledTimes(1);
  });
});

describe("[N5][阶段5] 排队结果投递", () => {
  it("[N5][阶段5] 未展示的排队条目忽略 resolve 与 reject", async () => {
    const m = make();
    m.open({ id: BLOCK });
    const resolved = observe(m.open({ id: A }).result);
    const rejected = observe(m.open({ id: B }).result);
    m.resolve(A, 42);
    m.reject(B, new Error("尚未展示"));
    await flush();
    expect([resolved(), rejected()]).toEqual([PENDING, PENDING]);
  });
});

describe("[N6][阶段4] 关闭守卫的异步契约", () => {
  it("[N6][阶段4] 设计取舍，已文档化：同步守卫通过后在微任务内进入 closing", async () => {
    const m = make();
    const guard = vi.fn(() => true);
    m.open({ id: A, beforeClose: guard });
    m.close(A);
    expect(guard).toHaveBeenCalledOnce();
    // 设计取舍，已文档化：所有守卫统一异步决议，同步检查仍为 open。
    expect(m.get(A)?.phase).toBe(OverlayPhase.open);
    await Promise.resolve();
    expect(m.get(A)?.phase).toBe(OverlayPhase.closing);
  });
});

describe("[N7][阶段2] 请求期间的数据更新", () => {
  it("[N7][阶段2] resolving 期间 update 的补丁合并进落地数据", async () => {
    const m = make();
    const request = deferred<{ server: boolean; version: number }>();
    m.open({ id: A, resolve: () => request.promise });
    await flush();
    m.update(A, { version: 2 });
    request.resolve({ server: true, version: 1 });
    await flush();
    expect(m.get(A)?.data).toEqual({ server: true, version: 2 });
  });

  it("暂停缓存请求结果后继续更新，恢复时按补丁顺序落地", async () => {
    const m = make();
    m.open<unknown>({ id: A, data: { initial: true }, resolve: async () => ({ server: true, version: 1 }) });
    const snapshot = m.getSnapshot();
    const listener = vi.fn();
    m.subscribe(listener);
    m.update(A, { version: 2 });
    m.pauseAll();
    await flush();
    m.update(A, { local: true });
    expect(listener).not.toHaveBeenCalled();
    expect(m.getSnapshot()).toBe(snapshot);
    m.resumeAll();
    expect(m.get(A)?.data).toEqual({ server: true, version: 2, local: true });
  });

  it.each([undefined, null, false, 0, "local", { local: true }])("请求补丁先替换再合并，支持 %j", async (patch) => {
    const m = make();
    m.open({ id: A, resolve: async () => ({ server: true }) });
    m.update(A, patch);
    m.update(A, { version: 2 });
    await flush();
    expect(m.get(A)?.data).toEqual(typeof patch === "object" && patch ? { server: true, local: true, version: 2 } : { version: 2 });
  });

  it("空请求结果仍移除条目，不因本地补丁而展示", async () => {
    const m = make();
    const handle = m.open({ id: A, resolve: async () => null });
    m.update(A, { version: 2 });
    await flush();
    expect(m.get(A)).toBeUndefined();
    await expect(handle.result).resolves.toEqual(EMPTY);
  });
});

describe("修复期间不得回退的既有不变量", () => {
  it("[不变量2] 移除排队前项后重选候选并清除旧开场计时", async () => {
    const m = make();
    m.open({ id: A, priority: 1, delay: DURATION + ELAPSED });
    m.open({ id: B, delay: DURATION });
    m.remove(A);
    await vi.advanceTimersByTimeAsync(DURATION - 1);
    expect(ids(m)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ids(m)).toEqual([B]);
  });

  it("[不变量5b] 条件不合格的 replace 保持当前展示", () => {
    const m = make();
    m.open({ id: A });
    m.open({ id: B, replace: true, when: () => false });
    expect(ids(m)).toEqual([A]);
    expect(m.getSnapshot().queued).toEqual([B]);
  });

  it("[不变量5c] 全局暂停冻结 replace 与 overlap 的新展示", () => {
    const m = make();
    m.open({ id: A });
    m.pauseAll();
    m.open({ id: B, replace: true });
    m.open({ id: OVERLAP, overlap: true });
    expect(ids(m)).toEqual([A]);
    m.resumeAll();
    expect(ids(m)).toEqual([A, OVERLAP]);
  });

  it("[不变量5d] 单条暂停保留 duration 和自动移除剩余时长", async () => {
    const m = make({ autoRemove: DURATION });
    m.open({ id: A, duration: DURATION });
    await vi.advanceTimersByTimeAsync(ELAPSED);
    m.pause(A);
    await vi.advanceTimersByTimeAsync(DURATION);
    expect(m.get(A)?.phase).toBe(OverlayPhase.open);
    m.resume(A);
    await vi.advanceTimersByTimeAsync(DURATION - ELAPSED);
    expect(m.get(A)?.phase).toBe(OverlayPhase.closing);
    m.pause(A);
    await vi.advanceTimersByTimeAsync(DURATION);
    expect(m.get(A)?.phase).toBe(OverlayPhase.closing);
    m.resume(A);
    await vi.advanceTimersByTimeAsync(DURATION);
    expect(m.get(A)).toBeUndefined();
  });

  it("[F10] 同 id 重开接管展示并兑现旧句柄且豁免重复计数", async () => {
    const m = make();
    const old = m.open({ id: A, cooldown: { session: 1 } });
    const key = m.get(A)?.instanceKey;
    const next = m.open({ id: A, cooldown: { session: 1 } });
    expect(m.get(A)?.instanceKey).not.toBe(key);
    expect(ids(m)).toEqual([A]);
    await expect(old.result).resolves.toEqual(REPLACED);
    m.resolve(A, true);
    await expect(next.result).resolves.toBe(true);
  });

  it("[F13] replace 中止旧 resolve 后丢弃其落地数据", async () => {
    const m = make();
    const old = deferred<object>();
    const next = deferred<object>();
    const request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    m.open({ id: A, resolve: request });
    await flush();
    m.open({ id: B, replace: true });
    old.resolve({ version: 1 });
    await flush();
    expect(ids(m)).toEqual([B]);
    m.remove(B);
    await flush();
    next.resolve({ version: 2 });
    await flush();
    expect(m.get(A)?.data).toEqual({ version: 2 });
  });

  it("[F13] resolve 落地时重新检查条件并将不合格项退回队列", async () => {
    const m = make();
    const request = deferred<object>();
    const shown = vi.fn();
    m.setContext({ auth: true });
    m.open({ id: A, requiresAuth: true, resolve: () => request.promise, onShow: shown });
    await flush();
    m.setContext({ auth: false });
    request.resolve({});
    await flush();
    expect(ids(m)).toEqual([]);
    expect(m.getSnapshot().queued).toEqual([A]);
    expect(shown).not.toHaveBeenCalled();
  });
});

describe("[阶段1] 批次边界与释放契约", () => {
  const mutations: Array<[string, (m: Layerman) => void]> = [
    [
      "open",
      (m) => {
        void m.open({ id: OTHER }).result;
      },
    ],
    ["close", (m) => m.close(A)],
    ["remove", (m) => m.remove(A)],
    ["clear", (m) => m.clear()],
    ["setContext", (m) => m.setContext({ auth: true })],
    ["resolve", (m) => m.resolve(A, true)],
    ["reject", (m) => m.reject(A, new Error(A))],
    ["update", (m) => m.update(A, {})],
    ["pause", (m) => m.pause(A)],
    ["resume", (m) => m.resume(A)],
    ["pauseAll", (m) => m.pauseAll()],
    ["resumeAll", (m) => m.resumeAll()],
    ["destroy", (m) => m.destroy()],
  ];
  for (const [name, mutate] of mutations) {
    it(`D1 在谓词求值期间拒绝 ${name} 且不修改状态`, () => {
      const logger = vi.fn();
      const m = make({ debug: true, logger });
      const handle = m.open({
        id: A,
        when: () => {
          mutate(m);
          return true;
        },
      });
      void handle.result.catch(() => {});
      expect(ids(m)).toEqual([]);
      expect(m.getSnapshot().queued).toEqual([A]);
      expect(logger).toHaveBeenCalled();
      m.open({ id: B });
      expect(ids(m)).toEqual([B]);
    });
  }

  it("destroy 后所有变更均无操作，匿名 open 也立即兑现", async () => {
    const m = make();
    m.destroy();
    const listener = vi.fn();
    m.subscribe(listener);
    const snapshot = m.getSnapshot();
    for (const [, mutate] of mutations) mutate(m);
    const handle = m.open({});
    await expect(handle.result).resolves.toEqual(DESTROYED);
    expect(handle.id).toBeTruthy();
    expect(m.getSnapshot()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clear 只向订阅者发送一次最终快照，钩子在方法返回前执行", () => {
    const m = make();
    const removed = vi.fn();
    m.open({ id: A, onRemove: removed });
    m.open({ id: B, onRemove: removed });
    const listener = vi.fn();
    m.subscribe(listener);
    m.clear(() => undefined);
    expect(removed).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ active: [], queued: [] });
  });

  it("D1 允许谓词读取快照并订阅，路由求值同样禁止变更", () => {
    const m = make();
    m.open({
      id: A,
      when: () => {
        m.get(A);
        m.getSnapshot();
        m.getServerSnapshot();
        m.subscribe(() => {})();
        return true;
      },
    });
    expect(ids(m)).toEqual([A]);
    const route = /allowed/;
    route.test = () => {
      m.remove(A);
      return true;
    };
    m.setContext({ route: "allowed" });
    m.open({ id: B, slot: OTHER, route });
    expect(ids(m)).toEqual([A]);
    expect(m.getSnapshot().queued).toEqual([B]);
  });

  it("Node 显式 crossTab:true 仍建通道且调用可选 unref", () => {
    const unref = vi.fn();
    const close = vi.fn();
    const channel = { unref, close, onmessage: null };
    const construct = vi.fn(function () {
      return channel;
    });
    vi.stubGlobal("BroadcastChannel", construct);
    make({ crossTab: true }).destroy();
    expect(construct).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Node 默认无通道，浏览器默认创建不带 unref 的通道", () => {
    const construct = vi.fn(function () {
      return { close: () => {}, onmessage: null };
    });
    vi.stubGlobal("BroadcastChannel", construct);
    make({ crossTab: undefined });
    expect(construct).not.toHaveBeenCalled();
    vi.stubGlobal("window", {});
    make({ crossTab: undefined });
    expect(construct).toHaveBeenCalledTimes(1);
  });
});

describe("[阶段1] 过期回调的代次隔离", () => {
  it("已排入事件循环的旧 duration 回调不能关闭重新展示的条目", () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const m = make();
    m.open({ id: A, duration: DURATION });
    const stale = timers.mock.calls[0]![0] as () => void;
    m.open({ id: B, replace: true });
    m.remove(B);
    stale();
    expect(m.get(A)?.phase).toBe(OverlayPhase.open);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("旧实例已排入事件循环的自动移除回调不影响同 id 新实例", () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const m = make({ autoRemove: DURATION });
    m.open({ id: A });
    m.close(A);
    const stale = timers.mock.calls[0]![0] as () => void;
    m.open({ id: A });
    stale();
    expect(m.get(A)?.phase).toBe(OverlayPhase.open);
  });

  it("旧守卫拒绝不清除新代次尚未决议的关闭请求", async () => {
    let rejectOld!: (error: Error) => void;
    const old = new Promise<boolean>((_, reject) => {
      rejectOld = reject;
    });
    const next = deferred<boolean>();
    const guard = vi.fn().mockReturnValueOnce(old).mockReturnValue(next.promise);
    const m = make();
    m.open({ id: A, beforeClose: guard });
    m.close(A);
    m.open({ id: B, replace: true });
    m.remove(B);
    m.close(A);
    rejectOld(new Error("旧决议"));
    await flush();
    m.close(A);
    expect(guard).toHaveBeenCalledTimes(2);
    next.resolve(true);
    await flush();
    expect(m.get(A)?.phase).toBe(OverlayPhase.closing);
  });

  it("首个缓存 resolve 的展示钩子暂停后，其余缓存继续冻结", async () => {
    const first = deferred<object>();
    const second = deferred<object>();
    const m = make();
    m.open({ id: A, resolve: () => first.promise, onShow: () => m.pauseAll() });
    m.open({ id: B, slot: OTHER, resolve: () => second.promise });
    await flush();
    m.pauseAll();
    first.resolve({});
    second.resolve({});
    await flush();
    m.resumeAll();
    expect(ids(m)).toEqual([A]);
    m.resumeAll();
    expect(ids(m)).toEqual([A, B]);
  });

  it("释放中日志重入也不能登记新条目或修改状态", async () => {
    let releasing = false;
    let handle: OverlayHandle | undefined;
    const m = make({
      debug: true,
      logger: () => {
        if (releasing && !handle) {
          handle = m.open({ id: B });
          m.setContext({ auth: true });
        }
      },
    });
    m.open({ id: A });
    releasing = true;
    m.destroy();
    await expect(handle!.result).resolves.toEqual(DESTROYED);
    expect(ids(m)).toEqual([]);
  });
});

it.each([undefined, false, true])("[E14] clear(closeActive=%s) 只在显式开启时移除 resolving", async (closeActive) => {
  const m = make();
  const request = deferred<{ value: number }>();
  const removed = vi.fn();
  let signal!: AbortSignal;
  const resolving = m.open({
    id: A,
    resolve: (abort) => {
      signal = abort;
      return request.promise;
    },
    onRemove: removed,
  });
  const result = observe(resolving.result);
  await flush();
  const pending = m.open({ id: B });
  m.open({ id: OTHER, slot: "other" });
  m.pauseAll();
  const overlap = m.open({ id: OVERLAP, overlap: true });
  m.clear(closeActive === undefined ? undefined : { closeActive });
  expect(m.getSnapshot().queued).toEqual([]);
  await expect(pending.result).resolves.toEqual(CLEARED);
  await expect(overlap.result).resolves.toEqual(CLEARED);
  expect(signal.aborted).toBe(closeActive === true);
  expect(removed).toHaveBeenCalledTimes(closeActive ? 1 : 0);
  expect(result()).toEqual(closeActive ? CLEARED : PENDING);
  expect(ids(m)).toEqual(closeActive ? [] : [OTHER]);
  request.resolve({ value: 42 });
  await flush();
  m.resumeAll();
  expect(m.get(A)?.data).toEqual(closeActive ? undefined : { value: 42 });
  expect(ids(m)).toEqual(closeActive ? [] : [OTHER, A]);
  expect(removed).toHaveBeenCalledTimes(closeActive ? 1 : 0);
});

it.each([false, true])("[R2] destroy 最终通知后退订，钩子重入=%s", async (reentrant) => {
  const m = make();
  let reopened: OverlayHandle | undefined;
  m.open({
    id: A,
    onRemove: () => {
      if (reentrant) reopened = m.open({ id: B });
    },
  });
  const listeners = [vi.fn(), vi.fn()];
  for (const listener of listeners) m.subscribe(listener);
  m.destroy();
  for (const listener of listeners) {
    expect(listener).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
    expect(listener.mock.calls[0]![0].active).toEqual([]);
    expect(listener.mock.calls[0]![0].queued).toEqual([]);
  }
  if (reentrant) await expect(reopened!.result).resolves.toEqual(DESTROYED);
  m.open({ id: OTHER });
  m.setContext({ auth: true });
  m.clear({ closeActive: true });
  m.destroy();
  for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(1);
});

it("[R2] 订阅者重入 destroy 后所有订阅者收到一次最终空快照", () => {
  const m = make();
  const first = vi.fn((snapshot: ReturnType<Layerman["getSnapshot"]>) => {
    if (snapshot.active.length) m.destroy();
  });
  const second = vi.fn();
  m.subscribe(first);
  m.subscribe(second);
  m.open({ id: A });
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledTimes(1);
  expect(first.mock.calls.at(-1)?.[0]).toBe(m.getSnapshot());
  expect(second.mock.calls.at(-1)?.[0]).toBe(m.getSnapshot());
  expect(m.getSnapshot().active).toEqual([]);
});

it.each(["context", "overlap"])("[R1] 订阅者仅产生 %s 调度或副作用时仍完整通知", (mode) => {
  const m = make();
  m.open({ id: "waiting", when: () => false });
  const first = vi.fn((snapshot: ReturnType<Layerman["getSnapshot"]>) => {
    if (!snapshot.active.length) return;
    if (mode === "context") m.setContext({ auth: true });
    else m.open({ id: "ineligible", overlap: true, when: () => false, onRemove });
  });
  const onRemove = vi.fn();
  const second = vi.fn();
  m.subscribe(first);
  m.subscribe(second);
  m.open({ id: A });
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(first.mock.calls.at(-1)?.[0]).toBe(m.getSnapshot());
  expect(second.mock.calls.at(-1)?.[0]).toBe(m.getSnapshot());
  expect(m.getSnapshot().active.map((entry) => entry.id)).toEqual([A]);
  expect(onRemove).toHaveBeenCalledTimes(mode === "overlap" ? 1 : 0);
});

it("订阅者重入变更后，后续订阅者只收到稳定的新快照", () => {
  const m = make();
  m.subscribe((snapshot) => {
    if (snapshot.active.some((entry) => entry.id === A)) m.remove(A);
  });
  const received: string[][] = [];
  m.subscribe((snapshot) => received.push(snapshot.active.map((entry) => entry.id)));
  m.open({ id: A });
  expect(received).toEqual([[]]);
});

it("[N1] 订阅者每轮 clear 空队列只收到一次通知", () => {
  const m = make();
  const listener = vi.fn(() => {
    if (listener.mock.calls.length < REENTRY_TEST_GUARD) m.clear();
  });
  const unsubscribe = m.subscribe(listener);
  m.open({ id: A });
  unsubscribe();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(ids(m)).toEqual([A]);
});

it.each([OverlayPhase.open, OverlayPhase.closing])("[N1] %s 项重复相同补丁不会补发通知", (phase) => {
  const m = make();
  const data = { value: NaN, zero: -0 };
  m.open({ id: A, data });
  if (phase === OverlayPhase.closing) m.close(A);
  const listener = vi.fn(() => {
    if (listener.mock.calls.length < REENTRY_TEST_GUARD) m.update(A, data);
  });
  const unsubscribe = m.subscribe(listener);
  m.open({ id: B, overlap: true });
  unsubscribe();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(m.get(A)?.data).toBe(data);
});

it.each([false, true])("[N1] 不收敛更新在上限停止且管理器可继续使用，debug=%s", (debug) => {
  const logger = vi.fn();
  const m = make({ debug, logger });
  let calls = 0;
  const first = vi.fn((_snapshot: OverlayState) => {
    if (++calls <= NOTIFY_ROUND_LIMIT) m.update(A, { value: calls });
  });
  const unsubscribe = m.subscribe(first);
  const second = vi.fn();
  m.subscribe(second);
  m.open({ id: A, data: { value: 0 } });
  unsubscribe();
  expect(calls).toBe(NOTIFY_ROUND_LIMIT + 1);
  expect(first).toHaveBeenLastCalledWith(m.getSnapshot());
  expect(first.mock.calls.at(-1)?.[0]).toBe(m.getSnapshot());
  expect(second).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
  expect(second.mock.calls.at(-1)?.[0]).toBe(m.getSnapshot());
  expect(m.get(A)?.data).toEqual({ value: NOTIFY_ROUND_LIMIT });
  expect(logger.mock.calls.filter(([message]) => message === NOTIFY_LIMIT_MESSAGE)).toHaveLength(1);
  (m as unknown as { checkInvariants(): void }).checkInvariants();
  const listener = vi.fn();
  m.subscribe(listener);
  m.close(A);
  m.remove(A);
  m.open({ id: B });
  expect(ids(m)).toEqual([B]);
  expect(listener).toHaveBeenCalledTimes(3);
  expect(listener).toHaveBeenLastCalledWith(m.getSnapshot());
});

it("[N2] 通知中新增订阅者从下一轮开始接收，可主动读取本轮快照", () => {
  const m = make();
  const late = vi.fn();
  let added = false;
  m.subscribe(() => {
    if (!added) {
      added = true;
      m.subscribe(late);
    }
  });
  m.open({ id: A });
  expect(late).not.toHaveBeenCalled();
  expect(ids(m)).toEqual([A]);
  m.close(A);
  expect(late).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
});

it("[N1] 最终扇出内的变更只刷新状态，后续公开调用恢复通知", () => {
  const logger = vi.fn();
  const m = make({ logger });
  const first = vi.fn((_snapshot: OverlayState) => m.update(A, { value: first.mock.calls.length }));
  const off = m.subscribe(first);
  const shown = vi.fn(() => m.remove(A));
  const snapshotsAtDelivery: OverlayState[] = [];
  const second = vi.fn((_snapshot: OverlayState) => {
    snapshotsAtDelivery.push(m.getSnapshot());
    m.open({ id: B, overlap: true, onShow: shown });
  });
  const offSecond = m.subscribe(second);
  const last = vi.fn();
  m.subscribe(last);
  m.open({ id: A });
  off();
  offSecond();
  expect(first).toHaveBeenCalledTimes(NOTIFY_ROUND_LIMIT + 1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(second.mock.calls[0]?.[0]).toBe(snapshotsAtDelivery[0]);
  expect(last).toHaveBeenCalledTimes(1);
  expect(second.mock.calls[0]?.[0]).toBe(first.mock.calls.at(-1)?.[0]);
  expect(last.mock.calls[0]?.[0]).toBe(second.mock.calls[0]?.[0]);
  expect(last.mock.calls[0]?.[0]).not.toBe(m.getSnapshot());
  expect(shown).toHaveBeenCalledTimes(1);
  expect(ids(m)).toEqual([B]);
  (m as unknown as { checkInvariants(): void }).checkInvariants();
  m.close(B);
  m.remove(B);
  m.open({ id: A });
  expect(last).toHaveBeenCalledTimes(4);
  expect(last.mock.calls.at(-1)?.[0]).toBe(m.getSnapshot());
  expect(logger).toHaveBeenCalledExactlyOnceWith(NOTIFY_LIMIT_MESSAGE);
});

it("[N1] 最终扇出跳过已退订者，隔离订阅者异常，新增订阅者从下轮接收", () => {
  const m = make({ logger: vi.fn() });
  let calls = 0;
  const late = vi.fn();
  const skipped = vi.fn();
  const first = m.subscribe(() => {
    if (++calls <= NOTIFY_ROUND_LIMIT) m.update(A, { value: calls });
    else {
      offSkipped();
      m.subscribe(late);
      throw new Error("最终订阅者失败");
    }
  });
  const offSkipped = m.subscribe(skipped);
  const last = vi.fn();
  m.subscribe(last);
  m.open({ id: A });
  first();
  expect(skipped).not.toHaveBeenCalled();
  expect(late).not.toHaveBeenCalled();
  expect(last).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
  m.close(A);
  expect(late).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
});

it.each([false, true])("[N1] 每次超限仅诊断一次，配置 logger=%s", (customLogger) => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const logger = vi.fn();
    const m = make(customLogger ? { logger } : {});
    let calls = 0;
    const off = m.subscribe(() => m.update(A, { value: ++calls }));
    m.open({ id: A });
    expect(customLogger ? logger : warn).toHaveBeenCalledExactlyOnceWith(NOTIFY_LIMIT_MESSAGE);
    expect(customLogger ? warn : logger).not.toHaveBeenCalled();
    m.update(A, { value: -1 });
    off();
    expect(customLogger ? logger : warn).toHaveBeenCalledTimes(2);
  } finally {
    warn.mockRestore();
  }
});

it("[N1] 无 console 的环境超限后仍完成最终扇出", () => {
  const m = make();
  let calls = 0;
  const off = m.subscribe(() => {
    if (++calls <= NOTIFY_ROUND_LIMIT) m.update(A, { value: calls });
  });
  const last = vi.fn();
  m.subscribe(last);
  vi.stubGlobal("console", undefined);
  try {
    m.open({ id: A });
  } finally {
    vi.unstubAllGlobals();
    off();
  }
  expect(last).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
  (m as unknown as { checkInvariants(): void }).checkInvariants();
});

it("[N1] clear 只通知实际摘除，包含 selector 和冻结 overlap", async () => {
  const m = make();
  m.open({ id: A });
  const listener = vi.fn();
  m.subscribe(listener);
  const before = m.getSnapshot();
  m.clear();
  m.clear({ closeActive: false });
  m.clear(() => []);
  m.clear(() => [OTHER]);
  expect(listener).not.toHaveBeenCalled();
  expect(m.getSnapshot()).toBe(before);
  m.pauseAll();
  const pending = m.open({ id: B });
  const overlap = m.open({ id: OVERLAP, overlap: true });
  listener.mockClear();
  m.clear(() => [OVERLAP, OVERLAP, OTHER]);
  expect(listener).toHaveBeenCalledTimes(1);
  await expect(overlap.result).resolves.toEqual(CLEARED);
  m.clear(() => [OVERLAP]);
  expect(listener).toHaveBeenCalledTimes(1);
  m.clear();
  expect(listener).toHaveBeenCalledTimes(2);
  await expect(pending.result).resolves.toEqual(CLEARED);
  m.clear({ closeActive: true });
  expect(listener).toHaveBeenCalledTimes(3);
  m.clear({ closeActive: true });
  expect(listener).toHaveBeenCalledTimes(3);
  expect(ids(m)).toEqual([]);
});

it("[N1] update 浅比较符号键、NaN、正负零并保持排队项静默", () => {
  const m = make();
  const key = Symbol("数据键");
  const data = { [key]: NaN, zero: -0 };
  m.open({ id: A, data });
  m.open({ id: B, data });
  const listener = vi.fn();
  m.subscribe(listener);
  const before = m.getSnapshot();
  m.update(A, { [key]: NaN });
  m.update(A, {});
  m.update(A, Object.defineProperty({}, "ignored", { value: true }));
  m.update(B, { zero: 0 });
  expect(listener).not.toHaveBeenCalled();
  expect(m.getSnapshot()).toBe(before);
  m.update(A, { zero: 0 });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(m.get(A)?.data).toEqual({ ...data, zero: 0 });
  m.update(A, { [key]: 1 });
  expect(listener).toHaveBeenCalledTimes(2);
  m.remove(A);
  expect(m.get(B)?.data).toEqual({ ...data, zero: 0 });
});

it.each([undefined, null, NaN, 0, false, "value"])("[N1] 原始值补丁 %s 用 Object.is 判断无变化", (data) => {
  const m = make();
  m.open({ id: A, data });
  const listener = vi.fn();
  m.subscribe(listener);
  const before = m.getSnapshot();
  m.update(A, data);
  expect(listener).not.toHaveBeenCalled();
  expect(m.getSnapshot()).toBe(before);
  m.update(A, { changed: true });
  expect(listener).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
});

it("[N1] 上限诊断抛错或重入后仍排空副作用并恢复批次深度", () => {
  let diagnostics = 0;
  const shown = vi.fn(() => m.remove(A));
  const m = make({
    debug: false,
    logger: (message) => {
      if (message !== NOTIFY_LIMIT_MESSAGE) return;
      diagnostics++;
      m.open({ id: B, overlap: true, onShow: shown });
      throw new Error("诊断通道失败");
    },
  });
  let calls = 0;
  const unsubscribe = m.subscribe(() => {
    if (++calls < REENTRY_TEST_GUARD) m.update(A, { value: calls });
  });
  m.open({ id: A });
  unsubscribe();
  expect(diagnostics).toBe(1);
  expect(calls).toBe(NOTIFY_ROUND_LIMIT + 1);
  expect(shown).toHaveBeenCalledTimes(1);
  expect(ids(m)).toEqual([B]);
  const internal = m as unknown as { depth: number; needEmit: boolean; pendingListeners: unknown[]; effects: unknown[]; dirtySlots: Set<string>; checkInvariants(): void };
  expect(internal.depth).toBe(0);
  expect(internal.needEmit).toBe(false);
  expect(internal.pendingListeners).toEqual([]);
  expect(internal.effects).toEqual([]);
  expect(internal.dirtySlots.size).toBe(0);
  internal.checkInvariants();
  m.close(B);
  expect(m.get(B)?.phase).toBe(OverlayPhase.closing);
});

it("[N1] 同一快照接续超过上限数量的订阅者不会截断通知", () => {
  const logger = vi.fn();
  const m = make({ debug: true, logger });
  const listeners = Array.from({ length: NOTIFY_ROUND_LIMIT + 1 }, () => vi.fn(() => m.setContext({})));
  for (const listener of listeners) m.subscribe(listener);
  m.open({ id: A, when: () => false });
  for (const listener of listeners) expect(listener).toHaveBeenCalledExactlyOnceWith(m.getSnapshot());
  expect(logger).not.toHaveBeenCalledWith(NOTIFY_LIMIT_MESSAGE);
});

/** 阶段五统一的有效历史记录，故意固定桶以便只观察永久额度。 */
const HISTORY = { total: 1, dayBucket: "2026-01-01", dayCount: 1, hourBucket: "2026-01-01T00", hourCount: 1, minuteBucket: "2026-01-01T00:00", minuteCount: 1, lastShownAt: Date.parse("2026-01-01T12:00:00Z") };
const CLOSED = { dismissed: true, reason: "closed" };
const UNMET = { dismissed: true, reason: "unmet" };

describe("阶段五 capped 与结束原因", () => {
  it.each(["broadcast", "hydrate"] as const)("暂停中 %s 清理连续耗尽 overlap，保留其余持有项", async (source) => {
    const channel = { onmessage: null as null | ((event: MessageEvent) => void), close: vi.fn(), postMessage: vi.fn() };
    /** 提供可手动投递消息的跨 Tab 通道。 */
    function Channel() {
      return channel;
    }
    vi.stubGlobal("BroadcastChannel", Channel);
    const read = deferred<string | null>();
    const m = make({ crossTab: true, storage: source === "hydrate" ? { get: () => read.promise, set: () => {} } : memStorage().storage });
    m.pauseAll();
    const onShow = vi.fn();
    const onRemove = vi.fn();
    const first = m.open({ id: A, overlap: true, cooldown: { total: 1 }, onShow, onRemove });
    const second = m.open({ id: B, overlap: true, cooldown: { total: 1 }, onShow, onRemove });
    const survivor = m.open({ id: OTHER, overlap: true, cooldown: { total: 2 }, onShow });
    const survivorResult = observe(survivor.result);
    if (source === "broadcast") {
      channel.onmessage!({ data: { id: A, rec: HISTORY } } as MessageEvent);
      channel.onmessage!({ data: { id: B, rec: HISTORY } } as MessageEvent);
      channel.onmessage!({ data: { id: OTHER, rec: HISTORY } } as MessageEvent);
    } else {
      read.resolve(JSON.stringify({ [A]: HISTORY, [B]: HISTORY, [OTHER]: HISTORY }));
      await m.ready();
    }
    await expect(first.result).resolves.toEqual(CAPPED);
    await expect(second.result).resolves.toEqual(CAPPED);
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onShow).not.toHaveBeenCalled();
    expect(survivorResult()).toBe(PENDING);
    const internal = m as unknown as { pendingOverlaps: { id: string }[]; checkInvariants(): void };
    expect(internal.pendingOverlaps.map((entry) => entry.id)).toEqual([OTHER]);
    internal.checkInvariants();
    m.resumeAll();
    expect(ids(m)).toEqual([OTHER]);
    expect(onShow).toHaveBeenCalledOnce();
    internal.checkInvariants();
  });

  it.each(["session", "total"] as const)("%s 在提交时清理默认队列、slot、暂停、条件不满足与 overlap", async (field) => {
    const m = make();
    m.open({ id: BLOCK });
    m.pauseAll();
    const onShow = vi.fn();
    for (const [id, slot, overlap] of [
      [A, "", false],
      [B, OTHER, false],
      [OVERLAP, "", true],
    ] as const) {
      const handle = m.open({ id, slot, overlap, cooldown: { [field]: 0 }, when: () => false, onShow });
      // eslint-disable-next-line no-await-in-loop
      await expect(handle.result).resolves.toEqual(CAPPED);
    }
    expect(m.getSnapshot().queued).toEqual([]);
    expect(onShow).not.toHaveBeenCalled();
  });

  it("hydrate 后即使 slot 被占用且全局暂停，也清理永久耗尽的串行与 overlap", async () => {
    const read = deferred<string | null>();
    const set = vi.fn();
    const m = make({ storage: { get: () => read.promise, set } });
    m.open({ id: BLOCK });
    m.pauseAll();
    const onShow = vi.fn();
    const first = m.open({ id: A, cooldown: { total: 1 }, onShow });
    const second = m.open({ id: B, slot: OTHER, cooldown: { total: 1 }, onShow });
    const overlap = m.open({ id: OVERLAP, overlap: true, cooldown: { total: 1 }, onShow });
    read.resolve(JSON.stringify({ [A]: HISTORY, [B]: HISTORY, [OVERLAP]: HISTORY }));
    await m.ready();
    for (const handle of [first, second, overlap]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(handle.result).resolves.toEqual(CAPPED);
    }
    expect(m.getSnapshot().queued).toEqual([]);
    expect(onShow).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("同 id 等待项重开：旧句柄 replaced、新耗尽句柄 capped；连续展示仍豁免", async () => {
    const m = make();
    m.open({ id: BLOCK });
    const old = m.open({ id: A });
    const capped = m.open({ id: A, cooldown: { session: 0 } });
    await expect(old.result).resolves.toEqual(REPLACED);
    await expect(capped.result).resolves.toEqual(CAPPED);
    m.remove(BLOCK);
    const shown = m.open({ id: B, cooldown: { session: 1, total: 1 } });
    const next = m.open({ id: B, cooldown: { session: 1, total: 1 } });
    await expect(shown.result).resolves.toEqual(REPLACED);
    expect(m.get(B)).toBeDefined();
    m.remove(B);
    await expect(next.result).resolves.toEqual(DISMISSED);
  });

  it.each([{ minGap: { seconds: 1 } }, { day: 1 }, { hour: 1 }, { minute: 1 }])("时间型冷却 %j 不算 capped，且到期不会自行唤醒", async (cooldown) => {
    const m = make();
    m.open({ id: A, cooldown });
    m.remove(A);
    const handle = m.open({ id: A, cooldown });
    const result = observe(handle.result);
    expect(m.getSnapshot().queued).toEqual([A]);
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    expect(result()).toBe(PENDING);
    expect(m.get(A)).toBeUndefined();
    m.setContext({});
    expect(m.get(A)).toBeDefined();
  });

  it.each(["remove", "closeManual", "closeAuto", "clear", "replace", "unmet", "capped", "destroy", "empty", "overlapUnmet", "overlapCapped", "resumeUnmet", "resumeCapped"] as const)(
    "被动结束路径 %s 带准确原因",
    async (path) => {
      const m = make();
      if (path.startsWith("resume")) m.pauseAll();
      const handle = m.open({
        id: A,
        overlap: path.startsWith("overlap") || path.startsWith("resume"),
        when: path === "overlapUnmet" ? () => false : (ctx) => !ctx.auth,
        cooldown: path === "capped" || path === "overlapCapped" ? { session: 0 } : path === "resumeCapped" ? { total: 1 } : undefined,
        resolve: path === "empty" ? async () => null : undefined,
        autoRemove: path === "closeAuto" ? 0 : false,
      });
      let expected = DISMISSED;
      switch (path) {
        case "remove":
          m.remove(A);
          break;
        case "closeManual":
          m.close(A);
          m.remove(A);
          expected = CLOSED;
          break;
        case "closeAuto":
          m.close(A);
          expected = CLOSED;
          break;
        case "clear":
          m.clear({ closeActive: true });
          expected = CLEARED;
          break;
        case "replace":
          m.open({ id: A });
          expected = REPLACED;
          break;
        case "unmet":
          m.setContext({ auth: true });
          expected = UNMET;
          break;
        case "capped":
        case "overlapCapped":
          expected = CAPPED;
          break;
        case "destroy":
          m.destroy();
          expected = DESTROYED;
          break;
        case "empty":
          expected = EMPTY;
          break;
        case "overlapUnmet":
          expected = UNMET;
          break;
        case "resumeUnmet":
          m.setContext({ auth: true });
          m.resumeAll();
          expected = UNMET;
          break;
        case "resumeCapped":
          mergeRemote(m, A, HISTORY);
          m.resumeAll();
          expected = CAPPED;
          break;
      }
      await flush();
      await expect(handle.result).resolves.toEqual(expected);
    },
  );

  it("请求期间远端额度耗尽时落地 capped，不展示、不额外计数", async () => {
    const m = make();
    const request = deferred<object>();
    const onShow = vi.fn();
    const handle = m.open({ id: A, cooldown: { total: 1 }, resolve: () => request.promise, onShow });
    await flush();
    mergeRemote(m, A, HISTORY);
    request.resolve({});
    await flush();
    await expect(handle.result).resolves.toEqual(CAPPED);
    expect(onShow).not.toHaveBeenCalled();
  });
});

describe("阶段五 hydrate 门控", () => {
  it.each(["total", "day", "hour", "minute", "minGap"] as const)("慢 hydrate 期间 %s 串行和 overlap 等待；普通与 session 条目照常展示", async (field) => {
    const read = deferred<string | null>();
    const m = make({ storage: { get: () => read.promise, set: () => {} } });
    const cooldown = field === "minGap" ? { minGap: { seconds: 1 } } : { [field]: 1 };
    const serial = m.open({ id: A, cooldown });
    const overlap = m.open({ id: OVERLAP, overlap: true, cooldown });
    m.open({ id: B, slot: OTHER, cooldown: { session: 1 } });
    m.open({ id: BLOCK, slot: BLOCK });
    m.resumeAll();
    expect(ids(m)).toEqual([B, BLOCK]);
    expect(m.getSnapshot().queued).toEqual([A]);
    expect(observe(serial.result)()).toBe(PENDING);
    expect(observe(overlap.result)()).toBe(PENDING);
    read.resolve(null);
    await m.ready();
    expect(ids(m)).toEqual([B, BLOCK, OVERLAP, A]);
  });

  it.each(["reject", "badJson", "badRecord", "null", "array"] as const)("hydrate %s 也结束等待并释放 overlap", async (mode) => {
    let finish!: (value: string | null) => void;
    let fail!: (error: Error) => void;
    const read = new Promise<string | null>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const m = make({ storage: { get: () => read, set: () => {} } });
    m.open({ id: A, cooldown: { total: 1 } });
    m.open({ id: OVERLAP, overlap: true, cooldown: { total: 1 } });
    expect(ids(m)).toEqual([]);
    if (mode === "reject") fail(new Error(OTHER));
    else finish(mode === "badJson" ? "{" : mode === "badRecord" ? JSON.stringify({ [A]: {} }) : mode === "array" ? "[]" : null);
    await m.ready();
    expect(ids(m)).toEqual([OVERLAP, A]);
  });

  it.each(["remove", "clear", "destroy"] as const)("hydrate 前 %s 能结束持有条目，之后不会复活", async (op) => {
    const read = deferred<string | null>();
    const m = make({ storage: { get: () => read.promise, set: () => {} } });
    const onShow = vi.fn();
    const handles = [m.open({ id: A, cooldown: { total: 1 }, onShow }), m.open({ id: OVERLAP, overlap: true, cooldown: { total: 1 }, onShow })];
    if (op === "clear") m.clear();
    else if (op === "destroy") m.destroy();
    else for (const handle of handles) m[op](handle.id);
    const expected = op === "remove" ? DISMISSED : op === "clear" ? CLEARED : DESTROYED;
    for (const handle of handles) {
      // eslint-disable-next-line no-await-in-loop
      await expect(handle.result).resolves.toEqual(expected);
    }
    read.resolve(null);
    await m.ready();
    expect(m.getSnapshot()).toEqual({ active: [], queued: [] });
    expect(onShow).not.toHaveBeenCalled();
  });

  it("同步 storage 在返回前应用历史；读取抛错也立即解除等待", async () => {
    const m = make({ storage: { get: () => JSON.stringify({ [A]: HISTORY }), set: () => {} } });
    const handle = m.open({ id: A, cooldown: { total: 1 } });
    await expect(handle.result).resolves.toEqual(CAPPED);
    const broken = make({
      storage: {
        get: () => {
          throw new Error(OTHER);
        },
        set: () => {},
      },
    });
    broken.open({ id: B, cooldown: { total: 1 } });
    expect(broken.get(B)).toBeDefined();
  });

  it("hydrate 后 overlap 条件/时间冷却不合格则丢弃；暂停期间继续持有合格项", async () => {
    const read = deferred<string | null>();
    const m = make({ storage: { get: () => read.promise, set: () => {} } });
    const unmet = m.open({ id: A, overlap: true, when: () => false, cooldown: { total: 2 } });
    const timed = m.open({ id: B, overlap: true, cooldown: { minGap: { seconds: 1 } } });
    m.pauseAll();
    const held = m.open({ id: OVERLAP, overlap: true, cooldown: { total: 2 } });
    read.resolve(JSON.stringify({ [B]: HISTORY }));
    await m.ready();
    expect(ids(m)).toEqual([]);
    m.resumeAll();
    await expect(unmet.result).resolves.toEqual(UNMET);
    await expect(timed.result).resolves.toEqual(UNMET);
    expect(m.get(OVERLAP)).toBeDefined();
    m.resolve(OVERLAP, true);
    await expect(held.result).resolves.toBe(true);
  });

  it("同 id 从普通展示重开为持久化冷却，也必须等待 hydrate", async () => {
    const read = deferred<string | null>();
    const m = make({ storage: { get: () => read.promise, set: () => {} } });
    const old = m.open({ id: A });
    m.open({ id: A, cooldown: { total: 1 } });
    await expect(old.result).resolves.toEqual(REPLACED);
    expect(m.get(A)).toBeUndefined();
    read.resolve(null);
    await m.ready();
    expect(m.get(A)).toBeDefined();
  });
});

describe("阶段五从未展示的结果投递", () => {
  it.each(["queue", "overlap", "hydrateSerial", "hydrateOverlap"] as const)("%s 的 close 保留等待项及结果，解除等待后仍展示", async (mode) => {
    const read = deferred<string | null>();
    const hydration = mode.startsWith("hydrate");
    const m = make(hydration ? { storage: { get: () => read.promise, set: () => {} } } : {});
    if (mode === "queue") m.open({ id: BLOCK });
    if (mode === "overlap") m.pauseAll();
    const onRemove = vi.fn();
    const beforeClose = vi.fn(() => true);
    const handle = m.open({ id: A, overlap: mode === "overlap" || mode === "hydrateOverlap", cooldown: hydration ? { total: 1 } : undefined, onRemove, beforeClose });
    const result = observe(handle.result);
    const snapshot = m.getSnapshot();
    m.close(A);
    await flush();
    expect(m.getSnapshot()).toBe(snapshot);
    expect(result()).toBe(PENDING);
    expect(onRemove).not.toHaveBeenCalled();
    expect(beforeClose).not.toHaveBeenCalled();
    if (hydration) {
      read.resolve(null);
      await m.ready();
    } else if (mode === "queue") m.remove(BLOCK);
    else m.resumeAll();
    expect(m.get(A)?.phase).toBe("open");
    m.remove(A);
    await expect(handle.result).resolves.toEqual(DISMISSED);
  });

  it.each(["queue", "resolving", "overlap", "hydrateOverlap"] as const)("%s 忽略 resolve/reject，展示后允许宿主兑现", async (mode) => {
    const read = deferred<string | null>();
    const request = deferred<object>();
    const m = make(mode === "hydrateOverlap" ? { storage: { get: () => read.promise, set: () => {} } } : {});
    if (mode === "queue") m.open({ id: BLOCK });
    if (mode === "overlap") m.pauseAll();
    const handle = m.open({
      id: A,
      overlap: mode.endsWith("Overlap") || mode === "overlap",
      cooldown: mode === "hydrateOverlap" ? { total: 1 } : undefined,
      resolve: mode === "resolving" ? () => request.promise : undefined,
    });
    const result = observe(handle.result);
    m.resolve(A, 42);
    m.reject(A, new Error(OTHER));
    await flush();
    expect(result()).toBe(PENDING);
    if (mode === "queue") m.remove(BLOCK);
    else if (mode === "resolving") {
      request.resolve({});
      await flush();
    } else if (mode === "overlap") m.resumeAll();
    else {
      read.resolve(null);
      await m.ready();
    }
    expect(m.get(A)).toBeDefined();
    m.close(A);
    m.resolve(A, true);
    await expect(handle.result).resolves.toBe(true);
  });

  it("从未展示的 resolving 调用 close 不兑现、不打断请求，仍可落地展示", async () => {
    const m = make();
    let signal!: AbortSignal;
    const request = deferred<object>();
    const handle = m.open({
      id: A,
      resolve: (value) => {
        signal = value;
        return request.promise;
      },
    });
    const result = observe(handle.result);
    await flush();
    m.reject(A, new Error(OTHER));
    m.close(A);
    await flush();
    expect(result()).toBe(PENDING);
    expect(signal.aborted).toBe(false);
    request.resolve({});
    await flush();
    expect(m.get(A)?.phase).toBe("open");
    m.close(A);
    m.remove(A);
    await expect(handle.result).resolves.toEqual(CLOSED);
  });
});

it("暂停期间缓存的请求数据尚未展示时，resolve/reject 仍无操作", async () => {
  const m = make();
  const request = deferred<object>();
  const handle = m.open({ id: A, resolve: () => request.promise });
  const result = observe(handle.result);
  await flush();
  m.pauseAll();
  request.resolve({});
  await flush();
  m.resolve(A, true);
  m.reject(A, new Error(OTHER));
  await flush();
  expect(result()).toBe(PENDING);
  m.resumeAll();
  expect(m.get(A)).toBeDefined();
  m.reject(A, new Error(OTHER));
  await expect(handle.result).rejects.toThrow(OTHER);
});
