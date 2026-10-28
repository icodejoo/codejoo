import { AxpResponse, DEFAULT_RESPONSE_FACTORY } from "../../src/response";
import type { AxpPlugin } from "../../src/types";
import { createTestClient } from "./client";

/** 以实际 prepare 上下文作为观测点，避开 axios 后续序列化与复制。
 * @param plugins 本次待测的 prepare 插件。
 * @param transport 可选传输配置。
 * @returns 可直接检查响应 request 中内层 patch 的客户端。
 * @example `const { api } = preparedClient([axpFilter()])`
 */
export function preparedClient(plugins: readonly AxpPlugin<AxpResponse>[], transport?: Parameters<typeof createTestClient>[2]) {
  return createTestClient(
    plugins,
    {
      response: {
        ...DEFAULT_RESPONSE_FACTORY,
        /** 只改变测试观测点，归一化仍使用 B1 默认工厂。 */
        fromResponse(raw, ctx) {
          return new AxpResponse({
            from: DEFAULT_RESPONSE_FACTORY.fromResponse(raw, ctx),
            request: ctx.request,
          });
        },
      },
    },
    transport,
  );
}
