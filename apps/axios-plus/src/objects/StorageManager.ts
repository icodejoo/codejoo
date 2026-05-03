import type {
    ICacheEntry,
    ICacheStorage,
    TCacheStorage,
} from '../plugins/cache/types';
import type { PluginLogger } from '../plugin/types';
import SimpleIndexDB from './SimpleIndexDB';


const KEY_PREFIX = 'http-plugins:cache:';
const PROBE_KEY = '__hp_probe__';

/** `TCacheStorage` 字符串字面量集合 —— 内部 switch 时收窄类型用 */
type TStorageKind = 'memeory' | 'ssesionStorage' | 'localStorage' | 'indexdb';


/* ── storage adapters ─────────────────────────────────────────────────── */

/** 进程内 Map 适配器；`raw:true` 让 StorageManager 跳过 JSON */
function $createMemoryStorage(): ICacheStorage {
    const m = new Map<string, unknown>();
    return {
        raw: true,
        getItem: (k) => m.get(k),
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
        clear: () => m.clear(),
    };
}

/**
 * Web Storage（sessionStorage / localStorage）适配器 —— 只能存字符串。
 *   - `raw` 缺省 ⇒ StorageManager 会在 set 前 stringify、get 后 parse
 *   - 不做环境探测 / 容错（工厂层已探针）
 *   - `clear()` 仅扫自家前缀
 *   - `getWs` 懒求值 ⇒ SSR / Node 中只有真正调方法时才解引用全局
 */
function $createWebStorage(getWs: () => Storage): ICacheStorage {
    return {
        getItem: (k) => getWs().getItem(KEY_PREFIX + k),
        setItem: (k, v) => getWs().setItem(KEY_PREFIX + k, v as string),
        removeItem: (k) => getWs().removeItem(KEY_PREFIX + k),
        clear() {
            const ws = getWs();
            const ks: string[] = [];
            for (let i = 0; i < ws.length; i++) {
                const x = ws.key(i);
                if (x && x.startsWith(KEY_PREFIX)) ks.push(x);
            }
            for (const k of ks) ws.removeItem(k);
        },
    };
}


/* ── support detection ────────────────────────────────────────────────── */

/**
 * 简单探针：尝试一次 set/remove，能跑通就视为可用。
 *   - 捕获 `undefined`（SSR / Node）/ 安全策略 / quota 等所有失败
 *   - 仅在 `$createNamedStorage` 工厂层调用一次（实例已缓存，不会反复探针）
 */
function $isWebStorageAvailable(kind: 'sessionStorage' | 'localStorage'): boolean {
    try {
        const g = globalThis as unknown as Record<string, Storage | undefined>;
        const ws = g[kind];
        if (!ws) return false;
        ws.setItem(PROBE_KEY, '1');
        ws.removeItem(PROBE_KEY);
        return true;
    } catch {
        return false;
    }
}

function $isIndexedDBAvailable(): boolean {
    try {
        return typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined';
    } catch {
        return false;
    }
}


/* ── named-storage factory ────────────────────────────────────────────── */

/**
 * 按字符串字面量构造 storage 实例 —— 内部带支持性探针：
 *   - 不可用 ⇒ `console.warn` 后回退到 memory 适配器
 *   - 调用方无需 try/catch；返回的 storage 一定可用
 *
 * @internal 仅 `StorageManager` 与 [resolveStorage] 用
 */
function $createNamedStorage(kind: TStorageKind): ICacheStorage {
    switch (kind) {
        case 'memeory':
            return $createMemoryStorage();
        case 'localStorage':
            if ($isWebStorageAvailable('localStorage')) {
                return $createWebStorage(() => localStorage);
            }
            console.warn('[StorageManager] localStorage 不可用，回退到 memory 适配器');
            return $createMemoryStorage();
        case 'indexdb':
            if ($isIndexedDBAvailable()) return new SimpleIndexDB();
            console.warn('[StorageManager] indexedDB 不可用，回退到 memory 适配器');
            return $createMemoryStorage();
        case 'ssesionStorage':
        default:
            if ($isWebStorageAvailable('sessionStorage')) {
                return $createWebStorage(() => sessionStorage);
            }
            console.warn('[StorageManager] sessionStorage 不可用，回退到 memory 适配器');
            return $createMemoryStorage();
    }
}


/**
 * 一次性把 `TCacheStorage`（字符串快捷方式 / 自定义对象 / undefined）解析为 `ICacheStorage`。
 *
 *   - `undefined` / `'ssesionStorage'` ⇒ sessionStorage 适配器（不可用回退 memory）
 *   - `'memeory'`                       ⇒ 进程内 Map 适配器
 *   - `'localStorage'`                  ⇒ localStorage 适配器（不可用回退 memory）
 *   - `'indexdb'`                       ⇒ [SimpleIndexDB]（不可用回退 memory）
 *   - 自定义 `ICacheStorage` 对象       ⇒ 原样返回
 *
 * **注意**：每次调用都会**新建**一个适配器实例。需要复用 / 内存层 / 自检请用 [StorageManager]。
 */
export function resolveStorage(s: TCacheStorage | undefined): ICacheStorage {
    if (s == null) return $createNamedStorage('ssesionStorage');
    if (typeof s !== 'string') return s;
    return $createNamedStorage(s as TStorageKind);
}


/* ── StorageManager ───────────────────────────────────────────────────── */

export interface IStorageManagerOptions {
    /** 默认 storage —— 字符串快捷方式或自定义实现；缺省 sessionStorage */
    storage?: TCacheStorage;
    /**
     * 自检间隔（毫秒）。`0` / 未设 ⇒ 不启动自检。
     * `setInterval` + `requestIdleCallback` 调度；只扫内存层，过期项按其
     * **写入时绑定的** storage 同步删磁盘 —— 不全量扫描磁盘。
     *
     * 副作用：仅写入内存层（`useMemory:true`）的条目能被自检清理；纯磁盘条目
     * 靠下一次 `get` 命中过期时被动清掉。
     */
    stt?: number;
    /** dev 日志（自检 / 错误） */
    logger?: PluginLogger;
}


/** 单次 CRUD 的可选参数 —— 允许请求级 storage 覆盖默认 */
export interface IStorageOpOptions {
    /** 请求级 storage 覆盖；不传则用 manager 的默认 storage */
    storage?: TCacheStorage;
    /** 是否使用内存层（命中 / 写回） */
    useMemory?: boolean;
}


/**
 * 缓存门面 —— 内存 + 磁盘双层 + 定时自检 + 序列化层。
 *
 *   - **per-call storage**：每次 `get / set / remove / clear` 都接受 `opts.storage`
 *     覆盖默认。字符串字面量按 kind 缓存实例 —— 同一 kind 在 manager 生命周期内只构造一次
 *   - **序列化在门面**：根据 `storage.raw` 决定是否 `JSON.stringify` —— IDB / 内存
 *     `raw:true` 时直接传对象，省去序列化损耗；Web Storage 由门面 stringify
 *   - **支持性探测**：构造命名 storage 时探针；不可用 `console.warn` + 回退 memory，
 *     CRUD 永远不会因为 storage 失效而抛错
 *   - **TTL**：entry 内 `expiresAt`，`get` 命中过期会顺手清掉
 *   - **定时清理**：`stt > 0` 启动 `setInterval` + `requestIdleCallback`，**只扫内存层**；
 *     过期项按其写入时绑定的 storage 同步删磁盘 —— 不做全量磁盘扫描
 */
export default class StorageManager {
    readonly #default?: TCacheStorage;
    /** 字符串 kind → 单实例缓存（`'memeory' / 'ssesionStorage' / ...`） */
    readonly #stringInstances = new Map<TStorageKind, ICacheStorage>();
    /**
     * 内存层 —— 同时充当自检索引：每条记录绑定写入时的 storage 实例，
     * 自检发现过期 ⇒ 用 `record.storage` 同步删磁盘对应 key（无需 `keys()` 全扫）
     */
    readonly #mem = new Map<string, { entry: ICacheEntry; storage: ICacheStorage }>();
    readonly #logger?: PluginLogger;
    #timer?: ReturnType<typeof setInterval>;

    constructor(opts: IStorageManagerOptions = {}) {
        this.#default = opts.storage;
        this.#logger = opts.logger;
        if (opts.stt && opts.stt > 0) {
            this.#timer = setInterval(() => this.#schedule(), opts.stt);
        }
    }

    /**
     * 解析 storage —— per-call 调用，但实例按 kind 缓存复用。
     *   - 入参 / 默认值是字符串字面量 ⇒ Map 缓存命中即复用，未命中则探针 + 创建
     *   - 自定义 `ICacheStorage` 对象 ⇒ 原样返回（caller 自管生命周期）
     *   - 都没有 ⇒ 走 `'ssesionStorage'` 默认分支
     */
    resolve(s?: TCacheStorage): ICacheStorage {
        const target = s ?? this.#default;
        if (target != null && typeof target !== 'string') return target;
        const kind = (target ?? 'ssesionStorage') as TStorageKind;
        let inst = this.#stringInstances.get(kind);
        if (!inst) {
            inst = $createNamedStorage(kind);
            this.#stringInstances.set(kind, inst);
        }
        return inst;
    }

    /**
     * 读：返回非过期 entry，未命中 / 过期返回 `null`。
     *   - `useMemory:true` ⇒ 先查内存层；未命中读 storage 后回填
     *   - 命中过期条目会顺手 `removeItem` 清掉，保持两层干净
     *   - storage 解析支持 `opts.storage` 覆盖
     */
    async get(
        key: string,
        opts?: IStorageOpOptions,
    ): Promise<ICacheEntry | null> {
        const useMem = opts?.useMemory;
        const now = Date.now();
        if (useMem) {
            const rec = this.#mem.get(key);
            if (rec) {
                if (rec.entry.expiresAt > now) return rec.entry;
                this.#mem.delete(key);
            }
        }
        const storage = this.resolve(opts?.storage);
        const raw = await storage.getItem(key);
        const entry = $deserialize(raw, storage);
        if (entry && entry.expiresAt > now) {
            if (useMem) this.#mem.set(key, { entry, storage });
            return entry;
        }
        if (entry) await storage.removeItem(key);
        return null;
    }

    /**
     * 写：始终写 storage；`useMemory:true` 时同步写内存层（绑定 storage 引用，自检要用）。
     *   - storage 是 `raw:true` 适配器 ⇒ 直接传 entry 对象
     *   - 否则 `JSON.stringify` 后传字符串
     */
    async set(
        key: string,
        entry: ICacheEntry,
        opts?: IStorageOpOptions,
    ): Promise<void> {
        const storage = this.resolve(opts?.storage);
        if (opts?.useMemory) this.#mem.set(key, { entry, storage });
        await storage.setItem(key, storage.raw ? entry : JSON.stringify(entry));
    }

    /** 删：内存层无条件清；storage 层按 `opts.storage` 解析 */
    async remove(key: string, opts?: IStorageOpOptions): Promise<void> {
        this.#mem.delete(key);
        await this.resolve(opts?.storage).removeItem(key);
    }

    /**
     * 清空：内存层无条件清；storage 层仅当实现了 `clear()` 时调用。
     * 返回 `true` = storage 也清了；`false` = 不支持 `clear()`
     */
    async clear(opts?: IStorageOpOptions): Promise<boolean> {
        this.#mem.clear();
        const storage = this.resolve(opts?.storage);
        if (typeof storage.clear !== 'function') return false;
        await storage.clear();
        return true;
    }

    /** 销毁：停止自检 + 清空内存层 */
    destroy(): void {
        if (this.#timer) clearInterval(this.#timer);
        this.#timer = undefined;
        this.#mem.clear();
    }

    /** 调度下一轮自检：有 `requestIdleCallback` 走空闲，否则直接同步回调 */
    #schedule(): void {
        const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
        if (ric) ric(() => void this.#runSelfTest());
        else void this.#runSelfTest();
    }

    /**
     * 自检：仅遍历内存索引。命中过期项 ⇒ 同步从其绑定的 storage 删除该 key —— 无需
     * 全量扫描磁盘。仅磁盘条目（`useMemory:false` 写入）不会被自检处理，靠下一次
     * `get` 命中过期时被动清理。
     */
    async #runSelfTest(): Promise<void> {
        const now = Date.now();
        let removed = 0;

        for (const [k, rec] of this.#mem) {
            if (rec.entry.expiresAt > now) continue;
            this.#mem.delete(k);
            try {
                await rec.storage.removeItem(k);
            } catch (err) {
                this.#logger?.error(
                    `[StorageManager] self-test storage.removeItem failed for "${k}"`,
                    err,
                );
            }
            removed++;
        }

        if (removed && this.#logger) {
            this.#logger.log(
                `[StorageManager] self-test cleaned ${removed} expired entries`,
            );
        }
    }
}


/** 反序列化 + 形态校验。`raw` 适配器直接验证；非 raw 走 `JSON.parse` */
function $deserialize(
    raw: unknown,
    storage: ICacheStorage,
): ICacheEntry | null {
    if (raw == null) return null;
    if (storage.raw) return $isEntry(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        return $isEntry(parsed) ? parsed : null;
    } catch {
        return null;
    }
}


function $isEntry(v: unknown): v is ICacheEntry {
    if (!v || typeof v !== 'object') return false;
    return typeof (v as ICacheEntry).expiresAt === 'number';
}
