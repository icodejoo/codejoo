import type { Plugin, PluginLogger } from "../../plugin/types";
import {Type,  __DEV__, requirePlugin , lockName} from "../../helper";
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from "axios";
import type {
  ICacheOptions,
  IResolvedCache,
  ICacheEntry,
  ICacheStorage,
  TCacheGiver,
  TCacheStorage,
} from "./types";
import StorageManager, {
  resolveStorage,
  type IStorageOpOptions,
} from "../../objects/StorageManager";
import { name as keyName } from "../key";

export const name = "cache";

/** 默认 give：把整个 response.data 存下来 */
const DEFAULT_GIVE: TCacheGiver = (resp) => resp.data;

/**
 * 全局共享 StorageManager —— 跨所有 axios 实例 / 多次 `cache()` install 共用同一份缓存池。
 *   - 首次 install 时按当时 opts（storage / stt / logger）创建
 *   - 后续 install 复用既有实例，自身的 storage / stt / logger 入参被忽略
 *   - 进程级生命周期；不随 plugin eject 销毁
 */
let sharedManager: StorageManager | null = null;

/**
 * 默认 storage —— sessionStorage 适配器，统一走 [resolveStorage] 构造，保持单一来源。
 *
 * @internal exported for unit tests
 */
export function $createDefaultStorage(): ICacheStorage {
  return resolveStorage(undefined);
}

/**
 * 响应缓存插件 —— 装在 `key` 之后、`normalize` 之前。
 *
 *   - **adapter 包装**：命中 → `Promise.resolve(restoredResponse)`，不发 HTTP；未命中 → 走 prev
 *   - **give(response) 决定要存什么**：在 `prev(config).then(...)` 里调用，返回 `null/undefined`
 *     则跳过缓存；默认 `(resp) => resp.data`
 *   - **依赖 `key` 插件**：缓存 key 完全由 `config.key` 决定；缺失则 silent passthrough
 *   - **共享 StorageManager**：所有 axios 实例 / 多次 install 共用一份缓存池；首次 install 的
 *     `storage / stt / logger` 决定 manager；之后只用各自 install 的 ttl / methods / background /
 *     memory / give 作为请求级默认
 *   - **storage 字符串快捷方式**：`'memeory' / 'ssesionStorage' / 'localStorage' / 'indexdb'`
 *     （或自定义 `ICacheStorage`），默认 sessionStorage
 *   - **memory 双层缓存**：`memory: true` ⇒ 内存 → storage → 请求；命中回填、miss 双写
 *   - **TTL**：请求级 `ttl` > 插件级 `ttl`，默认 60s
 *   - **background（stale-while-revalidate）**：命中即返回 + 后台 refresh 双写
 *   - **自检（stt）**：`stt > 0` 启动周期清理（仅扫内存索引，过期项按其绑定 storage 删磁盘）
 *   - **失效操作**：`removeCache(key)` / `clearCache()` 操作共享池
 */
export default function cache({
  enable = true,
  ttl = 60_000,
  methods = "*",
  storage = "ssesionStorage",
  background = false,
  memory = false,
  give,
  stt = 3 * 60 * 1000,
}: ICacheOptions = {}): Plugin {
  const defaults = { ttl, background, memory, give };
  // `'*'` / `['*']` / 空 / undefined ⇒ 不限制 method
  const allowedMethods =
    Type.isArray(methods) && methods.length && !methods.includes("*")
      ? new Set(methods.map((m) => m.toLowerCase()))
      : null;
  return {
    name,
    install(ctx) {
      requirePlugin(ctx, keyName);
      if (__DEV__) {
        ctx.logger.log(
          `${name} enable:${enable} ttl:${ttl}ms ` +
            `methods:${allowedMethods ? [...allowedMethods].join(",") : "*"} ` +
            `background:${background} memory:${memory} stt:${stt}ms ` +
            `storage:${typeof storage === "string" ? storage : storage ? "custom" : "default"} ` +
            `give:${give ? "custom" : "default"}${sharedManager ? " (shared)" : ""}`,
        );
      }

      const manager = (sharedManager ??= new StorageManager({
        storage,
        stt,
        logger: ctx.logger,
      }));

      const prev = ctx.axios.defaults.adapter as AxiosAdapter;
      ctx.adapter(async (config) => {
        const opt = $resolveCache(config, defaults, enable);
        // 请求级 storage：捕获后立即 delete，避免泄漏到下游 / 重试 / 共享 promise
        const reqStorage = (config as { storage?: TCacheStorage }).storage;
        delete config.cache;
        delete (config as { storage?: TCacheStorage }).storage;
        if (!opt) return prev(config);

        if (
          allowedMethods &&
          !allowedMethods.has((config.method || "get").toLowerCase())
        ) {
          return prev(config);
        }

        const k = (config as { key?: unknown }).key;
        if (typeof k !== "string" || !k) {
          if (__DEV__)
            ctx.logger.warn(
              `${name} skipped: config.key missing — \`key\` plugin must run before this request`,
            );
          return prev(config);
        }

        const writeTtl = opt.ttl ?? defaults.ttl;
        const giveFn = opt.give ?? defaults.give ?? DEFAULT_GIVE;
        // 绝大多数请求两个字段都是 falsy（默认 storage + memory:false）—— 跳过对象分配
        const opOpts: IStorageOpOptions | undefined =
          reqStorage !== undefined || opt.memory
            ? { storage: reqStorage, useMemory: opt.memory }
            : undefined;

        const entry = await manager.get(k, opOpts);
        if (entry) {
          if (__DEV__)
            ctx.logger.log(
              `${name} hit: ${k}${opt.memory ? " (mem)" : ""}${opt.background ? " (bg-refresh)" : ""}`,
            );
          if (opt.background) {
            void $refresh(
              prev,
              config,
              manager,
              k,
              writeTtl,
              giveFn,
              opOpts,
              ctx.logger,
            );
          }
          return $restore(entry, config);
        }

        return prev(config).then(async (response) => {
          const data = giveFn(response);
          if (data == null) {
            if (__DEV__)
              ctx.logger.log(
                `${name} skip-cache (give returned null/undefined): ${k}`,
              );
            return response;
          }
          await manager.set(k, $strip(data, writeTtl), opOpts);
          if (__DEV__)
            ctx.logger.log(
              `${name} set: ${k} ttl=${writeTtl}ms${opt.memory ? " +mem" : ""}`,
            );
          return response;
        });
      });
    },
  };
}

/**
 * 解析请求级 cache 配置；null = 本请求不缓存 @internal exported for unit tests
 *
 * **enable 语义**：
 *   - `cache === undefined` ⇒ `enable` 决定 —— `true` 用 defaults、`false` 返回 null
 *   - `cache === false`     ⇒ 永远 null（最高优先级）
 *   - `cache === true`      ⇒ 永远 defaults（per-request 激活，覆盖 `enable: false`）
 *   - `cache === 对象`      ⇒ 字段合并到 defaults
 *
 * **性能**：`cache: true` 路径直接返回共享 `defaults` 引用，不分配新对象 ——
 * 调用方只读不可 mutate。对象覆盖路径才 copy + 字段合并。
 */
export function $resolveCache(
  config: AxiosRequestConfig,
  defaults: Required<Pick<ICacheOptions, "ttl" | "background" | "memory">> &
    Pick<ICacheOptions, "give">,
  enable: boolean,
): IResolvedCache | null {
  let v: unknown = config.cache;
  if (typeof v === "function")
    v = (v as (c: AxiosRequestConfig) => unknown)(config);
  if (v === false) return null;
  if (v == null) return enable ? defaults : null;
  if (v === true) return defaults;
  if (typeof v !== "object") return null;
  const o = v as Partial<IResolvedCache>;
  const out: IResolvedCache = {
    ttl: defaults.ttl,
    background: defaults.background,
    memory: defaults.memory,
    give: defaults.give,
  };
  if (o.ttl !== undefined) out.ttl = o.ttl;
  if (o.background !== undefined) out.background = o.background;
  if (o.memory !== undefined) out.memory = o.memory;
  if (o.give !== undefined) out.give = o.give;
  return out;
}

/** 已提取的 data + ttl → entry 形态 @internal exported for unit tests */
export function $strip(data: unknown, ttl: number): ICacheEntry {
  return { expiresAt: Date.now() + ttl, data };
}

/** entry → 最小化 AxiosResponse；命中标 _cache=true @internal exported for unit tests */
export function $restore(
  entry: ICacheEntry,
  config: AxiosRequestConfig,
): AxiosResponse {
  return {
    data: entry.data,
    status: 200,
    statusText: "",
    headers: {},
    config: config as AxiosResponse["config"],
    _cache: true,
  };
}

/** 后台刷新（fire-and-forget）—— background 模式下命中后并行更新缓存 @internal */
async function $refresh(
  prev: AxiosAdapter,
  config: AxiosRequestConfig,
  manager: StorageManager,
  key: string,
  ttl: number,
  giveFn: TCacheGiver,
  opOpts: IStorageOpOptions | undefined,
  logger: PluginLogger,
): Promise<void> {
  try {
    const response = await prev(config as Parameters<AxiosAdapter>[0]);
    const data = giveFn(response);
    if (data == null) return;
    await manager.set(key, $strip(data, ttl), opOpts);
    if (__DEV__) logger.log(`${name} bg-refresh updated: ${key}`);
  } catch (e) {
    if (__DEV__) logger.error(`${name} bg-refresh failed: ${key}`, e);
  }
}

/**
 * 删除共享缓存池中的某条数据（内存 + storage 双清）。
 * 返回 `false` 表示 cache 插件尚未装载。
 */
export async function removeCache(key: string): Promise<boolean> {
  if (!sharedManager) return false;
  await sharedManager.remove(key);
  return true;
}

/**
 * 清空共享缓存池（内存 + storage）。
 * 返回 `true` = storage 也清了；`false` = 未装载 / storage 不支持 `clear()`。
 */
export async function clearCache(): Promise<boolean> {
  if (!sharedManager) return false;
  return sharedManager.clear();
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(cache)` 在 minify 后仍能识别
lockName(cache, name);


/**
 * **测试专用** —— 销毁共享 manager，下一次 install 会用新 opts 重新构造。
 * 业务代码不应调用：插件设计为模块级单例，这个 hook 只是为了让单测之间能隔离 storage。
 *
 * @internal exported for unit tests
 */
export function $resetSharedManager(): void {
  sharedManager?.destroy();
  sharedManager = null;
}
