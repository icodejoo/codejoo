import { vi } from "vitest";
import type { ITokenManager } from "../../src/objects/TokenManager";
import axpAuth, { type IAuthOptions } from "../../src/plugins/auth";
import type { AxpResponse } from "../../src/response";
import type { AxpOptions, AxpPlugin, AxpRequestConfig } from "../../src/types";
import { authHeader } from "./auth";
import type { ITestEvents } from "./client";
import type { RouteHandler, RouteResult } from "./network";
import { uiClient } from "./ui";

/** 测试会话与路由固定值。 */
export const TOKEN_OLD = "token-old";
export const TOKEN_NEW = "token-new";
export const REFRESH_TOKEN = "refresh-token";
export const REQUEST_URL = "/protected";
export const AUTH_NAME = "axp:auth";
export const RETRY_NAME = "axp:retry";
/** 无存储副作用的会话管理器。
 * @param access 初始 access token。
 * @param refresh 初始 refresh token。
 * @returns 可直接交给 auth 的管理器。
 * @example `memoryTokens(TOKEN_OLD)`
 */
export function memoryTokens(
  access: string | undefined = TOKEN_OLD,
  refresh: string | undefined = REFRESH_TOKEN,
): ITokenManager {
  return {
    /** 当前注入值。 */ get accessToken() {
      return access;
    },
    /** 当前刷新凭证。 */ get refreshToken() {
      return refresh;
    },
    /** 模拟登录或刷新原子写入。 */ set(a, r) {
      access = a;
      refresh = r;
    },
    /** 模拟登出。 */ clear() {
      access = undefined;
      refresh = undefined;
    },
  };
}
/** 默认刷新实现：同步换上新 token。 */
function defaultRefresh(_r: AxpResponse, tm: ITokenManager): void {
  tm.set(TOKEN_NEW, REFRESH_TOKEN);
}
/** 生成有可观测通知的鉴权配置；传入 events 时同步登记刷新轮次与通知，供 I5 等不变量核对。
 * @param overrides 指定本次路由或刷新行为。
 * @param events 可选事件记录；同一轮并发刷新重复调用会让 I5 失败。
 * @returns 配置和可直接断言的回调。
 * @example `authSettings({ onRefresh: () => false }, h.events)`
 */
export function authSettings(
  overrides: Partial<IAuthOptions<AxpResponse>> = {},
  events?: ITestEvents,
) {
  const refresh = overrides.onRefresh ?? defaultRefresh;
  let round = 0;
  let active = 0;
  return {
    tokenManager: memoryTokens(),
    onAccessExpired: vi.fn(),
    onAccessDenied: vi.fn(),
    ...overrides,
    onRefresh: vi.fn(
      /** 记录刷新轮次：同一轮重叠调用累加，轮次间各自为一。 */ async (
        r: AxpResponse,
        tm: ITokenManager,
      ) => {
        if (events) {
          if (active === 0) round++;
          active++;
          events.refresh.set(round, (events.refresh.get(round) ?? 0) + 1);
        }
        try {
          return await refresh(r, tm);
        } finally {
          active--;
        }
      },
    ),
  };
}
/** 包装真实客户端，观测逻辑 signal 和 next 的不变量。
 * @param plugins 插件列表。
 * @param options 客户端配置。
 * @returns 通过 send 发起请求的测试夹具。
 * @example `b3Client([axpRetry()])`
 */
export function b3Client(
  plugins: readonly AxpPlugin<AxpResponse, any>[] = [],
  options: AxpOptions = {},
) {
  const h = uiClient(plugins, options);
  h.api.use({
    name: "b3-observe",
    stage: "outer",
    enforce: "pre",
    /** 同时记录内部 signal 的监听和内层承诺的异常。 */
    async handle(ctx, next) {
      const signal = ctx.signal;
      const add = signal.addEventListener.bind(signal);
      const remove = signal.removeEventListener.bind(signal);
      vi.spyOn(signal, "addEventListener").mockImplementation(
        /** 记录每个插件等待者。 */ (...args) => {
          h.events.listeners++;
          add(...args);
        },
      );
      vi.spyOn(signal, "removeEventListener").mockImplementation(
        /** 每个等待者都必须注销。 */ (...args) => {
          h.events.listeners--;
          remove(...args);
        },
      );
      try {
        return await next();
      } catch (error) {
        h.events.rejectedNext++;
        throw error;
      }
    },
  });
  return h;
}
/** 带 auth 的客户端：已装好 axpAuth，回调接入事件记录。
 * @param overrides 鉴权选项覆盖。
 * @param plugins 与 auth 同装的其它插件。
 * @param options 客户端内核选项。
 * @returns 客户端夹具、鉴权设置与会话管理器。
 * @example `const h = authClient({ onRefresh: () => false })`
 */
export function authClient(
  overrides: Partial<IAuthOptions<AxpResponse>> = {},
  plugins: readonly AxpPlugin<AxpResponse, any>[] = [],
  options: AxpOptions = {},
) {
  const h = b3Client(plugins, options);
  const settings = authSettings(overrides, h.events);
  const plugin = axpAuth<AxpResponse>(settings);
  h.api.use(plugin);
  return { ...h, settings, tm: settings.tokenManager, plugin };
}
/** 模拟服务端失败：HTTP 状态，或 HTTP 200 加业务码（business 风格）。
 * @param status 逻辑状态。
 * @param business 是否用 HTTP 200 + 业务码表达。
 * @returns 路由结果。
 * @example `net.on('get', URL, () => failure(401, true))`
 */
export function failure(status: number, business = false): RouteResult {
  return business ? { status: 200, data: { code: status, data: null } } : { status };
}
/** 服务端按 token 放行：携带的 Authorization 等于当前认可值才成功，否则 401。
 * @param accept 返回服务端当前认可的 token。
 * @param business 是否把 401 写成业务码。
 * @returns 可注册到假网络的路由处理器。
 * @example `net.on('get', URL, guarded(() => TOKEN_NEW))`
 */
export function guarded(accept: () => string | undefined, business = false): RouteHandler {
  return /** 对比本次请求头与认可值。 */ (config) =>
    authHeader(config) === accept() ? { data: { code: 0, data: "ok" } } : failure(401, business);
}
/** 发起默认受保护路由的请求并推进假时钟直到落定。
 * @param h 带 send 的测试夹具。
 * @param config 覆盖默认路由的请求配置。
 * @returns 落定后的响应。
 * @example `const r = await run(h, { retry: 1 })`
 */
export async function run<T>(
  h: { send(config?: AxpRequestConfig): Promise<T> },
  config: AxpRequestConfig = {},
): Promise<T> {
  const pending = h.send({ url: REQUEST_URL, ...config });
  // 推进时钟期间失败的请求先标记为已观察，避免被当成未处理拒绝；调用方 await 时仍照常收到拒绝。
  pending.catch(/** 仅标记已观察。 */ () => undefined);
  await vi.runAllTimersAsync();
  return pending;
}
/** 可控的异步门，构造刷新窗口和乱序响应。
 * @returns 承诺及放行函数。
 * @example `const gate = deferred<boolean>(); gate.resolve(true)`
 */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(
    /** 暴露测试放行入口。 */ (done) => {
      resolve = done;
    },
  );
  return { promise, resolve };
}
/** 带嵌套数组的请求体：axios 只浅拷贝顶层对象，嵌套元素要靠 markReplayable 触发的克隆来保护。
 * @returns 每次调用得到全新的 `{ items: [{ n: 0 }] }`。
 * @example `const data = pollutingBody()`
 */
export function pollutingBody() {
  return { items: [{ n: 0 }] };
}
/** 原地改动嵌套元素的转换器，模拟会污染重发的实现。
 * @param input 请求体。
 * @returns 序列化后的请求体。
 * @example `transformRequest: [pollutingTransform]`
 */
export function pollutingTransform(input: ReturnType<typeof pollutingBody>): string {
  input.items[0]!.n++;
  return JSON.stringify(input);
}
/** 无污染时每次发送都应得到的请求体。 */
export const POLLUTED_ONCE = JSON.stringify({ items: [{ n: 1 }] });
