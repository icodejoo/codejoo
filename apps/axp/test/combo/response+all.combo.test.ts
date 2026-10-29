import { beforeEach, describe, expect, it, vi } from "vitest";
import axpAuth, { type IAuthOptions } from "../../src/plugins/auth";
import axpCache from "../../src/plugins/cache";
import axpFilter from "../../src/plugins/filter";
import axpLoading from "../../src/plugins/loading";
import axpMock from "../../src/plugins/mock";
import axpNotify from "../../src/plugins/notify";
import axpRepath from "../../src/plugins/repath";
import axpRetry from "../../src/plugins/retry";
import axpShare from "../../src/plugins/share";
import { AXP_KINDS, type AxpKind } from "../../src/response";
import type { AxpLogger, AxpRequestConfig } from "../../src/types";
import { authSettings, deferred, failure, guarded, REQUEST_URL, TOKEN_NEW } from "../helpers/b3";
import { customResponse, recordEvents, TestResponse } from "../helpers/client";
import { createInvariantHarness, createNotifyRecorder } from "../helpers/invariants";
import { envelope } from "../helpers/source";
import { loadingRecorder } from "../helpers/ui";

/** 服务端回传追踪头的名字，customResponse 据此填 traceId。 */
const TRACE_HEADER = "x-trace-id";
/** 各条流程里服务端回传的追踪标识。 */
const TRACE = {
  expired: "t-401",
  denied: "t-403",
  ok: "t-ok",
  failed: "t-500",
} as const;
/** 没有来源响应、完全由插件合成时的追踪标识：工厂给出的初值。 */
const NO_TRACE = "";
/** 重试等待时长，比取消时刻长，保证取消落在等待里。 */
const RETRY_WAIT = 100;
/** 取消前推进的假时间。 */
const CANCEL_AT = 20;
/** 共享请求的网络延迟，让跟随者的超时与取消落在它之前。 */
const SLOW = 50;
/** 跟随者的超时。 */
const FOLLOWER_TIMEOUT = 5;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 带追踪头的路由结果。 */
function traced(status: number, trace: string, data: unknown = null) {
  return { status, data: { code: 0, data }, headers: { [TRACE_HEADER]: trace } };
}
/** 一个什么都不输出的日志器，只为打开 debug 记录调用点。 */
const SILENT_LOGGER: AxpLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** 装好全部九个内置插件，响应类型是带 traceId 的自定义 R，并带上全套不变量观测。
 * @param overrides 鉴权选项覆盖，如刷新门。
 * @param debug 是否打开 debug，让失败落定时派生带调用点的副本。
 */
function fullClient(overrides: Partial<IAuthOptions<TestResponse>> = {}, debug = false) {
  const events = recordEvents();
  const settings = authSettings(overrides, events);
  const h = createInvariantHarness<TestResponse>(
    [
      axpLoading<TestResponse>({ loading: loadingRecorder(events) }),
      axpNotify<TestResponse>(createNotifyRecorder<TestResponse>(events)),
      axpRepath<TestResponse>(),
      axpFilter<TestResponse>(),
      axpRetry<TestResponse>({ max: 1, delay: RETRY_WAIT }),
      axpAuth<TestResponse>(settings),
      axpMock<TestResponse>({ enable: true }),
      axpShare<TestResponse>(),
      axpCache<TestResponse>({ clone: "shallow" }),
    ],
    { events, options: { response: customResponse(), ...(debug ? { debug: SILENT_LOGGER } : {}) } },
  );
  return { ...h, settings };
}
/** 发出一个不抛错的请求，落定值就是 R。 */
function send(h: ReturnType<typeof fullClient>, config: AxpRequestConfig = {}) {
  return h.launch({ url: REQUEST_URL, throws: false, ...config });
}
/** 排空后检查不变量，并返回每个逻辑请求的落定值。 */
async function finish(h: ReturnType<typeof fullClient>): Promise<TestResponse[]> {
  await h.drain();
  h.assertAll();
  return h.requests.map(/** 落定值。 */ (request) => request.value as TestResponse);
}
/** 断言响应是自定义 R：类别、原因与追踪标识。 */
function expectCustom(r: TestResponse, kind: AxpKind, reason: string | undefined, trace: string) {
  expect(r).toBeInstanceOf(TestResponse);
  expect(r).toMatchObject({ kind, reason, traceId: trace });
}

describe("[core.opt.response][core.fn.createAxp] 自定义 R + 全部内置插件：各插件经 ctx.fail 合成或派生的响应也是自定义 R，扩展字段存在", () => {
  it("[auth.reason.expired] 刷新失败：auth 过期响应派生自 401，沿用它的追踪标识", async () => {
    const h = fullClient({ onRefresh: /** 刷新失败。 */ () => false });
    h.net.on("get", REQUEST_URL, () => traced(401, TRACE.expired));
    send(h);
    const [r] = await finish(h);
    expectCustom(r, AXP_KINDS.AUTH, "expired", TRACE.expired);
    h.dispose();
  });

  it("[auth.reason.denied] 越权：auth 拒绝响应派生自 403，沿用它的追踪标识", async () => {
    const h = fullClient();
    h.net.on("get", REQUEST_URL, () => traced(403, TRACE.denied));
    send(h);
    const [r] = await finish(h);
    expectCustom(r, AXP_KINDS.AUTH, "denied", TRACE.denied);
    h.dispose();
  });

  it("[auth.reason.unauthenticated] 本地无 token：没有来源响应，完全合成，扩展字段取工厂初值", async () => {
    const h = fullClient();
    h.settings.tokenManager.clear();
    send(h);
    const [r] = await finish(h);
    expectCustom(r, AXP_KINDS.AUTH, "unauthenticated", NO_TRACE);
    expect(h.net.totalStarted).toBe(0);
    h.dispose();
  });

  it("[share.req.share][share.fn.subscribe] 跟随者超时：由 share 合成 timeout 响应，首发不受影响并带服务端追踪标识", async () => {
    const h = fullClient();
    h.net.on("get", REQUEST_URL, () => traced(200, TRACE.ok, "ok"));
    send(h, { share: true, latency: SLOW } as never);
    send(h, { share: true, latency: SLOW, timeout: FOLLOWER_TIMEOUT, retry: false } as never);
    const [leader, follower] = await finish(h);
    expectCustom(leader, AXP_KINDS.OK, undefined, TRACE.ok);
    expectCustom(follower, AXP_KINDS.TIMEOUT, undefined, NO_TRACE);
    expect(h.net.totalStarted).toBe(1);
    h.dispose();
  });

  it("[share.req.share][core.method.cancelAll] 跟随者取消自己的 signal：由 share 合成 cancel 响应，首发仍成功", async () => {
    const h = fullClient();
    h.net.on("get", REQUEST_URL, () => traced(200, TRACE.ok, "ok"));
    const follower = new AbortController();
    send(h, { share: true, latency: SLOW } as never);
    send(h, { share: true, latency: SLOW, signal: follower.signal } as never);
    await vi.advanceTimersByTimeAsync(CANCEL_AT);
    follower.abort();
    const [leader, cancelled] = await finish(h);
    expectCustom(leader, AXP_KINDS.OK, undefined, TRACE.ok);
    expectCustom(cancelled, AXP_KINDS.CANCEL, undefined, NO_TRACE);
    h.dispose();
  });

  it("[retry.opt.delay][core.method.cancelAll] 重试等待期间 cancelAll：由 retry 合成 cancel 响应", async () => {
    const h = fullClient();
    h.net.on("get", REQUEST_URL, () => failure(500));
    send(h);
    await vi.advanceTimersByTimeAsync(CANCEL_AT);
    expect(h.api.cancelAll()).toBe(1);
    const [r] = await finish(h);
    expectCustom(r, AXP_KINDS.CANCEL, undefined, NO_TRACE);
    h.dispose();
  });

  it("[auth.cb.onRefresh][core.method.cancelAll] 等待刷新的请求被 cancelAll：由 auth 合成 cancel 响应，两个请求都是自定义 R", async () => {
    const gate = deferred<boolean>();
    const h = fullClient({
      onRefresh: /** 等门打开再换 token。 */ async (_r, tm) => {
        await gate.promise;
        tm.set(TOKEN_NEW);
      },
    });
    h.net.on(
      "get",
      REQUEST_URL,
      guarded(() => TOKEN_NEW),
    );
    send(h);
    await h.drain();
    send(h, { url: `${REQUEST_URL}?waiting` });
    await vi.advanceTimersByTimeAsync(CANCEL_AT);
    expect(h.api.cancelAll()).toBe(2);
    gate.resolve(true);
    const results = await finish(h);
    for (const r of results) expectCustom(r, AXP_KINDS.CANCEL, undefined, NO_TRACE);
    h.dispose();
  });

  it("[cache.opt.clone][cache.req.cache] 缓存命中按 clone 派生的响应：沿用来源的追踪标识，data 是拷贝", async () => {
    const h = fullClient();
    h.net.on("get", REQUEST_URL, () => traced(200, TRACE.ok, { list: [1] }));
    send(h, { cache: true });
    await h.drain();
    send(h, { cache: true });
    const [miss, hit] = await finish(h);
    expectCustom(miss, AXP_KINDS.OK, undefined, TRACE.ok);
    expectCustom(hit, AXP_KINDS.OK, undefined, TRACE.ok);
    expect(hit).not.toBe(miss);
    expect(hit.data).toEqual(miss.data);
    expect(h.net.totalStarted).toBe(1);
    h.dispose();
  });

  it("[core.opt.debug][core.req.throws] debug 开启时失败落定派生的调用点副本：仍是自定义 R，追踪标识沿用，带 stack", async () => {
    const h = fullClient({}, true);
    h.net.on("get", REQUEST_URL, () => traced(404, TRACE.failed));
    h.launch({ url: REQUEST_URL });
    await h.drain();
    h.assertAll();
    const thrown = h.requests[0];
    expect(thrown.outcome).toBe("rejected");
    const r = thrown.value as TestResponse;
    expectCustom(r, AXP_KINDS.HTTP, undefined, TRACE.failed);
    expect(r.stack).toBeTypeOf("string");
    h.dispose();
  });
});

it("[core.opt.response] 全插件在成功路径上同样产出自定义 R：服务端追踪头进入 traceId", async () => {
  const h = fullClient();
  h.net.on("get", REQUEST_URL, () => ({
    ...envelope("ok"),
    headers: { [TRACE_HEADER]: TRACE.ok },
  }));
  send(h);
  const [r] = await finish(h);
  expectCustom(r, AXP_KINDS.OK, undefined, TRACE.ok);
  h.dispose();
});
