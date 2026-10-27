import { supported } from "./helper";
import { Memory } from "./memory";

// IndexedDB 持久层：**异步** API。
// - 不再维护全量内存镜像（避免数据常驻内存、利于 GC），每次操作直接走 IDB 事务。
// - 可用性以 helper 的 supported.indexedDB 为准；open 运行时失败（沙箱 iframe/隐私模式等）
//   会把 supported.indexedDB 置 false 并退回 MemoryStorage 兜底——此时已无 IDB 可用，数据驻留内存不可避免。

const STORE = "kv";

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
  /** 数据库名 */
  private name: string;
  /** 已打开（或打开中）的连接句柄；连接断开后置空，下次操作重新 open */
  private db?: Promise<IDBDatabase>;
  /** IndexedDB 不可用时的内存兜底；为真即走纯内存 */
  private mem?: Memory;

  /**
   * @param name 数据库名，默认 `"@codejoo/storage"`；不同名称互相隔离
   */
  constructor(name = "@codejoo/storage") {
    this.name = name;
    if (!supported.indexedDB) this.mem = new Memory();
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
    if (this.mem) return null;
    try {
      return await (this.db ??= this.open());
    } catch (err) {
      console.warn("[storage] IndexedDB unavailable, fell back to in-memory mode", err);
      supported.indexedDB = false; // 运行时不支持，同步给全局可用性标记
      this.mem ??= new Memory(); // 并发调用共享同一个失败的 open()，都会走到这里——不能每次都换一个新 Map，否则先写入的数据被孤立丢失
      this.db = undefined;
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
      tx.onabort = () => reject(tx.error ?? req.error); // request 出错未 preventDefault 会自动 abort 事务，只挂 onabort 即可
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
