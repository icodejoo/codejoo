/** 默认内存容量。 */
const DEFAULT_MAX = 500;

/**
 * 缓存条目，响应引用由调用方管理。
 * @example const entry: IAxpCacheEntry<string> = { response: 'ok', expiresAt: Infinity };
 */
export interface IAxpCacheEntry<R> {
  /** 缓存响应。 */
  response: R;
  /** 绝对过期时间（毫秒），等于当前时间即过期。 */
  expiresAt: number;
}

/**
 * 同步缓存仓；size 包含尚未惰性清理的过期条目。
 * @example const store: IAxpCacheStore<string> = createMemoryStore();
 */
export interface IAxpCacheStore<R> {
  /** 读取条目，过期返回 undefined。 */
  get(key: string): IAxpCacheEntry<R> | undefined;
  /** 写入条目。 */
  set(key: string, entry: IAxpCacheEntry<R>): void;
  /** 删除条目，返回是否存在。 */
  delete(key: string): boolean;
  /** 清空条目。 */
  clear(): void;
  /** 当前物理条目数。 */
  readonly size: number;
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
 * 创建独立的同步 LRU 仓。读时删除过期项；写入超容量时淘汰最久未用的条目，
 * 过期项的全表清扫按容量节流，每 max 次溢出写入最多扫一次。
 * @param options 容量和时钟配置。
 * @returns 泛型响应缓存仓，不拷贝响应。
 * @example const store = createMemoryStore<string>({ max: 2 });
 */
export function createMemoryStore<R>(options: IAxpMemoryStoreOptions = {}): IAxpCacheStore<R> {
  const requestedMax = options.max ?? DEFAULT_MAX;
  const max = requestedMax >= 1 ? requestedMax : DEFAULT_MAX;
  const now = options.now ?? Date.now;
  const entries = new Map<string, IAxpCacheEntry<R>>();
  /** 上次清扫后的溢出写入次数；初始即到期，首次溢出必扫。 */
  let overflowsSinceSweep = Infinity;
  return {
    /** 命中提升为最近使用；到期立即删除。 */
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (!(entry.expiresAt > now())) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    /** 替换也提升顺序；溢出时按节流清扫过期项，再淘汰最久未用的条目。 */
    set(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      if (entries.size <= max) return;
      // 满载时每次写入都会溢出，不节流就等于每次写入全表扫描
      if (++overflowsSinceSweep >= max) {
        overflowsSinceSweep = 0;
        const timestamp = now();
        for (const [cachedKey, cachedEntry] of entries) {
          if (!(cachedEntry.expiresAt > timestamp)) entries.delete(cachedKey);
        }
      }
      while (entries.size > max) {
        entries.delete(entries.keys().next().value!);
      }
    },
    /** 返回实际删除结果。 */
    delete(key) {
      return entries.delete(key);
    },
    /** 清空物理条目。 */
    clear() {
      entries.clear();
    },
    /** 获取物理条目数，不扫描过期项。 */
    get size() {
      return entries.size;
    },
  };
}

/**
 * 发起请求时的不可变票据；只交回产生它的屏障使用。
 * @example const ticket: IAxpFreshnessTicket = barrier.begin('key');
 */
export interface IAxpFreshnessTicket {
  /** 全局发起序号。 */
  readonly seq: number;
  /** 清理代次。 */
  readonly epoch: number;
}

/** 每个键合并保存的写入屏障与在途计数。 */
interface IKeyFreshness {
  /** 已成功登记的最大写入序号。 */
  latestSeq: number;
  /** 跨清理代次的在途数量。 */
  pending: number;
}

/**
 * 新鲜度屏障；调用方在 finally 中 end，并在条目淘汰及请求结束后 reclaim。
 * clear 只更新屏障，调用方仍须清空实际缓存仓。
 * @example const barrier: IAxpFreshnessBarrier = createFreshnessBarrier();
 */
export interface IAxpFreshnessBarrier {
  /** 登记在途并返回票据。 */
  begin(key: string): IAxpFreshnessTicket;
  /** 同代次且比已写入序号新才允许写入。 */
  canWrite(key: string, ticket: IAxpFreshnessTicket): boolean;
  /** 成功写入后登记序号，过时票据无效。 */
  markWritten(key: string, ticket: IAxpFreshnessTicket): void;
  /** 每次 begin 必须恰好结束一次；无在途时为空操作。 */
  end(key: string): void;
  /** 递增代次，使所有旧票据失效。 */
  clear(): void;
  /** 只有无在途且条目不在缓存时才回收记录。 */
  reclaim(key: string, entryStillCached: boolean): void;
}

/**
 * 创建顺序屏障，确保 LRU 淘汰后旧请求仍不能写回。
 * @returns 独立的序号、代次和键状态。
 * @example const barrier = createFreshnessBarrier(); const ticket = barrier.begin('key');
 */
export function createFreshnessBarrier(): IAxpFreshnessBarrier {
  let seq = 0;
  let epoch = 0;
  const keys = new Map<string, IKeyFreshness>();
  return {
    /** 发起顺序全局递增。 */
    begin(key) {
      const state = keys.get(key) ?? { latestSeq: 0, pending: 0 };
      state.pending++;
      keys.set(key, state);
      return { seq: ++seq, epoch };
    },
    /** 无状态时以零为写入下界。 */
    canWrite(key, ticket) {
      return ticket.epoch === epoch && ticket.seq > (keys.get(key)?.latestSeq ?? 0);
    },
    /** 防御过时或重复登记，不降低屏障。 */
    markWritten(key, ticket) {
      const state = keys.get(key);
      if (state && ticket.epoch === epoch && ticket.seq > state.latestSeq) {
        state.latestSeq = ticket.seq;
      }
    },
    /** 不自动回收，等待调用方确认实际缓存状态。 */
    end(key) {
      const state = keys.get(key);
      if (state && state.pending > 0) state.pending--;
    },
    /** 保留在途计数，避免跨代次结束误删新记录。 */
    clear() {
      epoch++;
    },
    /** 在途期间保留最大已写入序号，防止淘汰后的旧值复活。 */
    reclaim(key, entryStillCached) {
      const state = keys.get(key);
      if (state && state.pending === 0 && !entryStillCached) keys.delete(key);
    },
  };
}
