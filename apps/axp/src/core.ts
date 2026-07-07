import axios, { AxiosHeaders } from 'axios';
import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { asArray } from './helper';
import AxpResponse from './objects/Response';
import { PluginManager } from './plugin';
import type {
  CoreOptions,
  HttpMethodLower,
  IMethodOptions,
  IHttpOptions,
  HttpPrototype,
  Plugin,
  PluginRecord,
} from './types';

/** Anything that exposes a `.name` string — `Plugin` itself, or a plugin
 *  factory function (whose `.name` is its declaration name, by JS convention).
 *  Auth ejects all use this single key. */
type Named = { readonly name: string };

/* `Core<T>` mixes in `HttpPrototype<T>` via interface declaration merging.
 * All type machinery lives in `./types`; this file is runtime + dispatch glue. */
export default interface Core<T = unknown> extends HttpPrototype<T> {}

export default class Core<T = unknown> {
  #manager: PluginManager;
  #options: CoreOptions;

  constructor(public axios: AxiosInstance, options: CoreOptions = {}) {
    this.#options = options;
    this.#manager = new PluginManager(axios, options);

    axios.defaults.transitional = {
      ...axios.defaults.transitional,
      clarifyTimeoutError: true,
    };
    this.#build();
  }

  /** Install one or many plugins. Triggers a full re-install of the current
   *  plugin set so the interceptor stack always reflects live `use()` order.
   *
   *  - `use(plugin)`   — install a single plugin
   *  - `use([a, b, c])` — install a batch atomically with a single refresh
   *
   *  Returns `this` for chaining: `api.use(a).use([b, c]).use(d)`. */
  use(plugin: Plugin): this;
  use(plugins: Plugin[]): this;
  use(arg: Plugin | Plugin[]): this {
    this.#manager.useMany(Array.isArray(arg) ? arg : [arg]);
    return this;
  }

  /** Remove a plugin. All side-effects registered through `ctx` are reverted.
   *
   *  `target` is identified by string `.name`:
   *   - pass a string                 — the plugin name directly
   *   - pass a `Plugin` object        — uses `plugin.name`
   *   - pass a plugin factory function — uses `factory.name`
   *
   *  The factory form relies on the convention that the factory's `.name`
   *  (its declaration name, or an explicit `factory.name = '<plugin-name>'`
   *  assignment) matches the `name` of the `Plugin` it returns. All three
   *  forms collapse to a single string lookup internally — there is one
   *  removal path. */
  eject(target: string | Named): this {
    this.#manager.eject(typeof target === 'string' ? target : target.name);
    return this;
  }

  /** Snapshot of currently-installed plugins, for debugging / assertions. */
  plugins(): readonly PluginRecord[] {
    return this.#manager.snapshot();
  }

  /** Derive a new `Core<T>` that starts out as a clone of this one, then
   *  applies `overrides` on top of the cloned axios defaults.
   *
   *  Cloning strategy is **structural shallow + targeted deep** — see README
   *  "Extends" section for the field-by-field rationale. Briefly:
   *
   *   - Deep-cloned (mutation would otherwise leak to the parent):
   *     `headers`, `params`, `transformRequest`, `transformResponse`,
   *     `transitional`, and the plugin list itself (a fresh array).
   *   - Shared by reference (immutable / sink / function):
   *     `adapter`, `logger`, primitive defaults, plugin objects.
   *   - Not copied (rebuilt on the child via plugin install):
   *     `axios.interceptors`, `PluginManager` records / id arrays.
   *
   *  The child's plugin set is installed via a single `useMany([...])` so
   *  the interceptor stack is built in one `#refresh` cycle. */
  extends(overrides: AxiosRequestConfig = {}): Core<T> {
    const childAxios = axios.create(
      cloneAxiosDefaults(this.axios.defaults as AxiosRequestConfig),
    );
    Object.assign(childAxios.defaults, overrides);

    const child = new Core<T>(childAxios, this.#options);
    child.use([...this.#manager.plugins]);
    return child;
  }

  #buildMethod(method: HttpMethodLower, field: 'data' | 'params') {
    return function (
      this: Core<T>,
      path: string,
      methodConfig?: IMethodOptions,
    ) {
      const self = this;
      return function dispatch(
        payload?: unknown,
        config?: IHttpOptions,
      ) {
        const merged = {
          url: path,
          method,
          [field]: payload,
          ...methodConfig,
          ...config,
        } as IHttpOptions;
        // dispatch 在此真正兑现三种返回形态(raw / wrap / 解包)，
        // 而非把整个 AxiosResponse 直接漏给调用方(旧实现的类型谎言)。
        return self.axios.request(merged).then((res) => shapeResponse(res, merged));
      };
    } as unknown as HttpPrototype<T>[HttpMethodLower];
  }

  /* prototype 上的 verb 方法与实例状态无关(method/field 由闭包捕获，
   * 体内只用 this/self)，因此全进程只需装配一次，模块级 flag 守卫避免
   * 每次 new 都重跑循环。 */
  #build() {
    if (PROTO_BUILT) return;
    const bodyMethods: HttpMethodLower[] = ['delete', 'post', 'put', 'patch'];
    const methods: HttpMethodLower[] = ['get', 'head', 'options', ...bodyMethods];
    const proto = Core.prototype as unknown as Record<HttpMethodLower, unknown>;
    for (const m of methods) {
      proto[m] ||= this.#buildMethod(m, bodyMethods.includes(m) ? 'data' : 'params');
    }
    PROTO_BUILT = true;
  }
}

let PROTO_BUILT = false;

/** 把 AxiosResponse 映射成 dispatch 声明的三种形态之一：
 *   - `raw`  → 后端信封 `{ code, data, message }`(即 `response.data`)
 *   - `wrap` → `ApiResponse<R>`
 *   - 默认   → 解包后的业务数据 `R`；非信封式响应(无 code 字段)原样返回，
 *             保证"薄 axios 包装"与第三方接口仍可用。 */
function shapeResponse(res: AxiosResponse, config: IHttpOptions): unknown {
  if ((config as { raw?: boolean }).raw) return res.data;
  if ((config as { wrap?: boolean }).wrap) return AxpResponse.fromResponse(res);
  const body = res.data;
  if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/** Clone `axios.defaults` so the returned object is safe to hand to
 *  `axios.create` for a derived instance. Mutable containers are duplicated;
 *  primitives, sinks and functions are shared. The shape of `headers` is
 *  axios-specific (per-method nested object), so we walk one level deep on
 *  it; everything else only needs a one-level fresh container. */
function cloneAxiosDefaults(d: AxiosRequestConfig): AxiosRequestConfig {
  return {
    ...d,
    headers: cloneAxiosHeaders(d.headers),
    params: d.params && typeof d.params === 'object' ? { ...d.params } : d.params,
    transformRequest: asArray(d.transformRequest),
    transformResponse: asArray(d.transformResponse),
    transitional: d.transitional ? { ...d.transitional } : d.transitional,
  };
}

function cloneAxiosHeaders(h: AxiosRequestConfig['headers']): AxiosRequestConfig['headers'] {
  if (h == null) return h;
  if (h instanceof AxiosHeaders) return new AxiosHeaders(h);
  // Per-method nested shape: { common: {...}, get: {...}, post: {...}, ... }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(h)) {
    const v = (h as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' ? { ...(v as object) } : v;
  }
  return out as AxiosRequestConfig['headers'];
}

/** Factory — keeps `T` unbound so call sites can pin it: `create<MyApi>()`. */
export function create<T = unknown>(
  axiosInstance: AxiosInstance = axios.create(),
  options?: CoreOptions,
): Core<T> {
  return new Core<T>(axiosInstance, options);
}
