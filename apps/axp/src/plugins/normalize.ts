import { AxiosError } from 'axios';
import AxpResponse, { ApiError } from '../objects/Response';
import type { Plugin } from '../types';
import { __DEV__ } from '../helper';


const name = 'normalize'
/** 严格响应校验插件：业务判定失败(`successful === false`)时以 `ApiError` reject，
 *  并保证错误链路上 `error.response.data` 也是一个结构化 `ApiResponse`。
 *
 *  注意：本插件**不再改写**成功响应的 `response.data`(保留后端原始信封)，
 *  `raw` / `wrap` / 解包三种返回形态由 `Core` 的 dispatch 统一决定，二者职责不重叠。 */
export default function normalize(
  { enable = true }: INormalizeOptions = {},
): Plugin {
  return {
    name: name,
    install(ctx) {
      if (__DEV__) ctx.logger.log(`${name} enabled:${enable}`)
      if (!enable) return;
      ctx.response(
        function $normalize(response) {
          const api = AxpResponse.fromResponse(response);
          if (api.successful) return response;
          // 业务失败：reject 一个真正的 Error(携带 ApiResponse)，而非裸响应对象
          return Promise.reject(new ApiError(api));
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
    },
  };
}

// 工厂名与插件名对齐,支持 `api.eject(normalize)`。
// 函数 .name 只读但可重定义,严格模式 ESM 下必须用 defineProperty 而非直接赋值。
Object.defineProperty(normalize, 'name', { value: name })

export interface INormalizeOptions {
  enable?: boolean,
  nullable?: boolean
}

declare module "../types" {
  interface ICommonOptions {
    normalize?: MaybeFun<INormalizeOptions | boolean | Falsy>
  }
}

declare module "axios" {
  interface InternalAxiosRequestConfig {
    normalize?: INormalizeOptions
  }
}
