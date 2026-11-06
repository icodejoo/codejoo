import { deferred } from "./helpers.ts";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { CooldownStore, type CooldownRecord } from "../src/cooldown.ts";

/** 固定存储键。 */
const KEY = "cooldown-test";
/** 固定条目编号。 */
const ID = "overlay";
/** 无关历史条目编号。 */
const OTHER = "other";
/** 模拟存储配额耗尽。 */
const QUOTA_ERROR = "quota";
/** 固定本地日历时刻。 */
const NOW = new Date(2026, 0, 2, 3, 4).getTime();
/** 子进程加载的冷却模块地址。 */
const SOURCE_URL = new URL("../src/cooldown.ts", import.meta.url);
/** 子进程直接加载 TypeScript 模块的参数。 */
const NODE_TYPE_ARGS = ["--experimental-strip-types", "--input-type=module", "-e"];
/** 子进程启动与执行的时间预算。 */
const CHILD_TIMEOUT_MS = 5000;
/** 覆盖夏令时回拨的纽约时区。 */
const DST_TZ = "America/New_York";
/** 冲刷异步存储的完成回调。 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
/** 构造可合并的有效冷却记录。 */
function record(total = 1): CooldownRecord {
  return { total, dayBucket: "2026-01-02", dayCount: total, hourBucket: "2026-01-02T03", hourCount: total, minuteBucket: "2026-01-02T03:04", minuteCount: total, lastShownAt: NOW };
}

describe("冷却写入串行化", () => {
  it("慢写期间连续变动只补写最新快照，快写不能越过慢写", async () => {
    const slow = deferred<void>();
    let disk = "";
    const set = vi.fn((_key: string, value: string) => {
      if (set.mock.calls.length === 1)
        return slow.promise.then(() => {
          disk = value;
        });
      disk = value;
    });
    const store = new CooldownStore({ get: () => null, set }, KEY);
    await store.hydrate();
    store.record(ID, { total: 9 }, NOW);
    store.record(ID, { total: 9 }, NOW);
    store.record(ID, { total: 9 }, NOW);
    expect(set).toHaveBeenCalledTimes(1);
    slow.resolve();
    await flush();
    expect(set).toHaveBeenCalledTimes(2);
    expect(JSON.parse(disk)[ID].total).toBe(3);
  });

  it.each([false, true])("写入%s失败后仍能补写并接受后续写入", async (sync) => {
    const first = deferred<void>();
    const set = vi.fn(() => {
      if (set.mock.calls.length !== 1) return;
      if (sync) throw new Error(QUOTA_ERROR);
      return first.promise;
    });
    const store = new CooldownStore({ get: () => null, set }, KEY);
    await store.hydrate();
    store.record(ID, { total: 9 }, NOW);
    store.record(ID, { total: 9 }, NOW);
    if (!sync) first.reject(new Error(QUOTA_ERROR));
    await flush();
    expect(set).toHaveBeenCalledTimes(2);
    store.record(ID, { total: 9 }, NOW);
    expect(set).toHaveBeenCalledTimes(3);
    expect(store.canShow(ID, { total: 3 }, NOW)).toBe(false);
  });
});

describe("冷却记录校验", () => {
  it.each([
    {},
    null,
    [],
    "invalid",
    { ...record(), total: "1" },
    { ...record(), dayCount: -1 },
    { ...record(), hourCount: 0.5 },
    { ...record(), minuteCount: NaN },
    { ...record(), total: Infinity },
    { ...record(), lastShownAt: -1 },
    { ...record(), lastShownAt: NaN },
    { ...record(), lastShownAt: Infinity },
    { ...record(), dayBucket: 42 },
    { ...record(), dayBucket: "2026-02-30" },
    { ...record(), dayBucket: "2026-99-01" },
    { ...record(), hourBucket: "2026-01-02T24" },
    { ...record(), minuteBucket: "2026-01-02T03:60" },
  ])("隔离损坏记录 %#，有效 id 与本地额度不受影响", async (bad) => {
    const set = vi.fn();
    const store = new CooldownStore({ get: () => JSON.stringify({ bad, valid: record(7) }), set }, KEY);
    await store.hydrate();
    expect(store.canShow("bad", { total: 1 }, NOW)).toBe(true);
    expect(store.canShow("valid", { total: 7 }, NOW)).toBe(false);
    store.record(ID, { total: 1 }, NOW);
    store.mergeRemote(ID, bad);
    expect(store.canShow(ID, { total: 1 }, NOW)).toBe(false);
    store.mergeRemote("remote", bad);
    expect(store.canShow("remote", { total: 1 }, NOW)).toBe(true);
  });
});

describe("hydrate 与实时写入合并", () => {
  it("读取完成前不写盘，完成后保留其他 id 并合并同 id 历史", async () => {
    const read = deferred<string | null>();
    const set = vi.fn<(key: string, value: string) => void>();
    const store = new CooldownStore({ get: () => read.promise, set }, KEY);
    const ready = store.hydrate();
    store.record(ID, { total: 9 }, NOW);
    expect(set).not.toHaveBeenCalled();
    read.resolve(JSON.stringify({ [ID]: record(7), [OTHER]: record(5) }));
    await ready;
    expect(set).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(set.mock.calls[0]![1] as string);
    expect(saved[ID].total).toBe(7);
    expect(saved[OTHER].total).toBe(5);
  });

  it("旧磁盘计数不能回退 hydrate 期间的新展示", async () => {
    const read = deferred<string | null>();
    const set = vi.fn<(key: string, value: string) => void>();
    const store = new CooldownStore({ get: () => read.promise, set }, KEY);
    const ready = store.hydrate();
    store.record(ID, { total: 9 }, NOW);
    store.record(ID, { total: 9 }, NOW);
    read.resolve(JSON.stringify({ [ID]: record(0) }));
    await ready;
    expect(JSON.parse(set.mock.calls[0]![1] as string)[ID].total).toBe(2);
  });
});
describe("存储降级与隔离", () => {
  it.each([null, "", "null", "[]", "42", "broken JSON"])("损坏顶层或空存储 %s 不阻断后续写入", async (raw) => {
    const set = vi.fn();
    const store = new CooldownStore({ get: () => raw, set }, KEY);
    store.record(ID, { total: 2 }, NOW);
    await store.hydrate();
    expect(set).toHaveBeenCalledTimes(1);
    expect(store.canShow(ID, { total: 1 }, NOW)).toBe(false);
  });

  it.each([false, true])("读取%s失败后仍提交等待的本地记录", async (sync) => {
    const set = vi.fn();
    const store = new CooldownStore(
      {
        get: () => {
          if (sync) throw new Error(QUOTA_ERROR);
          return Promise.reject(new Error(QUOTA_ERROR));
        },
        set,
      },
      KEY,
    );
    store.record(ID, { total: 2 }, NOW);
    await store.hydrate();
    store.record(ID, { total: 2 }, NOW);
    expect(set).toHaveBeenCalledTimes(2);
    expect(store.canShow(ID, { total: 2 }, NOW)).toBe(false);
  });

  it("无存储时保留 session 与累计额度的且语义", async () => {
    const store = new CooldownStore(undefined, KEY);
    store.record(ID, { total: 2, session: 3 }, NOW);
    await store.hydrate();
    expect(store.canShow(ID, { total: 2, session: 3 }, NOW)).toBe(true);
    store.record(ID, { total: 2, session: 3 }, NOW);
    expect(store.canShow(ID, { total: 2, session: 3 }, NOW)).toBe(false);
    store.record(OTHER, { session: 1 }, NOW);
    expect(store.canShow(OTHER, { session: 1 }, NOW)).toBe(false);
  });

  it.each(["__proto__", "constructor", "toString"])("特殊 id %s 的存储往返保留额度", async (id) => {
    let disk: string | null = null;
    const storage = {
      get: () => disk,
      set: (_key: string, value: string) => {
        disk = value;
      },
    };
    const first = new CooldownStore(storage, KEY);
    await first.hydrate();
    first.record(id, { total: 1 }, NOW);
    expect(Object.hasOwn(JSON.parse(disk!), id)).toBe(true);
    const second = new CooldownStore(storage, KEY);
    await second.hydrate();
    expect(second.canShow(id, { total: 1 }, NOW)).toBe(false);
  });
});

describe("本地日历桶与广播合并", () => {
  it("新旧桶标签在固定随机时间戳与日历边界上完全一致", () => {
    const script = `
      import assert from 'node:assert/strict';
      const { CooldownStore } = await import(${JSON.stringify(SOURCE_URL.href)});
      /** 保留旧实现的补零规则作为参照。 */
      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      /** 保留旧实现的本地日桶计算。 */
      function dayBucketOf(t) {
        const d = new Date(t);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      }
      /** 保留旧实现的嵌套小时桶计算。 */
      function hourBucketOf(t) { return dayBucketOf(t) + 'T' + pad(new Date(t).getHours()); }
      /** 保留旧实现的嵌套分钟桶计算。 */
      function minuteBucketOf(t) { return hourBucketOf(t) + ':' + pad(new Date(t).getMinutes()); }
      const times = [
        '2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z',
        '2026-11-01T05:50:00Z', '2026-11-01T06:10:00Z',
        '2024-02-28T23:59:59Z', '2024-02-29T00:00:00Z',
        '2024-02-29T23:59:59Z', '2024-03-01T00:00:00Z',
        '2026-01-31T23:59:59Z', '2026-02-01T00:00:00Z',
        '2026-12-31T23:59:59Z', '2027-01-01T00:00:00Z'
      ].map(value => Date.parse(value));
      const start = Date.UTC(1900, 0, 1);
      const span = Date.UTC(2200, 0, 1) - start;
      let seed = 0x12345678;
      for (let i = 0; i < 2048; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        times.push(start + Math.floor(seed / 4294967296 * span));
      }
      const store = new CooldownStore(undefined, ${JSON.stringify(KEY)});
      for (const now of times) {
        const rec = store.record(${JSON.stringify(ID)}, { total: 1 }, now);
        assert.deepEqual(
          [rec.dayBucket, rec.hourBucket, rec.minuteBucket],
          [dayBucketOf(now), hourBucketOf(now), minuteBucketOf(now)],
          '时间戳 ' + now
        );
      }
    `;
    for (const timezone of ["UTC", DST_TZ, "Asia/Kathmandu", "Australia/Lord_Howe"]) {
      expect(() =>
        execFileSync(process.execPath, [...NODE_TYPE_ARGS, script], {
          env: { ...process.env, TZ: timezone },
          encoding: "utf8",
          timeout: CHILD_TIMEOUT_MS,
        }),
      ).not.toThrow();
    }
  });

  it.each([
    [new Date(2026, 0, 31, 23, 59), new Date(2026, 1, 1)],
    [new Date(2024, 1, 28, 23, 59), new Date(2024, 1, 29)],
    [new Date(2024, 1, 29, 23, 59), new Date(2024, 2, 1)],
    [new Date(2026, 11, 31, 23, 59), new Date(2027, 0, 1)],
  ])("跨越 %s 到 %s 后日时分额度一起重置", async (before, after) => {
    const store = new CooldownStore(undefined, KEY);
    await store.hydrate();
    const cooldown = { day: 1, hour: 1, minute: 1 };
    store.record(ID, cooldown, before.getTime());
    expect(store.canShow(ID, cooldown, before.getTime())).toBe(false);
    expect(store.canShow(ID, cooldown, after.getTime())).toBe(true);
    store.record(ID, cooldown, after.getTime());
    expect(store.canShow(ID, cooldown, after.getTime())).toBe(false);
    expect(store.canShow(ID, { total: 2 }, after.getTime())).toBe(false);
  });

  it.each([false, true])("广播乱序=%s且重复到达时保留最新桶与最大计数", async (reverse) => {
    const store = new CooldownStore(undefined, KEY);
    const source = new CooldownStore(undefined, KEY);
    await Promise.all([store.hydrate(), source.hydrate()]);
    const old = source.record(ID, { total: 9 }, new Date(2025, 11, 31, 23, 59).getTime())!;
    const recent = source.record(ID, { total: 9 }, NOW)!;
    const records = reverse ? [recent, old, recent] : [old, recent, old];
    for (const rec of records) store.mergeRemote(ID, rec);
    for (const cooldown of [{ total: 2 }, { day: 1 }, { hour: 1 }, { minute: 1 }]) {
      expect(store.canShow(ID, cooldown, NOW)).toBe(false);
    }
    store.mergeRemote(ID, { ...recent, total: 5, dayCount: 4, hourCount: 3, minuteCount: 2 });
    store.mergeRemote(ID, recent);
    for (const cooldown of [{ total: 5 }, { day: 4 }, { hour: 3 }, { minute: 2 }]) {
      expect(store.canShow(ID, cooldown, NOW)).toBe(false);
    }
  });

  it("广播接收后不受发送方对象后续修改影响", async () => {
    const store = new CooldownStore(undefined, KEY);
    await store.hydrate();
    const remote = record();
    store.mergeRemote(ID, remote);
    remote.total = 0;
    expect(store.canShow(ID, { total: 1 }, NOW)).toBe(false);
  });

  it("纽约 DST 回拨按时间戳选分钟桶，相同小时桶取最大计数", () => {
    const script = `
      const { CooldownStore } = await import(${JSON.stringify(SOURCE_URL.href)});
      const store = new CooldownStore(undefined, ${JSON.stringify(KEY)});
      await store.hydrate();
      const before = Date.parse('2026-11-01T05:50:00Z');
      const after = Date.parse('2026-11-01T06:10:00Z');
      const id = ${JSON.stringify(ID)};
      const old = store.record(id, { minute: 1 }, before);
      store.record(id, { minute: 1 }, after);
      store.mergeRemote(id, old);
      console.log(JSON.stringify({ hours: [new Date(before).getHours(), new Date(after).getHours()], minute: store.canShow(id, { minute: 1 }, after), hour: store.canShow(id, { hour: 2 }, after) }));
    `;
    const output = execFileSync(process.execPath, [...NODE_TYPE_ARGS, script], {
      env: { ...process.env, TZ: DST_TZ },
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
    });
    expect(JSON.parse(output)).toEqual({ hours: [1, 1], minute: false, hour: false });
  });
});
