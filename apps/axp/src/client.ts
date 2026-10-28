import { create as createAxios, mergeConfig, type AxiosRequestConfig } from "axios";
import { AxpContext, cancelIfAborted, NO_LOG } from "./context";
import { BODY_METHODS, NO_BODY_METHODS, normalizeMethod } from "./methods";
import { composePipeline, sortPipeline, type IAxpRegistration, type IAxpLayer } from "./pipeline";
import { AXP_KINDS, AxpResponse, DEFAULT_RESPONSE_FACTORY, guardFactory, isAxpResponse, type IAxpResponse, type IAxpResponseFactory } from "./response";
import { createTransport } from "./transport";
import type { AxpClient, AxpOptions, AxpPlugin, AxpRequestConfig, HttpMethodLower, TAxpArgs } from "./types";
import { ABORT_EVENT, assignAxiosDefaults, cloneAxiosDefaults, effectiveHeaders } from "./utils";

/** 落定时使用的客户端开关。 */
export interface IAxpSettleOptions<R extends IAxpResponse> {
  /** 可预期失败的转换器。 */
  reject?: (response: R) => unknown;
}

/** 将链内响应落定为数据、响应或异常；internal 始终抛原始异常。
 * @param response 链最终产出。
 * @param ctx 逻辑请求上下文。
 * @param options 客户端默认选项。
 * @param callsite debug 模式下的请求调用点，失败时才读取其 stack。
 * @returns 业务数据或响应，失败时抛出约定对象。
 * @example `settle(response, ctx, {})`
 */
export function settle<R extends IAxpResponse>(response: R, ctx: AxpContext<R>, options: IAxpSettleOptions<R>, callsite?: Error): unknown {
  if (response.kind === AXP_KINDS.INTERNAL) throw response.error;
  const throws = ctx.request.throws ?? true;
  if (!response.ok && throws) {
    const stack = callsite?.stack;
    const failure = stack === undefined ? response : ctx.fail({ from: response, stack });
    if (failure.kind === AXP_KINDS.INTERNAL) throw failure.error;
    throw options.reject ? options.reject(failure) : failure;
  }
  return ctx.request.wrap || !throws ? response : response.data;
}

/** 创建自有洋葱管线客户端，不修改 axios 拦截器。
 * @param args 传输实例、响应工厂、插件和内核选项；自定义 R 必须提供 response。
 * @returns 具有十个柯里化动词的独立客户端。
 * @example `const api = createAxp(); await api.get('/pets')()`
 */
export function createAxp<S = unknown, R extends IAxpResponse = AxpResponse>(...args: TAxpArgs<R, AxpOptions<R>>): AxpClient<S, R> {
  const options = (args[0] ?? {}) as AxpOptions<R>;
  const axios = options.axios ?? createAxios();
  const factory = guardFactory((options.response ?? DEFAULT_RESPONSE_FACTORY) as IAxpResponseFactory<R>);
  const log = options.debug ? (typeof options.debug === "boolean" ? console : options.debug) : NO_LOG;
  const registrations: IAxpRegistration<R>[] = [];
  const pending = new Set<AbortController>();
  const transport = createTransport(axios, factory);
  let inspection: readonly IAxpLayer<R>[] = [];
  let run = transport;
  let sequence = 0;
  let disposed = false;

  /** 插件集合变化时编译一次，在途请求保留旧执行器。 */
  function compile(sorted = sortPipeline(registrations)): void {
    inspection = sorted;
    run = composePipeline(sorted, transport);
  }
  /** 按客户端内唯一名称查找注册项，供装卸和管理 API 共用。 */
  function findRegistration(name: string): IAxpRegistration<R> | undefined {
    return registrations.find(/** 匹配目标插件的唯一名称。 */ (entry) => entry.plugin.name === name);
  }
  /** 销毁后的客户端不能继续执行新工作。 */
  function assertActive(): void {
    if (disposed) throw new Error("Axp client is disposed");
  }
  /** 校验并登记插件、建立独立实例，立即按完整候选链重新编译；安装期会多编译几次，换来 use 与启动同一条路径。 */
  function register(plugin: AxpPlugin<R, any>): void {
    assertActive();
    // 先用静态信息校验重名与阶段，非法插件不会触发 setup 副作用。
    sortPipeline([...registrations, { plugin, instance: {} }]);
    const instance = plugin.enable === false ? {} : (plugin.setup?.(client as AxpClient<unknown, R>) ?? {});
    const registration = { plugin, instance };
    try {
      // 再用真实实例校验 setup 动态返回的 handle / taps，失败则清理刚建立的实例。
      const sorted = sortPipeline([...registrations, registration]);
      registrations.push(registration);
      compile(sorted);
    } catch (error) {
      instance.dispose?.();
      throw error;
    }
  }
  /** 发起一个逻辑请求，清理完成后才执行落定回调。 */
  async function dispatch(config: AxpRequestConfig): Promise<unknown> {
    assertActive();
    const snapshot = run;
    const callsite = options.debug ? new Error() : undefined;
    const controller = new AbortController();
    const signal = config.signal ?? (axios.defaults.signal as AbortSignal | undefined);
    let detach: (() => void) | undefined;
    if (signal) {
      /** 有用户 signal 时才创建联动监听。 */
      const abort = () => controller.abort(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener(ABORT_EVENT, abort, { once: true });
      detach = /** 请求落定后解绑联动监听。 */ () => signal.removeEventListener(ABORT_EVENT, abort);
    }
    pending.add(controller);
    let ctx: AxpContext<R>;
    let response: R;
    try {
      // 逻辑请求只在入口合并一次 defaults，所有阶段和 key 看到同一份有效配置。
      const view = mergeConfig(axios.defaults as AxiosRequestConfig, config) as AxpRequestConfig;
      // mergeConfig 的 method 只取请求级；补齐实际发送方法，让各阶段和指纹保持一致。
      view.method = normalizeMethod(view.method || axios.defaults.method);
      view.headers = effectiveHeaders(view);
      view.signal = controller.signal;
      ctx = new AxpContext<R>({
        id: ++sequence,
        client: client as AxpClient<unknown, R>,
        request: view,
        signal: controller.signal,
        log,
        factory,
        key: options.key,
        origin: config,
      });
      response = cancelIfAborted(ctx) ?? (await snapshot(ctx));
    } finally {
      pending.delete(controller);
      detach?.();
    }
    return settle(response, ctx, options, callsite);
  }
  const client = {
    axios,
    request: dispatch,
    /** 克隆 defaults 并重新 setup 默认继承的插件。 */
    extend(
      overrides: AxiosRequestConfig = {},
      opts: {
        /** 子客户端插件列表。 */ plugins?: "inherit" | readonly AxpPlugin<R, any>[];
      } = {},
    ) {
      assertActive();
      const childAxios = createAxios(cloneAxiosDefaults(axios.defaults as AxiosRequestConfig));
      const plugins = opts.plugins === undefined || opts.plugins === "inherit" ? registrations.map(/** 提取已登记插件定义，供子客户端重新 setup。 */ (entry) => entry.plugin) : opts.plugins;
      const child = createAxp<S, R>({ ...options, axios: childAxios, plugins } as AxpOptions<R>);
      try {
        // 插件 setup（如 envs）写完 defaults 之后再应用显式覆盖，覆盖项优先。
        assignAxiosDefaults(childAxios.defaults, overrides);
      } catch (error) {
        child.dispose();
        throw error;
      }
      return child;
    },
    use: register,
    /** 卸载实例并重编译，在途执行器保持快照。 */
    eject(name: string): boolean {
      const entry = findRegistration(name);
      if (!entry) return false;
      registrations.splice(registrations.indexOf(entry), 1);
      compile();
      entry.instance.dispose?.();
      return true;
    },
    /** 返回当前客户端的插件 API。 */
    plugin<A>(plugin: AxpPlugin<R, A>): A | undefined {
      return findRegistration(plugin.name)?.instance.api as A | undefined;
    },
    /** 中止活跃的逻辑请求并统计首次中止数量。 */
    cancelAll(reason?: string): number {
      let count = 0;
      for (const controller of pending) {
        if (!controller.signal.aborted) {
          controller.abort(reason);
          count++;
        }
      }
      return count;
    },
    /** 返回尚未落定的请求数量。 */
    pending: () => pending.size,
    /** 返回副本，调用者不能改变编译快照。 */
    inspect: () => inspection.map(/** 仅暴露插件名字与阶段，隔离内部排序字段。 */ ({ name, stage }) => ({ name, stage })),
    /** 按共享品牌收窄为当前 R。 */
    isResponse: isAxpResponse<R>,
    /** 中止在途请求并卸载所有实例；重复调用无副作用。 */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      client.cancelAll();
      const removed = registrations.splice(0);
      compile();
      const errors: unknown[] = [];
      // 逆序清理，单个实例失败不影响其余实例。
      for (let index = removed.length - 1; index >= 0; index--) {
        try {
          removed[index].instance.dispose?.();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw errors[0];
    },
  } as unknown as AxpClient<S, R>;
  /** 为一组 payload 字段相同的方法绑定柯里化入口。 */
  function bindMethods(methods: readonly HttpMethodLower[], field: "data" | "params"): void {
    for (const method of methods) {
      /** 生成动词的柯里化分派入口。 */
      const verb =
        (url: string, methodConfig?: AxpRequestConfig) =>
        /** 调用配置最后覆盖方法配置及 payload。 */
        (payload?: unknown, callConfig?: AxpRequestConfig) => {
          const config: Record<string, unknown> = {
            url,
            method,
            [field]: payload,
            ...methodConfig,
          };
          // 调用级覆盖方法级，但 undefined 不覆盖，与 axios mergeConfig 对 undefined 的处理一致。
          for (const [key, value] of Object.entries(callConfig ?? {})) {
            if (value !== undefined) config[key] = value;
          }
          return dispatch(config as AxpRequestConfig);
        };
      Object.assign(client, { [method]: verb });
    }
  }
  bindMethods(BODY_METHODS, "data");
  bindMethods(NO_BODY_METHODS, "params");
  try {
    for (const plugin of options.plugins ?? []) register(plugin);
  } catch (error) {
    client.dispose();
    throw error;
  }
  return client;
}
