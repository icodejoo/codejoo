import { AxiosError } from 'axios';
import AxpResponse, { AxpError } from '../objects/Response';
import type { Plugin } from '../types';
import { pluginLog } from '../helper';


const name = 'axp:normalize'
/**
 * 严格响应校验插件：业务失败(`successful === false`)时以 `AxpError` reject；不改写成功响应的 `response.data`，返回形态统一由 `Core` dispatch 决定。
 *
 * Strict response-validation plugin: rejects with an `AxpError` on business failure (`successful === false`); never rewrites a successful response's `response.data` — return-shape decisions belong to `Core`'s dispatch.
 *
 * @param options 插件配置，见 {@link INormalizeOptions}，默认 `{}` / plugin options, see {@link INormalizeOptions}, defaults to `{}`
 * @returns 一个 `Plugin`，install 时注册响应拦截器，卸载时 eject / a `Plugin` that registers a response interceptor on install and ejects it on teardown
 */
export default function axpNormalize(
  { enable = true }: INormalizeOptions = {},
): Plugin {
  return {
    name: name,
    install(axios) {
      pluginLog(axios.defaults, `[${name}] enabled:${enable}`)
      if (!enable) return;
      const id = axios.interceptors.response.use(
        function $normalize(response) {
          const api = AxpResponse.fromResponse(response);
          if (api.successful) return response;
          // 业务失败：reject 一个真正的 Error(携带 ApiResponse)，而非裸响应对象
          return Promise.reject(new AxpError(api));
        },
        function $normalize(error: unknown) {
          const err = error as AxiosError;
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
  interface InternalAxiosRequestConfig {
    /** 本次请求解析后生效的 normalize 选项 / the resolved normalize options in effect for this request */
    normalize?: INormalizeOptions
  }
}
