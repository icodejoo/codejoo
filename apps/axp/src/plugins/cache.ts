import { cancelIfAborted, type AxpContext } from "../context";
import { methodSet, normalizeMethod, SAFE_METHODS } from "../methods";
import { resolveOption, resolveRequestOption, type AxpOption, type IPluginSwitch } from "../options";
import { failureOf, messageOf, type AxpResponse, type AxpResponseInit, type IAxpResponse } from "../response";
import type { AxpClient, AxpNext, AxpPlugin } from "../types";
import { waitAbortable } from "../utils";
import { createFreshnessBarrier, createMemoryStore, type IAxpCacheEntry, type IAxpCacheSnapshot, type IAxpCacheStore, type MaybePromise } from "./cache-store";

export type { IAxpCacheEntry, IAxpCacheSnapshot, IAxpCacheStore, MaybePromise } from "./cache-store";

/** 内置缓存插件名称。 */
const NAME = "axp:cache";
/** 默认有效期：一分钟。 */
const DEFAULT_EXPIRES = 60_000;
/** 存储删除操作的日志标签。 */
const DELETE_OPERATION = "delete";
/** 不进入扩展快照的基础字段和传输引用。 */
const BASE_FIELDS = new Set(["ok", "status", "code", "message", "data", "request", "stack", "raw", "error"]);
/** 环境缺少 structuredClone 时，deep 拷贝宁可报错也不悄悄共享数据。 */
const DEEP_UNSUPPORTED = `[${NAME}] clone:"deep" 需要 structuredClone（当前环境不可用）；请改用 clone: (data) => ... 自定义深拷贝`;

/** 命中缓存与返回响应时对 data 的拷贝策略：浅拷贝、深拷贝或自定义函数。 */
export type TCloneStrategy = "shallow" | "deep" | ((data: any) => any);

/** 解析后的拷贝函数。 */
type TCloneFn = (data: any) => any;

/** 缓存插件的装配配置。 */
export interface ICacheOptions<R extends IAxpResponse<unknown, string | number> = IAxpResponse> extends IPluginSwitch {
  /** 默认有效期（毫秒），默认 60_000；Infinity 永不过期。 */
  expires?: number;
  /** 内存缓存容量，超出按 LRU 淘汰；小于 1 回退 500，Infinity 不限。注入 store 后不再生效。 */
  max?: number;
  /** 允许缓存的方法，默认 get、head；其它方法即使请求级开启也不缓存。 */
  methods?: string[];
  /** 命中与返回时对 `r.data` 的拷贝策略，默认共享引用。 */
  clone?: TCloneStrategy;
  /** 是否写入缓存，默认只缓存 `r.ok`；抛错按程序 bug 处理。 */
  shouldCache?: (response: R) => boolean;
  /** 自定义同步或异步快照存储，默认内存 LRU；读取时再检查过期。 */
  store?: IAxpCacheStore;
}

/** 请求级 cache 对象写法。 */
export interface ICacheRequestOptions extends IPluginSwitch {
  /** 本次请求的有效期（毫秒）。 */
  expires?: number;
  /** 显式缓存键，不经过 key 服务，不含 scope。 */
  key?: string;
  /** 本次请求的拷贝策略。 */
  clone?: TCloneStrategy;
  /** 本次请求的写入判定。 */
  shouldCache?: (response: IAxpResponse<unknown, string | number>) => boolean;
}

/** `client.plugin(cache)` 暴露的缓存管理能力。 */
export interface ICacheApi {
  /** 删除一条缓存。
   * @param key 缓存键。
   * @returns 是否存在；异步仓返回 Promise，故障时为 false。
   * @example `await api.remove('pets')`
   */
  remove(key: string): MaybePromise<boolean>;
  /** 清空缓存并使在途请求不再回写。
   * @returns 清掉的条目数；异步仓返回 Promise。
   * @example `await api.clear()`
   */
  clear(): MaybePromise<number>;
}

/** 合并默认之后的缓存配置，含请求级显式键。 */
type TCacheConfig<R extends IAxpResponse<unknown, string | number>> = ICacheOptions<R> & Pick<ICacheRequestOptions, "key"> & Required<Pick<ICacheOptions<R>, "expires" | "methods" | "shouldCache">>;

/** 默认写入判定：只缓存成功响应。
 * @internal
 * @param response 归一化响应。
 * @returns 是否写入缓存。
 * @example `$defaultShouldCache(r) // r.ok`
 */
export function $defaultShouldCache(response: IAxpResponse<unknown, string | number>): boolean {
  return response.ok;
}

/** 内置默认：一分钟、GET 与 HEAD、只缓存成功。 */
const DEFAULTS = {
  /** 默认有效期。 */ expires: DEFAULT_EXPIRES,
  /** 默认方法。 */ methods: SAFE_METHODS,
  /** 默认写入判定。 */ shouldCache: $defaultShouldCache,
};

/** 浅拷贝：数组和对象复制顶层，原始值原样返回。
 * @internal
 * @param data 响应数据。
 * @returns 顶层独立的数据，嵌套仍共享。
 * @example `$shallowClone({ a: { b: 1 } }) // 新对象，a 仍共享`
 */
export function $shallowClone(data: any): any {
  if (Array.isArray(data)) return [...data];
  if (data && typeof data === "object") return { ...data };
  return data;
}

/** 把拷贝策略解析为函数；null 表示共享引用。
 * @internal
 * @param clone 拷贝策略。
 * @returns 拷贝函数，或 null。
 * @throws deep 在没有 structuredClone 的环境里抛错，绝不退化为浅拷贝。
 * @example `$resolveCloneFn('deep')?.(data)`
 */
export function $resolveCloneFn(clone: TCloneStrategy | undefined): TCloneFn | null {
  if (clone === "shallow") return $shallowClone;
  if (clone === "deep") {
    if (typeof structuredClone !== "function") throw new Error(DEEP_UNSUPPORTED);
    return structuredClone;
  }
  return typeof clone === "function" ? clone : null;
}

/** 数字简写即有效期，其它类型不认。 */
function expiresShorthand(value: unknown): { /** 有效期（毫秒）。 */ expires: number } | undefined {
  return typeof value === "number" ? { expires: value } : undefined;
}

/** 按拷贝策略派生响应，data 为拷贝，其余字段沿用来源。 */
function cloneResponse<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, response: R, cloneFn: TCloneFn): R {
  return ctx.fail({ from: response, data: cloneFn(response.data) });
}

/** 只在存储实际返回 thenable 时进入异步路径。 */
function isPending<T>(value: MaybePromise<T>): value is Promise<T> {
  return value != null && typeof (value as Promise<T>).then === "function";
}

/** 提取基础判定字段与自有可枚举扩展数据，不保存传输引用和函数。 */
function snapshotResponse(response: IAxpResponse<unknown, string | number>): IAxpCacheSnapshot {
  let extra: Record<string, unknown> | undefined;
  for (const key of Object.keys(response)) {
    if (BASE_FIELDS.has(key)) continue;
    const value: unknown = Reflect.get(response, key);
    if (typeof value !== "function") {
      extra ??= {};
      Object.defineProperty(extra, key, { value, enumerable: true, configurable: true, writable: true });
    }
  }
  const snapshot: IAxpCacheSnapshot = {
    code: response.code,
    data: response.data,
    reason: failureOf(response)?.reason,
    failure: failureOf(response)?.type,
    status: response.status,
  };
  const message = messageOf(response);
  if (message !== undefined) snapshot.message = message;
  if (extra) snapshot.extra = extra;
  return snapshot;
}

/** 缓存成功响应，命中时不触网；较旧的响应不覆盖较新的结果。
 * 请求级 `cache` 开启（true、数字有效期或对象）；key 不可哈希且没有显式键时直接放行。
 * @param options 有效期、容量、方法、拷贝策略、写入判定与自定义存储。
 * @returns source 阶段内置次序 3 的插件；`client.plugin(plugin)` 得到 `{ remove, clear }`。
 * @example `axpCache({ expires: 30_000 })` 配合 `api.get('/pets')(undefined, { cache: true })`
 */
export default function axpCache<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: ICacheOptions<R> = {}): AxpPlugin<R, ICacheApi> {
  const base = resolveOption<TCacheConfig<R>, typeof DEFAULTS>(undefined, options, DEFAULTS);
  const methods = methodSet(base.methods);
  return {
    name: NAME,
    enable: options.enable,
    stage: "source",
    /** 每个客户端各自持有存储与新旧顺序屏障。 */
    setup() {
      const owned = options.store === undefined;
      const store = options.store ?? createMemoryStore({ max: options.max });
      const barrier = createFreshnessBarrier();
      const writes = new Map<string, Promise<void>>();
      /** 存储故障只记录，不改变本次请求结果；同步仓不增加微任务。 */
      function operate<T>(method: string, action: () => MaybePromise<T>, fallback: T): MaybePromise<T> {
        /** 同步抛错与异步拒绝共用故障输出和回退值。 */
        function recover(error: unknown): T {
          console.error(`[${NAME}] ${method} failed`, error);
          return fallback;
        }
        try {
          const result = action();
          return isPending(result) ? Promise.resolve(result).catch(recover) : result;
        } catch (error) {
          return recover(error);
        }
      }
      /** 读取失败时回落网络，同步读取不分配闭包。 */
      function lookupFailed(error: unknown): undefined {
        console.error(`[${NAME}] get failed`, error);
        return undefined;
      }
      /** 同 key 的异步写入按到达顺序串行，真正写入前再检查屏障。 */
      function write(key: string, entry: IAxpCacheEntry, ticket: number): MaybePromise<void> {
        /** 在队列头提交；成功写入后才登记新鲜度。 */
        function commit(): MaybePromise<void> {
          if (!barrier.canWrite(key, ticket)) return;
          return operate(
            "set",
            () => {
              const result = store.set(key, entry);
              if (isPending(result)) return Promise.resolve(result).then(/** 异步提交成功后抬高下界。 */ () => barrier.markWritten(key, ticket));
              barrier.markWritten(key, ticket);
            },
            undefined,
          );
        }
        const previous = writes.get(key);
        const result = previous ? previous.then(commit) : commit();
        if (!isPending(result)) return;
        const tail = result.then(
          /** 只移除本次队尾，不能误删后续排队项。 */ () => {
            if (writes.get(key) === tail) writes.delete(key);
          },
        );
        writes.set(key, tail);
        return tail;
      }
      /** 只有未命中才进入异步填充，保持过期删除和写入屏障的顺序。 */
      async function fill(hit: IAxpCacheEntry | undefined, ctx: AxpContext<R>, next: AxpNext<R>, key: string, config: TCacheConfig<R>, cloneFn: TCloneFn | null): Promise<R> {
        if (hit) {
          const removed = operate(DELETE_OPERATION, () => store.delete(key), false);
          if (isPending(removed)) {
            // 异步删除可被取消；存储操作本身不取消，迟到结果已被 operate 观察。
            await waitAbortable(removed, ctx.signal);
            const cancelled = cancelIfAborted(ctx);
            if (cancelled) return cancelled;
          }
        }
        const ticket = barrier.begin(key);
        let response!: R;
        try {
          response = await next();
          if (barrier.canWrite(key, ticket) && config.shouldCache(response)) {
            const written = write(key, { snapshot: snapshotResponse(response), expiresAt: Date.now() + config.expires }, ticket);
            if (isPending(written)) {
              await waitAbortable(written, ctx.signal);
              const cancelled = cancelIfAborted(ctx);
              if (cancelled) return cancelled;
            }
          }
        } finally {
          // 该 key 没有在途请求时，屏障记录随之回收。
          barrier.end(key);
        }
        return cloneFn && response.ok ? cloneResponse(ctx, response, cloneFn) : response;
      }
      /** 同步命中不创建 async 包装，异步存储复用同一重建逻辑。 */
      function resolveHit(hit: IAxpCacheEntry | undefined, ctx: AxpContext<R>, next: AxpNext<R>, key: string, config: TCacheConfig<R>, cloneFn: TCloneFn | null): Promise<R> {
        // 第三方存储可能不处理过期，读取时再确认一次。
        if (!hit || !(hit.expiresAt > Date.now())) return fill(hit, ctx, next, key, config, cloneFn);
        const cancelled = cancelIfAborted(ctx);
        if (cancelled) return Promise.resolve(cancelled);
        const snapshot = hit.snapshot;
        const fields = {
          code: snapshot.code,
          message: snapshot.message,
          data: cloneFn ? cloneFn(snapshot.data) : snapshot.data,
          reason: snapshot.reason,
          failure: snapshot.failure,
          status: snapshot.status,
          request: ctx.request,
        } as AxpResponseInit<R>;
        return Promise.resolve(ctx.fail(snapshot.extra ? { ...snapshot.extra, ...fields } : fields));
      }
      return {
        /** 同步读取不分配闭包，只有异步仓才建立后续处理。 */
        handle(ctx, next) {
          const config = resolveRequestOption(ctx.request.cache, base, DEFAULTS, expiresShorthand, true);
          if (!config || !methods.has(normalizeMethod(ctx.request.method))) return next();
          const key = (typeof config.key === "string" && config.key) || ctx.key();
          if (key === null) return next();
          const cloneFn = $resolveCloneFn(config.clone);
          let lookup: MaybePromise<IAxpCacheEntry | undefined>;
          try {
            const result = store.get(key);
            lookup = isPending(result) ? Promise.resolve(result).catch(lookupFailed) : result;
          } catch (error) {
            lookup = lookupFailed(error);
          }
          // 异步读取可被取消：lookup 已挂好失败处理，迟到结果被隔离，不再参与后续流程。
          return isPending(lookup)
            ? waitAbortable(lookup, ctx.signal).then(/** 取消优先于命中判定，否则按读取结果继续。 */ (hit) => cancelIfAborted(ctx) ?? resolveHit(hit, ctx, next, key, config, cloneFn))
            : resolveHit(lookup, ctx, next, key, config, cloneFn);
        },
        api: {
          /** 删除一条缓存，返回是否存在。 */
          remove: (key) => operate(DELETE_OPERATION, () => store.delete(key), false),
          /** 清空并作废在途写入，返回清掉的条目数。 */
          clear() {
            barrier.clear();
            const count = store.size ?? 0;
            const cleared = operate("clear", () => store.clear(), undefined);
            return isPending(cleared) ? cleared.then(/** 优先使用仓返回的清理数。 */ (value) => value ?? count) : (cleared ?? count);
          },
        },
        /** 卸载后在途响应不再回写；只清空自己创建的存储，注入的由调用方管理。 */
        dispose() {
          barrier.clear();
          if (owned) void store.clear();
        },
      };
    },
  };
}

/** 按名字定位缓存插件，供 removeCache 与 clearCache 在不持有插件对象时使用。 */
const CACHE_PROBE = { name: NAME } as AxpPlugin<any, ICacheApi>;

/** 删除客户端上的一条缓存。
 * @param client 安装了 axpCache 的客户端。
 * @param key 缓存键。
 * @returns 是否真的删除了条目；异步仓返回 Promise，未安装 cache 时为 false。
 * @example `removeCache(api, 'pets')`
 */
export function removeCache(client: Pick<AxpClient<any, any>, "plugin">, key: string): MaybePromise<boolean> {
  return client.plugin(CACHE_PROBE)?.remove(key) ?? false;
}

/** 清空客户端的全部缓存，清空前已发出的在途请求落定后不再回写（适合切换账号）。
 * @param client 安装了 axpCache 的客户端。
 * @returns 被清掉的条目数；异步仓返回 Promise，未安装 cache 时为 0。
 * @example `clearCache(api)`
 */
export function clearCache(client: Pick<AxpClient<any, any>, "plugin">): MaybePromise<number> {
  return client.plugin(CACHE_PROBE)?.clear() ?? 0;
}

declare module "../types" {
  interface AxpRequestOptions {
    /** false 关闭；true 沿用插件配置；数字为有效期；对象覆盖 expires、key、clone、shouldCache，enable:false 等同 false。 */
    cache?: AxpOption<ICacheRequestOptions, number>;
  }
}
