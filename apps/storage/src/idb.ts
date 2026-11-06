import { supported } from "./helper";
import { Memory } from "./memory";

// IndexedDB 持久层：**异步** API。
// - 不再维护全量内存镜像（避免数据常驻内存、利于 GC），每次操作直接走 IDB 事务。
// - 打开失败只影响本实例，按退避窗口重新尝试；退避期间使用同库同表共享的内存。

const STORE = "kv";
/** 初次失败后等待一秒，连续失败指数退避到三十秒。 */
const RETRY_MIN = 1000;
/** 连续打开失败的最大退避时间。 */
const RETRY_MAX = 30_000;
/** 按数据库名、对象仓库名隔离的共享兜底后端。 */
const fallbacks = /*#__PURE__*/ new Map<string, Memory>();
/** 同名数据库共享 Hub 身份，真实连接仍由各实例独立管理。 */
const areas = /*#__PURE__*/ new Map<string, object>();

/** 取得同库同表唯一的兜底，避免并发失败互相覆盖。 */
function fallback(name: string): Memory {
  let mem = fallbacks.get(name);
  if (!mem) fallbacks.set(name, (mem = new Memory()));
  return mem;
}

/** 显式 abort 时事务和请求都可能没有 error。 */
function abortError(tx: IDBTransaction, req: IDBRequest): DOMException {
  return tx.error ?? req.error ?? new DOMException("Transaction aborted", "AbortError");
}

/**
 * IndexedDB 持久层（异步），传给 `factory({ db })` 作为 `db` 后端。
 * 不可用时（沙箱 iframe/隐私模式等）自动退回内存兜底。
 *
 * ```ts
 * const { db } = factory({ db: new Idb() });
 * await db.set("k", 1);
 * ```
 */
export class Idb {
  /** 同库处理器的 memo 失效身份。 */
  readonly area: object;
  /** 后端类型；内存兜底期间仍保留 IndexedDB 的身份。 */
  readonly kind = "idb";
  /** 数据库名 */
  private name: string;
  /** 已打开（或打开中）的连接句柄；连接断开后置空，下次操作重新 open */
  private db?: Promise<IDBDatabase>;
  /** IndexedDB 不可用时的共享内存兜底。 */
  private mem?: Memory;
  /** 下一次允许重新打开的时间；无后台定时器。 */
  private retryAt = 0;
  /** 当前失败的退避时长，成功打开后归零。 */
  private retryDelay = 0;
  /** 独立于连接句柄去重；destroy 在途时仍记录打开失败。 */
  private failedOpen?: Promise<IDBDatabase>;

  /**
   * @param name 数据库名，默认 `"@codejoo/storage"`；不同名称互相隔离
   */
  constructor(name = "@codejoo/storage") {
    this.name = name;
    let area = areas.get(name);
    if (!area) areas.set(name, (area = {}));
    this.area = area;
    if (!supported.indexedDB) this.mem = fallback(name);
  }

  /** 打开数据库并挂连接断开回调 */
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        // 连接被外部关闭（其他标签页版本升级、浏览器存储驱逐）时丢弃缓存句柄，
        // 否则后续 transaction 永远抛 InvalidStateError；置空后下次操作自动重新 open
        db.onversionchange = () => {
          db.close();
          this.db = undefined;
        };
        db.onclose = () => {
          this.db = undefined;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** 取数据库；open 运行时失败则退回内存兜底。返回 null 表示走 mem。 */
  private async database(): Promise<IDBDatabase | null> {
    if (!supported.indexedDB || Date.now() < this.retryAt) {
      this.mem ??= fallback(this.name);
      return null;
    }
    const opened = (this.db ??= this.open());
    try {
      const db = await opened;
      this.retryDelay = 0;
      this.retryAt = 0;
      this.failedOpen = undefined;
      return db;
    } catch (err) {
      if (this.failedOpen !== opened) {
        this.failedOpen = opened;
        if (this.db === opened) this.db = undefined;
        this.retryDelay = Math.min(this.retryDelay * 2 || RETRY_MIN, RETRY_MAX);
        this.retryAt = Date.now() + this.retryDelay;
        console.warn(`[storage] IndexedDB unavailable; memory fallback, retry in ${this.retryDelay}ms`, err);
      }
      this.mem ??= fallback(this.name);
      return null;
    }
  }

  /**
   * 统一入口：IDB 可用则在事务里执行 fn，否则走内存兜底 mem。fn 用 any 因 IDBRequest<T> 含 this 类型而不变型。
   * 以事务 complete 为成功标志：写事务可能在 request 成功后仍因配额等原因 abort 回滚。
   */
  private async op<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<any>, mem: () => T): Promise<T> {
    const db = await this.database();
    if (!db) return mem();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onabort = () => reject(abortError(tx, req));
    });
  }

  /**
   * 读取单个键。
   * @param key 存储键
   * @returns 字符串值；不存在为 null
   */
  async get(key: string): Promise<string | null> {
    const v = await this.op<string | undefined>(
      "readonly",
      (s) => s.get(key),
      () => this.mem!.get(key),
    );
    return v ?? null;
  }

  /**
   * 写入单个键，事务提交后才 resolve（失败则 reject）。
   * @param key 存储键
   * @param value 字符串值
   */
  async set(key: string, value: string): Promise<void> {
    await this.op(
      "readwrite",
      (s) => s.put(value, key),
      () => this.mem!.set(key, value),
    );
  }

  /**
   * 在单个事务内同步读取并条件更新。
   * @param key 存储键
   * @param fn 同步纯函数；字符串写入，null 删除，undefined 保持；禁止 Promise 或 IO
   * @returns 提交后的字符串值，不存在为 null；回调抛错或事务失败则 reject
   */
  async update(key: string, fn: (current: string | null) => string | null | undefined): Promise<string | null> {
    const db = await this.database();
    if (!db) {
      const current = this.mem!.get(key) as string | null;
      const next = fn(current);
      if (next === null) this.mem!.remove(key);
      else if (next !== undefined) this.mem!.set(key, next);
      return next === undefined ? current : next;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      let req: IDBRequest = store.get(key);
      let result: string | null = null;
      let callbackError: unknown;
      let callbackFailed = false;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(callbackFailed ? callbackError : abortError(tx, req));
      req.onsuccess = () => {
        try {
          const current = req.result as string | undefined;
          const next = fn(current ?? null);
          result = next === undefined ? (current ?? null) : next;
          if (next === null) req = store.delete(key);
          else if (next !== undefined) req = store.put(next, key);
        } catch (error) {
          callbackFailed = true;
          callbackError = error;
          tx.abort();
        }
      };
    });
  }

  /**
   * 删除单个键。
   * @param key 存储键
   */
  async remove(key: string): Promise<void> {
    await this.op(
      "readwrite",
      (s) => s.delete(key),
      () => this.mem!.remove(key),
    );
  }

  /** 清空整个库 */
  async clear(): Promise<void> {
    await this.op(
      "readwrite",
      (s) => s.clear(),
      () => this.mem!.clear(),
    );
  }

  /** 键总数 */
  length(): Promise<number> {
    return this.op(
      "readonly",
      (s) => s.count(),
      () => this.mem!.length,
    );
  }

  /**
   * 一次事务返回全部键（proxy 的 clear/keys/purge 据此走快路径，免逐下标 O(n²)）
   * @returns 全部键名
   */
  async keys(): Promise<string[]> {
    const ks = await this.op<IDBValidKey[] | string[]>(
      "readonly",
      (s) => s.getAllKeys(),
      () => this.mem!.keys(),
    );
    return ks.map(String);
  }

  /**
   * 按下标取键。
   * @param index 下标（向零取整，NaN 视为 0）
   * @returns 键名；越界为 null
   */
  async key(index: number): Promise<string | null> {
    index = Math.trunc(index) || 0;
    if (index < 0) return null;
    // 只取前 index+1 个键，避免为拿一个键拉回全量键集；内存兜底直接按下标取
    const keys = await this.op<IDBValidKey[] | string | null>(
      "readonly",
      (s) => s.getAllKeys(null, index + 1),
      () => this.mem!.key(index),
    );
    // 本库写入的键恒为字符串，getAllKeys 取回的 IDBValidKey 即字符串；String() 仅为类型收口
    // oxlint-disable-next-line typescript/no-base-to-string
    return Array.isArray(keys) ? (index < keys.length ? String(keys[index]) : null) : keys;
  }

  /**
   * 释放资源：关闭已打开的 IndexedDB 连接并丢弃句柄，便于 GC 回收。
   * **不删除已落盘数据**（如需清空请用 clear）。关闭后再次调用任意方法会按需重新 open。
   * 注意：不清空 `mem`——IndexedDB 不可用时它就是数据本身（唯一存储层），不是可丢弃的缓存/句柄。
   */
  async destroy(): Promise<void> {
    const opened = this.db;
    this.db = undefined;
    if (opened) {
      try {
        (await opened).close();
      } catch {
        // 连接 open 失败（已退回内存模式等），无需关闭
      }
    }
  }
}
