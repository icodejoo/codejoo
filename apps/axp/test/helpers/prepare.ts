import { type AxpResponse, DEFAULT_RESPONSE_FACTORY } from "../../src/response";
import type { AxpPlugin, AxpRequestConfig } from "../../src/types";
import { createTestClient } from "./client";

/** 以实际 prepare 上下文作为观测点，避开 axios 后续序列化与复制。
 * @param plugins 本次待测的 prepare 插件。
 * @param transport 可选传输配置。
 * @returns 客户端及读取最近一次 prepare 后请求视图的函数。
 * @example `const { api } = preparedClient([axpFilter()])`
 */
export function preparedClient(plugins: readonly AxpPlugin<AxpResponse>[], transport?: Parameters<typeof createTestClient>[2]) {
  let request: Readonly<AxpRequestConfig> = {};
  const fixture = createTestClient(
    plugins,
    {
      response: {
        ...DEFAULT_RESPONSE_FACTORY,
        /** 捕获真实上下文，保持默认工厂的响应契约。 */
        fromResponse(raw, ctx) {
          request = ctx.request;
          return DEFAULT_RESPONSE_FACTORY.fromResponse(raw, ctx);
        },
      },
    },
    transport,
  );
  return { ...fixture, /** 读取最近一次内层实际看到的配置。 */ request: () => request };
}
