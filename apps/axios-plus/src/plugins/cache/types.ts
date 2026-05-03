import type { AxiosResponse } from "axios";
import type { MaybeFunc } from "../../helper";

/**
 * 缓存存储适配器（同步 / 异步通用）。
 *
 *   - **默认实现**：sessionStorage 直调 + key 前缀 + JSON 序列化 —— 不做任何环境探测 / 容错；
 *     SSR 等无 sessionStorage 环境请显式传入 `storage`
 *   - **自定义**：实现本接口即可适配 localStorage / IndexedDB / Redis 等任意存储
 *   - **Promise 兼容**：每个方法都允许返回 `Promise`，让 IndexedDB 等异步存储无缝接入
 *   - **键名透传**：插件层只把 `config.key` 当 raw key 传给 storage；前缀 / 命名空间由
 *     storage 自己决定（默认 sessionStorage 适配器内部加前缀）
 */
export interface ICacheStorage {
  /** 读：未命中返回 `undefined` / `null`；命中返回（可能已被 StorageManager 反序列化的）entry */
  getItem(key: string): unknown | Promise<unknown>;
  /** 写：value 由 StorageManager 决定形态 —— `raw:true` 时是 entry 对象，否则是 JSON 字符串 */
  setItem(key: string, value: unknown): void | Promise<void>;
  /** 删一条；不存在时也应静默成功 */
  removeItem(key: string): void | Promise<void>;
  /** 可选：清空整个 storage namespace，用于 `clearCache()` */
  clear?(): void | Promise<void>;
  /**
   * 适配器是否原生支持结构化数据。
   *   - `true`  ⇒ IDB / 内存 Map 这类天然能存对象 —— `StorageManager` 直接传 entry 对象，
   *     省去 `JSON.stringify` / `JSON.parse` 的开销
   *   - `false` / 缺省 ⇒ 只能存字符串（sessionStorage / localStorage / cookie 等），
   *     `StorageManager` 在 set 前 stringify、get 后 parse
   */
  raw?: boolean;
}

export type TCacheStorage =
  | ICacheStorage
  | "memeory"
  | "ssesionStorage"
  | "localStorage"
  | "indexdb";

/**
 * 业务级"要存什么"自定义钩子。
 *
 *   - 入参：原始 `AxiosResponse`（**未经 normalize 包装**，因为本插件运行在 normalize 之前）
 *   - 返回值：要写入缓存的载荷 —— 任意业务定义的可序列化结构
 *   - 返回 `null` / `undefined`：本响应跳过缓存（业务自己判定"不该缓存"）
 *   - 默认实现：`(resp) => resp.data` —— 整个响应体原样存
 *
 * 仅在 adapter `prev(config).then(...)` 的成功分支调用一次；命中缓存或错误路径不会调用。
 */
export type TCacheGiver = (response: AxiosResponse) => unknown;

export interface ICacheOptions {
  /**
   * 全局缓存默认开关；默认 `true`。
   *   - `true`  ⇒ `config.cache === undefined` 的请求按插件级 defaults 缓存
   *   - `false` ⇒ `config.cache === undefined` 的请求**不**缓存；只有显式
   *     `config.cache: true / 对象` 的请求才会被激活
   *
   * 不影响 install ——`enable:false` 仍会装上 adapter / 共享 storage manager，
   * 仅改变"无 per-request 配置时"的默认行为。
   */
  enable?: boolean;
  /** 默认 TTL（毫秒）；可由请求级 `config.cache.expires` 覆盖。默认 `60_000`。 */
  ttl?: number;
  /**
   * 允许缓存的 HTTP method 白名单（不区分大小写）。
   *   - 默认 `['get', 'head']` —— 仅幂等请求默认参与缓存
   *   - `'*'` / `['*']` / `[]` / `undefined` ⇒ 不限制 method（所有方法都参与）
   * @default ['get', 'head']
   */
  methods?: string[] | '*';
  /**
   * 自定义存储实现；不传则用默认 sessionStorage 适配器（无环境探测 —— 调用方自行保证可用）。
   */
  storage?: TCacheStorage;
  /**
   * 默认 background（stale-while-revalidate）模式：命中即返回，同时后台请求更新缓存。
   * 可由请求级 `config.cache.background` 覆盖。默认 `false`。
   */
  background?: boolean;
  /**
   * 默认内存层缓存：
   *   - `true`  → 命中查询顺序为 `内存 → storage → 请求`；storage 命中时回填内存；
   *     请求成功时同时回填内存与 storage
   *   - `false` → 仅用 storage（默认）
   * 可由请求级 `config.cache.memory` 覆盖。
   * @default false
   */
  memory?: boolean;
  /**
   * 自定义"要存什么"提取器；不传则默认 `(resp) => resp.data`。
   * 可由请求级 `config.cache.give` 覆盖。
   */
  give?: TCacheGiver;

  /**
   * Self-Test Timeout —— 自检间隔，单位为**毫秒**（与 `ttl` 一致）。
   *   - `0` / 未设 ⇒ 不启动自检
   *   - 自检用于扫描并删除过期数据（内存层 + storage 层）
   *   - 这是一个大概估值：内部用 `setInterval` 触发，每次跑用
   *     `requestIdleCallback` 调度，空闲时再扫，避免阻塞主线程
   */
  stt?: number;
}

/** @internal —— 解析后的请求级缓存配置 */
export interface IResolvedCache {
  ttl?: number;
  background?: boolean;
  memory?: boolean;
  give?: TCacheGiver;
}

/** @internal —— 存入 storage / memory 的 entry 形态（原样接口结果，不重组 response） */
export interface ICacheEntry {
  /** 过期绝对时间戳（ms） */
  expiresAt: number;
  /** 由 `give(response)` 提取的业务数据 —— 缓存 / 还原时不做任何包装 */
  data: unknown;
}

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * 响应缓存配置：
     *   - `false` / 未指定                              → 不缓存
     *   - `true`                                       → 启用，使用插件级 ttl / background / memory / get
     *   - `{ expires?, background?, memory?, get? }`   → 字段级覆盖
     *
     * **依赖**：缓存 key 由 `key` 插件统一生成（`config.key`），本插件不再自带 key 计算。
     */
    cache?: MaybeFunc<
      | boolean
      | {
          /** 设置过期时间,默认0ms-不过期 */
          ttl?: number;
          /** 是否后台跟新,默认false */
          background?: boolean;
          /** 是否使用内存缓存增强,默认false */
          memory?: boolean;
          /** 缓存数据提供者，返回要存储的数据，默认`return response.data; ` */
          give?: TCacheGiver;
        }
    >;
    /** 缓存策略，必须实现ICacheStorage接口 */
    storage?: TCacheStorage;
  }

  interface AxiosResponse {
    /**
     * 标识本次响应来自 cache 插件命中。下游插件 / 业务可用此跳过冗余处理（如埋点、
     * 重复通知、状态恢复）。`undefined` 表示非缓存响应。
     */
    _cache?: boolean;
  }
}
