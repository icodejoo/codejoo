import axiosLib from 'axios';
import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import { cloneAxiosDefaults } from './helper';
import AxpResponse from './objects/Response';
import type {
  CoreOptions,
  HttpMethodLower,
  IMethodOptions,
  IHttpOptions,
  HttpPrototype,
} from './types';

/* `Core<T>` 通过接口声明合并混入 `HttpPrototype<T>`；类型机制在 `./types`，本文件只是运行时 + 分发的落地代码。
 *
 * `Core<T>` mixes in `HttpPrototype<T>` via interface declaration merging. All type machinery lives in `./types`; this file is runtime + dispatch glue. */
export default interface Core<T = unknown> extends HttpPrototype<T> {}

/**
 * 围绕单个 axios 实例的强类型分发层：构造时归一化 `defaults`（adapter 兼容、`transitional`），再通过原型方法混入 `get/post/put/...`；每次调用把 `AxiosResponse` 收敛成 `dispatch` 声明的三种形态之一（见 `shapeResponse`）。`Core` 不知道也不关心装了哪些插件，那是 `Axp.install` 的职责。
 *
 * A strongly-typed dispatch layer around a single axios instance: the constructor normalizes `defaults` (adapter compatibility, `transitional`), then prototype methods mix in `get/post/put/...`; every call collapses the `AxiosResponse` into one of the three shapes `dispatch` declares (see `shapeResponse`). `Core` neither knows nor cares which plugins are installed — that's `Axp.install`'s job.
 */
export default class Core<T = unknown> {
  /**
   * 归一化 axios 实例的 `adapter`/`transitional` 设置后立即调用 `#build()` 装配原型方法；不会自动安装任何插件。
   *
   * Normalizes the axios instance's `adapter`/`transitional` settings, then calls `#build()` to assemble the prototype methods. Installs no plugins on its own.
   *
   * @param axios 底层 axios 实例，作为公开属性挂在实例上 / underlying axios instance, exposed as a public property
   * @param _options 构造选项（当前预留未使用） / construction options (currently reserved, unused)
   */
  constructor(public axios: AxiosInstance, _options: CoreOptions = {}) {
    // 归一化 adapter：axios 1.x 允许 defaults.adapter 是 string / string[] / function / undefined，这里统一解析成函数，插件读取时不用各自处理兼容。
    //
    // Normalize the adapter: axios 1.x allows `defaults.adapter` to be string / string[] / function / undefined; resolve it to a function once so plugins don't each need their own compat handling.
    if (typeof this.axios.defaults.adapter !== 'function') {
      this.axios.defaults.adapter = axiosLib.getAdapter(
        this.axios.defaults.adapter ?? ['xhr', 'http', 'fetch'],
      );
    }
    this.axios.defaults.transitional = {
      ...this.axios.defaults.transitional,
      clarifyTimeoutError: true,
    };
    this.#build();
  }

  /**
   * 派生一个新的 `Core<T>`：克隆当前 axios defaults 后再应用 `overrides`。**不会**重放插件——记账在 `Axp.install` 返回的 `AxpHandle` 里，派生实例需要同一插件集时请自行重新调用 `Axp.install(child, sameConfig)`。
   *
   * 克隆策略是"结构性浅拷贝 + 针对性深拷贝"（字段理由见 README "Extends" 一节）：`headers`/`params`/`transformRequest`/`transformResponse`/`transitional` 深拷贝（否则修改会泄漏到父实例）；`adapter` 及其余原始类型 default 按引用共享。
   *
   * Derive a new `Core<T>` that clones this instance's axios defaults, then applies `overrides`. Does NOT replay any plugins — that bookkeeping lives in the `AxpHandle` `Axp.install` returned; re-run `Axp.install(child, sameConfig)` yourself if the derived instance needs the same plugin set.
   *
   * Cloning strategy is **structural shallow + targeted deep** (see README "Extends" for field-by-field rationale): `headers`/`params`/`transformRequest`/`transformResponse`/`transitional` are deep-cloned (mutation would otherwise leak to the parent); `adapter` and other primitive defaults are shared by reference.
   *
   * @param overrides axios 配置覆盖项，浅合并到克隆后的 defaults 上 / axios config overrides, shallow-merged onto the cloned defaults
   * @returns 全新、独立的 `Core<T>` 实例 / a brand-new, independent `Core<T>` instance
   */
  extends(overrides: AxiosRequestConfig = {}): Core<T> {
    const childAxios = axiosLib.create(
      cloneAxiosDefaults(this.axios.defaults as AxiosRequestConfig),
    );
    Object.assign(childAxios.defaults, overrides);
    return new Core<T>(childAxios);
  }

  /** 为某个 HTTP 方法生成 curried 的 `(path) => (payload, config) => Promise` 分发函数；`method`/`field` 由闭包捕获。
   *
   *  Builds the curried `(path) => (payload, config) => Promise` dispatch function for one HTTP method; `method`/`field` are captured by the closure. */
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
        // dispatch 在此真正兑现三种返回形态(raw / wrap / 解包)，而非把整个 AxiosResponse 直接漏给调用方(旧实现的类型谎言)。
        //
        // This is where `dispatch` honors its three return shapes (raw / wrap / unwrapped), instead of leaking the whole `AxiosResponse` to the caller (the old implementation's type lie).
        return self.axios.request(merged).then((res) => shapeResponse(res, merged));
      };
    } as unknown as HttpPrototype<T>[HttpMethodLower];
  }

  /* prototype 上的 verb 方法与实例状态无关(method/field 由闭包捕获，体内只用 this/self)，因此全进程只需装配一次，模块级 flag 守卫避免每次 new 都重跑循环。
   *
   * The verb methods on the prototype are independent of instance state (method/field captured by closure; body only uses this/self), so assembly only needs to run once per process — a module-level flag guards against re-running it on every `new`. */
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

/** 模块级构建标记，见 `#build()`。 / Module-level build flag, see `#build()`. */
let PROTO_BUILT = false;

/**
 * 把 `AxiosResponse` 映射成 `dispatch` 声明的三种形态之一：`raw` → 后端信封 `{ code, data, message }`；`wrap` → `ApiResponse<R>`；默认 → 解包后的业务数据 `R`（非信封式响应原样返回，保证"薄 axios 包装"对第三方接口仍可用）。
 *
 * Maps an `AxiosResponse` onto one of the three shapes `dispatch` declares: `raw` → the backend envelope `{ code, data, message }`; `wrap` → an `ApiResponse<R>`; default → the unwrapped business payload `R` (non-envelope responses pass through as-is, so axp still works as a "thin axios wrapper" against third-party APIs).
 *
 * @param res axios 原始响应对象 / raw response object from axios
 * @param config 本次请求生效的配置（用于读取 `raw`/`wrap`） / effective config for this request (used to read `raw`/`wrap`)
 */
function shapeResponse(res: AxiosResponse, config: IHttpOptions): unknown {
  if ((config as { raw?: boolean }).raw) return res.data;
  if ((config as { wrap?: boolean }).wrap) return AxpResponse.fromResponse(res);
  const body = res.data;
  if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
    return (body as { data: unknown }).data;
  }
  return body;
}

/**
 * `Core` 的工厂函数——`T` 留成未绑定泛型，调用点自己钉住类型：`create<MyApi>()`；省略 `axiosInstance` 时新建一个默认实例。
 *
 * Factory for `Core` — keeps `T` unbound so call sites can pin it: `create<MyApi>()`; a fresh default axios instance is created when `axiosInstance` is omitted.
 *
 * @param axiosInstance 要包裹的 axios 实例 / axios instance to wrap
 * @param options 传给 `Core` 构造函数的选项 / options forwarded to the `Core` constructor
 */
export function create<T = unknown>(
  axiosInstance: AxiosInstance = axiosLib.create(),
  options?: CoreOptions,
): Core<T> {
  return new Core<T>(axiosInstance, options);
}
