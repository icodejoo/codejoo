import axios, {
  AxiosHeaders,
  AxiosInstance,
  AxiosRequestConfig,
} from 'axios';
import {Type,  asArray } from '../helper';
import { PluginManager } from '../plugin';
import type { Plugin, PluginRecord } from '../plugin/types';
import type {
  CoreOptions,
  HttpMethodLower,
  IMethodOptions,
  IHttpOptions,
  HttpPrototype,
  Named,
} from './types';


/* `Core<T>` mixes in `HttpPrototype<T>` via interface declaration merging.
 * All type machinery lives in `../types`; this file is runtime + dispatch glue. */
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
    this.#manager.useMany(Type.isArray(arg) ? arg : [arg]);
    return this;
  }

  /** Remove a plugin. All side-effects registered through `ctx` are reverted.
   *
   *  `target` is identified by string `.name`:
   *   - pass a string                 — the plugin name directly
   *   - pass a `Plugin` object        — uses `plugin.name`
   *   - pass a plugin factory function — uses `factory.name`
   *
   *  All three forms collapse to a single string lookup internally. */
  eject(target: string | Named): this {
    this.#manager.eject(typeof target === 'string' ? target : target.name);
    return this;
  }

  /** Snapshot of currently-installed plugins, for debugging / assertions. */
  plugins(): readonly PluginRecord[] {
    return this.#manager.snapshot();
  }

  /** Derive a new `Core<T>` that starts out as a clone of this one, then
   *  applies `overrides` on top of the cloned axios defaults. */
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
        return self.axios.request({
          url: path,
          method,
          [field]: payload,
          ...methodConfig,
          ...config,
        });
      };
    } as unknown as HttpPrototype<T>[HttpMethodLower];
  }

  #build() {
    const bodyMethods: HttpMethodLower[] = ['delete', 'post', 'put', 'patch'];
    const methods: HttpMethodLower[] = ['get', 'head', 'options', ...bodyMethods];
    const proto = Core.prototype as unknown as Record<HttpMethodLower, unknown>;
    for (const m of methods) {
      proto[m] ||= this.#buildMethod(m, bodyMethods.includes(m) ? 'data' : 'params');
    }
  }
}

/** Clone `axios.defaults` so the returned object is safe to hand to
 *  `axios.create` for a derived instance. Mutable containers are duplicated;
 *  primitives, sinks and functions are shared. */
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
