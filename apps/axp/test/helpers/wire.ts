import { type CreateAxiosDefaults, type InternalAxiosRequestConfig } from "axios";
import type { AxpResponse } from "../../src/response";
import type { AxpPlugin } from "../../src/types";
import { createTestClient } from "./client";

/** 真实 axios 到假 adapter 边界的发送记录。 */
export interface IWireCall {
  /** 已经过用户拦截器和转换器的实际配置。 */
  config: InternalAxiosRequestConfig;
  /** axios 公开 getUri 序列化后的有效地址。 */
  url: string;
}

/** 建立真实 axios 实例，在假 adapter 中记录最终发送配置。
 * @param defaults 用户实例的默认配置。
 * @param plugins 本次装配的管线插件。
 * @returns 客户端、原 axios 实例和发送记录。
 * @example `const h = wireClient({ params: { tenant: 'a' } }, [axpFilter()])`
 */
export function wireClient(defaults: CreateAxiosDefaults = {}, plugins: AxpPlugin<AxpResponse>[] = []) {
  const calls: IWireCall[] = [];
  const { api } = createTestClient(
    plugins,
    {},
    {
      ...defaults,
      /** 直接记录发送边界，不通过测试响应工厂替换请求视图。 */
      adapter: async (config) => {
        calls.push({ config, url: api.axios.getUri(config) });
        return {
          /** 实际请求配置。 */ config,
          /** 成功的 HTTP 状态。 */ status: 200,
          /** 未提供状态文本。 */ statusText: "",
          /** 没有额外响应头。 */ headers: {},
          /** 默认成功信封。 */ data: { code: 0, data: "ok" },
        };
      },
    },
  );
  return { api, axios: api.axios, calls };
}
