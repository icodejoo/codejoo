import { AxpContext, NO_LOG } from "../../src/context";
import { DEFAULT_RESPONSE_FACTORY, guardFactory, type IAxpResponseFactory } from "../../src/response";
import type { AxpClient, AxpLogger, AxpRequestConfig } from "../../src/types";

/** 创建纯单元层上下文，不构造 axios 实例或假网络。
 * @param request 初始请求视图。
 * @param factory 响应工厂，会像客户端装配时一样被保护。
 * @param log 日志器；需要断言日志时传独立实例，避免污染共享的 NO_LOG。
 * @returns 可直接传给管线或传输的根上下文。
 * @example `const ctx = testContext({ url: '/pets' })`
 */
export function testContext(request: AxpRequestConfig = {}, factory: IAxpResponseFactory = DEFAULT_RESPONSE_FACTORY, log: AxpLogger = NO_LOG) {
  return new AxpContext({
    id: 1,
    client: {} as AxpClient,
    request,
    signal: new AbortController().signal,
    log,
    factory: guardFactory(factory),
  });
}
