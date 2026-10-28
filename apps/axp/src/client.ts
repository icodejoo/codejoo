import { create as createAxios, mergeConfig, type AxiosRequestConfig } from "axios";
import { AxpContext, NO_LOG } from "./context";
import { BODY_METHODS, NO_BODY_METHODS, normalizeMethod } from "./methods";
import { composePipeline, sortPipeline, type IAxpRegistration, type IAxpLayer } from "./pipeline";
import { AXP_KINDS, AxpResponse, DEFAULT_RESPONSE_FACTORY, guardFactory, isAxpResponse, type IAxpResponse, type IAxpResponseFactory } from "./response";
import { createTransport } from "./transport";
import type { AxpClient, AxpOptions, AxpPlugin, AxpRequestConfig, HttpMethodLower, TAxpArgs } from "./types";
import { assignAxiosDefaults, cloneAxiosDefaults, effectiveHeaders } from "./utils";

/** AbortSignal 的标准事件名。 */
const ABORT_EVENT = "abort";
/** 调用级为空时继承方法级配置的两个开关。 */
const INHERITED_FLAGS = ["wrap", "throws"] as const;

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
export function settle<R extends IAxpResponse>(response: R, ctx: AxpContext<R>, options: IAxpSettleOptions<R>, callsite?: Error | string): unknown {
  if (response.kind === AXP_KINDS.INTERNAL) throw response.error;
  const throws = ctx.request.throws ?? true;
  if (!response.ok && throws) {
    const stack = typeof callsite === "string" ? callsite : callsite?.stack;
    const failure = stack === undefined ? response : ctx.fail({ from: response, stack });
    if (failure.kind === AXP_KINDS.INTERNAL) throw failure.error;
    throw options.reject ? options.reject(failure) : failure;
  }
  return ctx.request.wrap || !throws ? response : response.data;
}

/** 创建自有洋葱管线客户端，不修改 axios 拦截器。
 * @param options 传输实例、响应工厂、插件和内核选项；自定义 R 必须提供 response。
 * @param overrides 内部用于 extend，在插件 setup 后应用显式覆盖。
 * @returns 具有十个柯里化动词的独立客户端。
 * @example `const api = createAxp(); await api.get('/pets')()`
 */
export function createAxp<S = unknown, R extends IAxpResponse = AxpResponse>(...args: TAxpArgs<R, AxpOptions<R>>): AxpClient<S, R>;
/** @internal extend 在插件装配完成后应用显式默认配置。 */
export function createAxp<S = unknown, R extends IAxpResponse = AxpResponse>(options: AxpOptions<R>, overrides: AxiosRequestConfig): AxpClient<S, R>;
export function createAxp<S = unknown, R extends IAxpResponse = AxpResponse>(options: AxpOptions<R> = {} as AxpOptions<R>, defaultOverrides?: AxiosRequestConfig): AxpClient<S, R> {
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
  /** 校验并登记插件、建立独立实例；compiling 为 false 时由调用方统一编译。 */
  function register(plugin: AxpPlugin<R, any>, compiling: boolean): void {
    assertActive();
    // 先用静态信息校验重名与阶段，非法插件不会触发 setup 副作用。
    sortPipeline([...registrations, { plugin, instance: {} }]);
    const instance = plugin.enable === false ? {} : (plugin.setup?.(client as AxpClient<unknown, R>) ?? {});
    const registration = { plugin, instance };
    try {
      // 再用真实实例校验 setup 动态返回的 handle / taps，失败则清理刚建立的实例。
      const sorted = sortPipeline([...registrations, registration]);
      registrations.push(registration);
      if (compiling) compile(sorted);
    } catch (error) {
      instance.dispose?.();
      throw error;
    }
  }
  /** 动态安装插件，并立即按完整候选链重新编译。 */
  function use(plugin: AxpPlugin<R, any>): void {
    register(plugin, true);
  }
  /** 发起一个逻辑请求，清理完成后才执行落定回调。 */
  async function dispatch(config: AxpRequestConfig): Promise<unknown> {
    assertActive();
    const snapshot = run;
    const callsite = options.debug ? new Error() : undefined;
    const controller = new AbortController();
    const signal = config.signal ?? (axios.defaults.signal as AbortSignal | undefined);
    let abort: (() => void) | undefined;
    if (signal) {
      /** 有用户 signal 时才创建联动监听。 */
      abort = () => controller.abort(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener(ABORT_EVENT, abort, { once: true });
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
      response = controller.signal.aborted ? ctx.fail({ kind: AXP_KINDS.CANCEL }) : await snapshot(ctx);
    } finally {
      pending.delete(controller);
      if (signal && abort) signal.removeEventListener(ABORT_EVENT, abort);
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
      return createAxp<S, R>({ ...options, axios: childAxios, plugins } as AxpOptions<R>, overrides);
    },
    use,
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
          const config: AxpRequestConfig = {
            url,
            method,
            [field]: payload,
            ...methodConfig,
            ...callConfig,
          };
          // 两个开关“调用级优先、为空继承方法级”，两级都没写就不留键。
          for (const flag of INHERITED_FLAGS) {
            const value = callConfig?.[flag] ?? methodConfig?.[flag];
            if (value === undefined) delete config[flag];
            else config[flag] = value;
          }
          return dispatch(config);
        };
      Object.assign(client, { [method]: verb });
    }
  }
  bindMethods(BODY_METHODS, "data");
  bindMethods(NO_BODY_METHODS, "params");
  try {
    for (const plugin of options.plugins ?? []) register(plugin, false);
    if (defaultOverrides) assignAxiosDefaults(axios.defaults, defaultOverrides);
    compile();
  } catch (error) {
    client.dispose();
    throw error;
  }
  return client;
}
