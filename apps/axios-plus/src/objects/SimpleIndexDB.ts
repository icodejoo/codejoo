import type { ICacheStorage } from '../plugins/cache/types';


export interface ISimpleIndexDBOptions {
    /** 数据库名；默认 `http-plugins-cache` */
    dbName?: string;
    /** object store 名；默认 `kv` */
    storeName?: string;
    /** 数据库版本；默认 `1` */
    version?: number;
}


/**
 * 极简 IndexedDB 适配器 —— 实现 [ICacheStorage]。
 *
 *   - 单 object store，外部传入的 string key 直接作为 IDB 主键
 *   - 仅在 `onupgradeneeded` 创建 store；不做版本迁移 / 数据格式校验
 *   - 失败一律抛出（IDBRequest.onerror）；调用方 / `StorageManager` 负责兜底
 *
 * **DB 连接懒打开 + 缓存**：首次 CRUD 触发 `indexedDB.open`；resolve 后把 `IDBDatabase`
 * 句柄存为字段（不仅是 promise），后续 CRUD 走**同步快路径**直接 `db.transaction(...)`，
 * 省一次 `await Promise.resolve` 的 microtask 跳变。
 *
 * **为什么不能把 transaction / store 也缓存到初始化阶段**：IDB 的 transaction 在事件
 * 循环返回时会自动 commit，object store 句柄随之失效。每次操作必须新建 transaction
 * 然后拿 store —— 这是 IDB 的协议规定，不是实现可优化的点。
 */
export default class SimpleIndexDB implements ICacheStorage {
    /** IDB 自带 structured clone —— 直接收发对象，让 StorageManager 跳过 JSON 序列化 */
    readonly raw = true;

    readonly #dbName: string;
    readonly #storeName: string;
    readonly #version: number;
    /** 已就绪的 DB 句柄（首次 open resolve 后赋值，提供同步快路径） */
    #db?: IDBDatabase;
    /** 进行中的 open promise —— 并发首次访问时去重 */
    #opening?: Promise<IDBDatabase>;

    constructor(opts: ISimpleIndexDBOptions = {}) {
        this.#dbName = opts.dbName ?? 'http-plugins-cache';
        this.#storeName = opts.storeName ?? 'kv';
        this.#version = opts.version ?? 1;
    }

    getItem(key: string): Promise<unknown> {
        return this.#op('readonly', (s) => s.get(key));
    }

    async setItem(key: string, value: unknown): Promise<void> {
        await this.#op('readwrite', (s) => s.put(value, key));
    }

    async removeItem(key: string): Promise<void> {
        await this.#op('readwrite', (s) => s.delete(key));
    }

    async clear(): Promise<void> {
        await this.#op('readwrite', (s) => s.clear());
    }

    /**
     * 单次操作：拿 store + 包 IDBRequest → Promise。
     *   - **热路径**：DB 已就绪 ⇒ 同步开 transaction，**零闭包分配**
     *   - **冷路径**：首次 / 并发首批访问 ⇒ 等 `#open()` resolve 后开 transaction，
     *     仅 `.then` 必需的一个闭包
     */
    #op<T>(
        mode: IDBTransactionMode,
        fn: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        const sn = this.#storeName;
        if (this.#db) {
            return $promisify(fn(this.#db.transaction(sn, mode).objectStore(sn)));
        }
        return this.#open().then((db) =>
            $promisify(fn(db.transaction(sn, mode).objectStore(sn))),
        );
    }

    #open(): Promise<IDBDatabase> {
        if (this.#opening) return this.#opening;
        return (this.#opening = new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(this.#dbName, this.#version);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(this.#storeName)) {
                    db.createObjectStore(this.#storeName);
                }
            };
            req.onsuccess = () => {
                this.#db = req.result;
                resolve(req.result);
            };
            req.onerror = () => reject(req.error);
        }));
    }
}


function $promisify<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
