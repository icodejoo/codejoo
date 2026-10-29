import { create as createAxios, type AxiosAdapter, type AxiosRequestConfig, type CreateAxiosDefaults } from "axios";
import { expect } from "vitest";
import { createAxp } from "../../src/client";
import { AxpResponse, axpResponse, type AxpResponseInit, type IAxpResponse } from "../../src/response";
import type { AxpClient, AxpOptions, AxpPlugin } from "../../src/types";
import { makeNetwork } from "./network";

/** 测试中可观测的逻辑请求事件。 */
export interface ITestEvents {
  /** 每个逻辑请求的落定次数。 */
  settled: Map<number, number>;
  /** 各回调的显示/隐藏记录。 */
  loading: Map<string, boolean[]>;
  /** 每个逻辑请求的通知次数。 */
  notify: Map<number, number>;
  /** 每一刷新轮的调用次数。 */
  refresh: Map<number, number>;
  /** 过期通知轮次。 */
  expired: number[];
  /** 拒绝通知轮次。 */
  denied: number[];
  /** 监听注册与注销的净数。 */
  listeners: number;
  /** next 意外 reject 的次数。 */
  rejectedNext: number;
}
/** 建立无副作用的事件记录器。
 * @returns 供插件回调与不变量断言共享的记录。
 * @example `const events = recordEvents()`
 */
export function recordEvents(): ITestEvents {
  return {
    settled: new Map(),
    loading: new Map(),
    notify: new Map(),
    refresh: new Map(),
    expired: [],
    denied: [],
    listeners: 0,
    rejectedNext: 0,
  };
}
/** 创建假网络上的新客户端；需要自定义传输时用 transport 覆盖假网络。
 * @param plugins 测试插件。
 * @param opts 内核选项；自定义响应类型 R 时必须带 response。
 * @param transport 替换假网络的 adapter，或追加的 axios 选项（如 `{ adapter: "http" }`）。
 * @returns 客户端、路由网络及事件记录器。
 * @example `const { api, net } = createTestClient([])`
 */
export function createTestClient<R extends IAxpResponse = AxpResponse>(
  plugins: readonly AxpPlugin<R, any>[] = [],
  opts: AxpOptions<R> = {} as AxpOptions<R>,
  transport?: AxiosAdapter | AxiosRequestConfig | CreateAxiosDefaults,
) {
  const net = makeNetwork();
  net.on("post", "/echo", /** 把请求体原样放进信封回显。 */ (config) => ({ data: { code: 0, data: config.data } }));
  const overrides = typeof transport === "function" ? { adapter: transport } : transport;
  const axios = opts.axios ?? createAxios({ adapter: net.adapter, ...overrides });
  return {
    api: createAxp<unknown, R>({ ...opts, axios, plugins } as AxpOptions<R>),
    net,
    events: recordEvents(),
  };
}
/** 检查 I1–I6 的观测记录，插件批次继续填充相应事件。
 * @param api 待检查客户端。
 * @param events 本次测试的事件。
 * @example `assertInvariants(api, events)`
 */
export function assertInvariants(api: Pick<AxpClient, "pending">, events: ITestEvents): void {
  for (const count of events.settled.values()) expect(count).toBe(1);
  for (const values of events.loading.values()) {
    expect(values.length % 2).toBe(0);
    values.forEach(/** 显示与隐藏必须成对出现，且以显示开头。 */ (value, index) => expect(value).toBe(index % 2 === 0));
  }
  expect(api.pending()).toBe(0);
  expect(events.listeners).toBe(0);
  for (const count of events.notify.values()) expect(count).toBeLessThanOrEqual(1);
  for (const count of events.refresh.values()) expect(count).toBe(1);
  expect(events.rejectedNext).toBe(0);
}
/** 带追踪字段的响应样例。 */
export class TestResponse<D = unknown> extends AxpResponse<D> {
  /** 服务端追踪标识。 */
  traceId = "";
}
/** 创建保留扩展字段的响应工厂。
 * @returns 带 traceId 的工厂。
 * @example `createAxp<unknown, TestResponse>({ response: customResponse() })`
 */
export function customResponse() {
  return axpResponse<TestResponse>({
    /** 命中从快照输入取追踪标识，派生时保留来源，其余从响应头补充。 */
    create: (init, raw) =>
      Object.assign(new TestResponse(init), {
        traceId: (init as AxpResponseInit<TestResponse> & { traceId?: string }).traceId ?? init.from?.traceId ?? String(raw?.headers["x-trace-id"] ?? ""),
      }),
  });
}
