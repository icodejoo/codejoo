import { supported } from "./helper";
import { Memory } from "./memory";

// IndexedDB 持久层：**异步** API。
// - 不再维护全量内存镜像（避免数据常驻内存、利于 GC），每次操作直接走 IDB 事务。
// - 可用性以 helper 的 supported.indexedDB 为准；open 运行时失败（沙箱 iframe/隐私模式等）
//   会把 supported.indexedDB 置 false 并退回 MemoryStorage 兜底——此时已无 IDB 可用，数据驻留内存不可避免。

const STORE = "kv";

export class IdbStorage {
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
      req.onsuccess = () => resolve(req.result);
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

  private request<T>(
    db: IDBDatabase,
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(key: string): Promise<string | null> {
    key = String(key);
    const db = await this.database();
    if (!db) return this.mem!.get(key);
    const v = await this.request<string | undefined>(db, "readonly", (s) => s.get(key));
    return v ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    key = String(key);
    const db = await this.database();
    if (!db) {
      this.mem!.set(key, value);
      return;
    }
    await this.request(db, "readwrite", (s) => s.put(value, key));
  }

  async remove(key: string): Promise<void> {
    key = String(key);
    const db = await this.database();
    if (!db) {
      this.mem!.remove(key);
      return;
    }
    await this.request(db, "readwrite", (s) => s.delete(key));
  }

  async clear(): Promise<void> {
    const db = await this.database();
    if (!db) return this.mem!.clear();
    await this.request(db, "readwrite", (s) => s.clear());
  }

  async length(): Promise<number> {
    const db = await this.database();
    if (!db) return this.mem!.length;
    return this.request<number>(db, "readonly", (s) => s.count());
  }

  async key(index: number): Promise<string | null> {
    const db = await this.database();
    if (!db) return this.mem!.key(index);
    index = Math.trunc(index) || 0;
    if (index < 0) return null;
    const keys = await this.request<IDBValidKey[]>(db, "readonly", (s) => s.getAllKeys());
    return index < keys.length ? String(keys[index]) : null;
  }
}
