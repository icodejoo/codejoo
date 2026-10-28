import type { AxpContext } from "../context";
import { normalizeMethod } from "../methods";
import { resolveOption, type AxpOption, type IPluginSwitch } from "../options";
import type { AxpResponse, IAxpResponse } from "../response";
import type { AxpClient, AxpPlugin } from "../types";
import { isPlainObject } from "../utils";
import { createFreshnessBarrier, createMemoryStore, type IAxpCacheStore } from "./cache-store";

export type { IAxpCacheEntry, IAxpCacheStore } from "./cache-store";

/** 内置缓存插件名称。 */
const NAME = "axp:cache";
/** 默认有效期：一分钟。 */
const DEFAULT_EXPIRES = 60_000;
/** 默认只缓存不改变服务端状态的方法。 */
const DEFAULT_METHODS = ["get", "head"];
/** 环境缺少 structuredClone 时，deep 拷贝宁可报错也不悄悄共享数据。 */
const DEEP_UNSUPPORTED = `[${NAME}] clone:"deep" 需要 structuredClone（当前环境不可用）；请改用 clone: (data) => ... 自定义深拷贝`;

/** 命中缓存与返回响应时对 data 的拷贝策略：浅拷贝、深拷贝或自定义函数。 */
export type TCloneStrategy = "shallow" | "deep" | ((data: any) => any);

/** 解析后的拷贝函数。 */
type TCloneFn = (data: any) => any;

/** 缓存插件的装配配置。 */
export interface ICacheOptions<R extends IAxpResponse = IAxpResponse> extends IPluginSwitch {
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
  /** 自定义同步存储，默认内存 LRU；过期条目由插件读取时再检查一次。 */
  store?: IAxpCacheStore<R>;
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
  shouldCache?: (response: IAxpResponse) => boolean;
}

/** `client.plugin(cache)` 暴露的缓存管理能力。 */
export interface ICacheApi {
  /** 删除一条缓存。 */
  remove(key: string): boolean;
  /** 清空缓存并使在途请求不再回写。 */
  clear(): number;
}

/** 合并默认之后的缓存配置，含请求级显式键。 */
type TCacheConfig<R extends IAxpResponse> = ICacheOptions<R> &
  Pick<ICacheRequestOptions, "key"> &
  Required<Pick<ICacheOptions<R>, "expires" | "methods" | "shouldCache">>;

/** 默认写入判定：只缓存成功响应。
 * @param response 归一化响应。
 * @returns 是否写入缓存。
 * @example `$defaultShouldCache(r) // r.ok`
 */
export function $defaultShouldCache(response: IAxpResponse): boolean {
  return response.ok;
}

/** 内置默认：一分钟、GET 与 HEAD、只缓存成功。 */
const DEFAULTS = {
  /** 默认有效期。 */ expires: DEFAULT_EXPIRES,
  /** 默认方法。 */ methods: DEFAULT_METHODS,
  /** 默认写入判定。 */ shouldCache: $defaultShouldCache,
};

/** 浅拷贝：数组和对象复制顶层，原始值原样返回。
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

/** 数字简写即有效期；resolveCache 只放行数字和对象，所以这里只会收到数字。 */
function expiresShorthand(value: unknown): { /** 有效期（毫秒）。 */ expires: number } {
  return { expires: value as number };
}

/** 本次请求生效的缓存配置；null 表示这次不缓存（cache 必须由请求开启）。 */
function resolveCache<R extends IAxpResponse>(
  value: unknown,
  base: TCacheConfig<R>,
): TCacheConfig<R> | null {
  if (value === true) return base;
  if (typeof value === "number" || isPlainObject(value))
    return resolveOption<TCacheConfig<R>, typeof DEFAULTS>(value, base, DEFAULTS, expiresShorthand);
  return null;
}

/** 按拷贝策略派生响应，data 为拷贝，其余字段沿用来源。 */
function cloneResponse<R extends IAxpResponse>(
  ctx: AxpContext<R>,
  response: R,
  cloneFn: TCloneFn,
): R {
  return ctx.fail({ from: response, data: cloneFn(response.data) });
}

/** 缓存成功响应，命中时不触网；较旧的响应不覆盖较新的结果。
 * 请求级 `cache` 开启（true、数字有效期或对象）；key 不可哈希且没有显式键时直接放行。
 * @param options 有效期、容量、方法、拷贝策略、写入判定与自定义存储。
 * @returns source 阶段内置次序 3 的插件；`client.plugin(plugin)` 得到 `{ remove, clear }`。
 * @example `axpCache({ expires: 30_000 })` 配合 `api.get('/pets')(undefined, { cache: true })`
 */
export default function axpCache<R extends IAxpResponse = AxpResponse>(
  options: ICacheOptions<R> = {},
): AxpPlugin<R, ICacheApi> {
  const base = resolveOption<TCacheConfig<R>, typeof DEFAULTS>(undefined, options, DEFAULTS);
  const methods = new Set(
    base.methods.map(/** 方法名统一小写。 */ (method) => method.toLowerCase()),
  );
  return {
    name: NAME,
    enable: options.enable,
    stage: "source",
    /** 每个客户端各自持有存储与新旧顺序屏障。 */
    setup() {
      const owned = options.store === undefined;
      const store = options.store ?? createMemoryStore<R>({ max: options.max });
      const barrier = createFreshnessBarrier();
      return {
        /** 命中直接返回；未命中放行并按发起顺序决定是否写回。 */
        async handle(ctx, next) {
          const config = resolveCache(ctx.request.cache, base);
          if (!config || !methods.has(normalizeMethod(ctx.request.method))) return next();
          const key = (typeof config.key === "string" && config.key) || ctx.key();
          if (key === null) return next();
          const cloneFn = $resolveCloneFn(config.clone);
          const hit = store.get(key);
          if (hit) {
            // 第三方存储可能不处理过期，读取时再确认一次。
            if (hit.expiresAt > Date.now())
              return cloneFn ? cloneResponse(ctx, hit.response, cloneFn) : hit.response;
            store.delete(key);
          }
          const ticket = barrier.begin(key);
          let response!: R;
          try {
            response = await next();
            if (barrier.canWrite(key, ticket) && config.shouldCache(response)) {
              store.set(key, { response, expiresAt: Date.now() + config.expires });
              barrier.markWritten(key, ticket);
            }
          } finally {
            barrier.end(key);
            // 没有在途请求时记录无需保留：之后发起的票据序号必然更大。
            barrier.reclaim(key, false);
          }
          return cloneFn && response.ok ? cloneResponse(ctx, response, cloneFn) : response;
        },
        api: {
          /** 删除一条缓存，返回是否存在。 */
          remove: (key) => store.delete(key),
          /** 清空并作废在途写入，返回清掉的条目数。 */
          clear() {
            const count = store.size;
            store.clear();
            barrier.clear();
            return count;
          },
        },
        /** 卸载后在途响应不再回写；只清空自己创建的存储，注入的由调用方管理。 */
        dispose() {
          barrier.clear();
          if (owned) store.clear();
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
 * @returns 是否真的删除了条目；客户端没有安装 cache 时为 false。
 * @example `removeCache(api, 'pets')`
 */
export function removeCache(client: Pick<AxpClient<any, any>, "plugin">, key: string): boolean {
  return client.plugin(CACHE_PROBE)?.remove(key) ?? false;
}

/** 清空客户端的全部缓存，清空前已发出的在途请求落定后不再回写（适合切换账号）。
 * @param client 安装了 axpCache 的客户端。
 * @returns 被清掉的条目数；客户端没有安装 cache 时为 0。
 * @example `clearCache(api)`
 */
export function clearCache(client: Pick<AxpClient<any, any>, "plugin">): number {
  return client.plugin(CACHE_PROBE)?.clear() ?? 0;
}

declare module "../types" {
  interface AxpRequestOptions {
    /** false 关闭；true 沿用插件配置；数字为有效期；对象覆盖 expires、key、clone、shouldCache，enable:false 等同 false。 */
    cache?: AxpOption<ICacheRequestOptions, number>;
  }
}
