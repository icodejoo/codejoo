import { AxiosError } from 'axios';
import AxpResponse, { AxpError } from '../objects/Response';
import type { Plugin, MaybeFun, Falsy } from '../types';
import type { AxiosRequestConfig } from 'axios';
import { pluginLog } from '../helper';


const name = 'axp:normalize'

/** 解析请求级开关，支持静态值、选项对象及按配置计算的函数。 */
function $isSkipped(config?: AxiosRequestConfig): boolean {
  const option = config?.normalize;
  const resolved = typeof option === 'function' ? option(config!) : option;
  return resolved === false || (typeof resolved === 'object' && resolved != null && resolved.enable === false);
}
/**
 * 严格响应校验插件：业务失败(`successful === false`)时以 `AxpError` reject；不改写成功响应的 `response.data`，返回形态统一由 `Core` dispatch 决定。
 *
 * Strict response-validation plugin: rejects with an `AxpError` on business failure (`successful === false`); never rewrites a successful response's `response.data` — return-shape decisions belong to `Core`'s dispatch.
 *
 * @param options 插件配置，见 {@link INormalizeOptions}，默认 `{}` / plugin options, see {@link INormalizeOptions}, defaults to `{}`
 * @returns 一个 `Plugin`，install 时注册响应拦截器，卸载时 eject / a `Plugin` that registers a response interceptor on install and ejects it on teardown
 * @example axpNormalize().install(ax); ax.get('/items', { normalize: false });
 */
export default function axpNormalize(
  { enable = true }: INormalizeOptions = {},
): Plugin {
  return {
    name: name,
    /** 注册最终响应校验，尊重请求级开关并保留清理所需配置。 */
    install(axios) {
      pluginLog(axios.defaults, `[${name}] enabled:${enable}`)
      if (!enable) return;
      const id = axios.interceptors.response.use(
        /** 校验启用归一化的最终响应，显式禁用时原样放行。 */
        function $normalize(response) {
          if ($isSkipped(response.config)) return response;
          const api = AxpResponse.fromResponse(response);
          if (api.successful) return response;
          // 业务失败：reject 一个真正的 Error(携带 ApiResponse)，而非裸响应对象
          return Promise.reject(Object.assign(new AxpError(api), { config: response.config }));
        },
        /** 保留 HTTP 错误，按请求开关决定是否附加结构化响应。 */
        function $normalize(error: unknown) {
          const err = error as AxiosError;
          if ($isSkipped(err.config)) return Promise.reject(err);
          // err.response 可能整体缺失(网络错误/超时)，fromResponse 已对 data=null 做防御
          const api = AxpResponse.fromResponse(
            err.response ?? { status: err.status ?? 0, data: null },
          );
          (err as AxiosError & { api?: AxpResponse }).api = api;
          return Promise.reject(err);
        },
      );
      return () => { axios.interceptors.response.eject(id); };
    },
  };
}

// 函数 .name 只读但可重定义，严格模式 ESM 下必须用 defineProperty 而非直接赋值 / a function's `.name` is read-only but redefinable — strict-mode ESM requires `defineProperty` instead of direct assignment
Object.defineProperty(axpNormalize, 'name', { value: name })

export interface INormalizeOptions {
  /** 插件总开关，默认 `true` / master on/off switch, default `true` */
  enable?: boolean,
  /** 预留字段，镜像 `IHttpOptions.nullable`，当前未被读取/消费 / reserved field mirroring `IHttpOptions.nullable`, not currently consumed */
  nullable?: boolean
}

declare module "../types" {
  interface ICommonOptions {
    /** 全局/请求级 normalize 配置 / global or per-request normalize config */
    normalize?: MaybeFun<INormalizeOptions | boolean | Falsy>
  }
}

declare module "axios" {
  interface AxiosRequestConfig {
    /** 请求级归一化开关或选项；false / enable:false 跳过校验。 */
    normalize?: MaybeFun<INormalizeOptions | boolean | Falsy>
  }
}
