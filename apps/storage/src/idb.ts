import { supported } from "./helper";
import { Memory } from "./memory";

// IndexedDB 持久层：**异步** API。
// - 不再维护全量内存镜像（避免数据常驻内存、利于 GC），每次操作直接走 IDB 事务。
// - 可用性以 helper 的 supported.indexedDB 为准；open 运行时失败（沙箱 iframe/隐私模式等）
//   会把 supported.indexedDB 置 false 并退回 MemoryStorage 兜底——此时已无 IDB 可用，数据驻留内存不可避免。

const STORE = "kv";

export class Idb {
  private name: string;
  private db?: Promise<IDBDatabase>;
  /** IndexedDB 不可用时的内存兜底；为真即走纯内存 */
  private mem?: Memory;

  constructor(name = "@codejoo/storage") {
    this.name = name;
    if (!supported.indexedDB) this.mem = new Memory();
  }

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
      console.warn("[storage] IndexedDB 不可用，已退回内存模式", err);
      supported.indexedDB = false; // 运行时不支持，同步给全局可用性标记
      this.mem = new Memory();
      this.db = undefined;
      return null;
    }
  }

  /** 统一入口：IDB 可用则在事务里执行 fn，否则走内存兜底 mem。fn 用 any 因 IDBRequest<T> 含 this 类型而不变型 */
  private async op<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<any>, mem: () => T): Promise<T> {
    const db = await this.database();
    if (!db) return mem();
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  async get(key: string): Promise<string | null> {
    const v = await this.op<string | undefined>(
      "readonly",
      (s) => s.get(key),
      () => this.mem!.get(key),
    );
    return v ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.op(
      "readwrite",
      (s) => s.put(value, key),
      () => this.mem!.set(key, value),
    );
  }

  async remove(key: string): Promise<void> {
    await this.op(
      "readwrite",
      (s) => s.delete(key),
      () => this.mem!.remove(key),
    );
  }

  async clear(): Promise<void> {
    await this.op(
      "readwrite",
      (s) => s.clear(),
      () => this.mem!.clear(),
    );
  }

  length(): Promise<number> {
    return this.op(
      "readonly",
      (s) => s.count(),
      () => this.mem!.length,
    );
  }

  /** 批量读：单事务完成（proxy 批量 get / purge 据此走快路径，免 N 次事务开销） */
  async getMany(keys: readonly string[]): Promise<(string | null)[]> {
    const db = await this.database();
    if (!db) return keys.map((k) => this.mem!.get(k) as string | null);
    return new Promise((resolve, reject) => {
      const s = db.transaction(STORE, "readonly").objectStore(STORE);
      const out = Array.from<string | null>({ length: keys.length });
      let left = keys.length;
      if (!left) return resolve(out);
      keys.forEach((k, i) => {
        const r = s.get(k);
        r.onsuccess = () => {
          out[i] = (r.result as string | undefined) ?? null;
          if (--left === 0) resolve(out);
        };
        r.onerror = () => reject(r.error);
      });
    });
  }

  /** 批量写：单事务原子完成 */
  async setMany(entries: readonly (readonly [string, string])[]): Promise<void> {
    const db = await this.database();
    if (!db) {
      for (const [k, v] of entries) this.mem!.set(k, v);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      for (const [k, v] of entries) s.put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** 批量删：单事务原子完成 */
  async removeMany(keys: readonly string[]): Promise<void> {
    const db = await this.database();
    if (!db) {
      for (const k of keys) this.mem!.remove(k);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      for (const k of keys) s.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** 一次事务返回全部键（proxy 的 clear/keys/purge 据此走快路径，免逐下标 O(n²)） */
  async keys(): Promise<string[]> {
    const ks = await this.op<IDBValidKey[] | string[]>(
      "readonly",
      (s) => s.getAllKeys(),
      () => this.mem!.keys(),
    );
    return ks.map(String);
  }

  async key(index: number): Promise<string | null> {
    index = Math.trunc(index) || 0;
    if (index < 0) return null;
    // 只取前 index+1 个键，避免为拿一个键拉回全量键集；内存兜底直接按下标取
    const keys = await this.op<IDBValidKey[] | string | null>(
      "readonly",
      (s) => s.getAllKeys(null, index + 1),
      () => this.mem!.key(index),
    );
    return Array.isArray(keys) ? (index < keys.length ? String(keys[index]) : null) : keys;
  }

  /**
   * 释放资源：关闭已打开的 IndexedDB 连接并丢弃句柄，断开内存兜底引用，便于 GC 回收。
   * **不删除已落盘数据**（如需清空请用 clear）。关闭后再次调用任意方法会按需重新 open。
   */
  async destroy(): Promise<void> {
    const opened = this.db;
    this.db = undefined;
    this.mem = undefined;
    if (opened) {
      try {
        (await opened).close();
      } catch {
        // 连接 open 失败（已退回内存模式等），无需关闭
      }
    }
  }
}
