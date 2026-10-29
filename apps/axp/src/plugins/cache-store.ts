import type { AxpFailureType } from "../response";

/** 可能同步也可能异步的返回值。
 * @example `const count: MaybePromise<number> = Promise.resolve(1)`
 */
export type MaybePromise<T> = T | Promise<T>;

/** 可序列化的响应数据；业务数据与扩展字段应由调用方保证可序列化。
 * @example `const snapshot: IAxpCacheSnapshot = { status: 200, code: 0, message: '', data: 'ok' }`
 */
export interface IAxpCacheSnapshot {
  /** 原始 HTTP 状态。 */
  status: number;
  /** 业务码。 */
  code?: string | number;
  /** 响应消息。 */
  message?: string | null;
  /** 业务数据。 */
  data: unknown;
  /** 细分原因。 */
  reason?: string;
  /** 内核失败类别。 */
  failure?: AxpFailureType;
  /** 自有可枚举的扩展数据字段，无扩展时省略。 */
  extra?: Record<string, unknown>;
}

/** 默认内存容量。 */
const DEFAULT_MAX = 500;
/** 有限有效期条目的最小清扫间隔；实际间隔取它与当前条目数的较大者，容量不限时也不会无界增长，且摊销后每次写入仍是常数。 */
const SWEEP_INTERVAL = 64;

/**
 * 缓存条目，只保存响应快照。
 * @example `const entry: IAxpCacheEntry = { snapshot: { status: 200, code: 0, message: '', data: 'ok' }, expiresAt: Infinity }`
 */
export interface IAxpCacheEntry {
  /** 缓存快照。 */
  snapshot: IAxpCacheSnapshot;
  /** 绝对过期时间（毫秒），等于当前时间即过期。 */
  expiresAt: number;
}

/**
 * 同步或异步缓存仓；size 可包含尚未惰性清理的过期条目。
 * @example `const store: IAxpCacheStore = createMemoryStore()`
 */
export interface IAxpCacheStore {
  /** 读取条目。
   * @param key 缓存键。
   * @returns 条目或 undefined，可异步返回。
   * @example `await store.get('pets')`
   */
  get(key: string): MaybePromise<IAxpCacheEntry | undefined>;
  /** 写入条目。
   * @param key 缓存键。
   * @param entry 纯数据快照与过期时间。
   * @returns 写入完成，可异步返回。
   * @example `await store.set('pets', entry)`
   */
  set(key: string, entry: IAxpCacheEntry): MaybePromise<void>;
  /** 删除条目。
   * @param key 缓存键。
   * @returns 是否存在，可异步返回。
   * @example `await store.delete('pets')`
   */
  delete(key: string): MaybePromise<boolean>;
  /** 清空条目。
   * @returns 清掉的条数；不返回时插件取清空前 size，两者均无时计零。
   * @example `await store.clear()`
   */
  clear(): MaybePromise<number | void>;
  /** 当前物理条目数，异步存储可以省略。 */
  readonly size?: number;
}

/**
 * 内存仓配置。
 * @example const options: IAxpMemoryStoreOptions = { max: 10, now: Date.now };
 */
export interface IAxpMemoryStoreOptions {
  /** 容量默认 500；小于 1 或 NaN 回退默认值；Infinity 不限。 */
  max?: number;
  /** 当前绝对时间，默认 Date.now。 */
  now?: () => number;
}

/**
 * 创建独立的同步 LRU 仓。读时删除过期项；过期项的全表清扫有两个节流触发：
 * 写入超容量时按容量节流（每 max 次溢出写入最多扫一次），有限有效期的条目每写入 64 次也扫一次。
 * 写入超容量时再淘汰最久未用的条目。
 * @param options 容量和时钟配置。
 * @returns 同步快照缓存仓，不拷贝业务数据。
 * @example `const store = createMemoryStore({ max: 2 })`
 */
export function createMemoryStore(options: IAxpMemoryStoreOptions = {}) {
  const requestedMax = options.max ?? DEFAULT_MAX;
  const max = requestedMax >= 1 ? requestedMax : DEFAULT_MAX;
  const now = options.now ?? Date.now;
  const entries = new Map<string, IAxpCacheEntry>();
  /** 上次清扫后的溢出写入次数；初始即到期，首次溢出必扫。 */
  let overflowsSinceSweep = Infinity;
  /** 上次清扫后有限有效期条目的写入次数。 */
  let finiteWritesSinceSweep = 0;
  /** 下次清扫前要累计的写入次数：取最小间隔与上次清扫后条目数的较大者，清扫代价 O(size) 摊销到每次写入仍是常数。 */
  let sweepThreshold = SWEEP_INTERVAL;
  /** 扫掉全部过期项，并重置两个节流计数。 */
  function sweep(): void {
    overflowsSinceSweep = 0;
    finiteWritesSinceSweep = 0;
    const timestamp = now();
    for (const [cachedKey, cachedEntry] of entries) {
      if (!(cachedEntry.expiresAt > timestamp)) entries.delete(cachedKey);
    }
    sweepThreshold = Math.max(SWEEP_INTERVAL, entries.size);
  }
  return {
    /** 命中提升为最近使用；到期立即删除。 */
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (!(entry.expiresAt > now())) return undefined;
      entries.set(key, entry);
      return entry;
    },
    /** 替换也提升顺序；按节流清扫过期项，溢出时再淘汰最久未用的条目。 */
    set(key: string, entry: IAxpCacheEntry) {
      entries.delete(key);
      entries.set(key, entry);
      if (entry.expiresAt !== Infinity && ++finiteWritesSinceSweep >= sweepThreshold) sweep();
      if (entries.size <= max) return;
      // 满载时每次写入都会溢出，不节流就等于每次写入全表扫描
      if (++overflowsSinceSweep >= max) sweep();
      while (entries.size > max) {
        entries.delete(entries.keys().next().value!);
      }
    },
    /** 返回实际删除结果。 */
    delete(key: string) {
      return entries.delete(key);
    },
    /** 清空物理条目。 */
    clear() {
      const count = entries.size;
      entries.clear();
      return count;
    },
    /** 获取物理条目数，不扫描过期项。 */
    get size() {
      return entries.size;
    },
  };
}

/**
 * 发起请求时领到的票据：全局递增的序号，只交回产生它的屏障使用。
 * @example const ticket: TFreshnessTicket = barrier.begin('key');
 */
export type TFreshnessTicket = number;

/** 每个键合并保存的写入屏障与在途计数。 */
interface IKeyFreshness {
  /** 已成功登记的最大写入序号。 */
  latest: number;
  /** 在途请求数量，归零即回收记录。 */
  pending: number;
}

/**
 * 新鲜度屏障；调用方在 finally 中 end，没有在途请求的键随之回收。
 * clear 只更新屏障，调用方仍须清空实际缓存仓。
 * @example const barrier: IAxpFreshnessBarrier = createFreshnessBarrier();
 */
export interface IAxpFreshnessBarrier {
  /** 登记在途并返回票据。 */
  begin(key: string): TFreshnessTicket;
  /** 票据晚于最近一次清理、且比该键已写入的序号新才允许写入。 */
  canWrite(key: string, ticket: TFreshnessTicket): boolean;
  /** 成功写入后登记序号，过时票据无效。 */
  markWritten(key: string, ticket: TFreshnessTicket): void;
  /** 每次 begin 必须恰好结束一次；该键在途归零时回收记录，无记录时为空操作。 */
  end(key: string): void;
  /** 使此前发出的全部票据失效。 */
  clear(): void;
}

/**
 * 创建顺序屏障，确保 LRU 淘汰后旧请求仍不能写回。
 * @returns 独立的序号、清理下界和键状态。
 * @example const barrier = createFreshnessBarrier(); const ticket = barrier.begin('key');
 */
export function createFreshnessBarrier(): IAxpFreshnessBarrier {
  let seq = 0;
  /** 最近一次 clear 时已发出的最大序号；不大于它的票据一律作废。 */
  let floor = 0;
  const keys = new Map<string, IKeyFreshness>();
  return {
    /** 发起顺序全局递增。 */
    begin(key) {
      const state = keys.get(key) ?? { latest: 0, pending: 0 };
      state.pending++;
      keys.set(key, state);
      return ++seq;
    },
    /** 无记录时以零为写入下界。 */
    canWrite(key, ticket) {
      return ticket > floor && ticket > (keys.get(key)?.latest ?? 0);
    },
    /** 防御过时或重复登记，不降低屏障。 */
    markWritten(key, ticket) {
      const state = keys.get(key);
      if (state && ticket > state.latest) state.latest = ticket;
    },
    /** 在途期间保留最大已写入序号，防止淘汰后的旧值复活；归零后之后发起的票据序号必然更大，记录无需保留。 */
    end(key) {
      const state = keys.get(key);
      if (state && --state.pending === 0) keys.delete(key);
    },
    /** 只抬高下界，在途计数原样保留，避免旧请求结束时误删新记录。 */
    clear() {
      floor = seq;
    },
  };
}
