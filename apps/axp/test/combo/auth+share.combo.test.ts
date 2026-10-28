import { AxiosHeaders } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpShare from "../../src/plugins/share";
import { AXP_KINDS, type AxpResponse } from "../../src/response";
import { authClient, failure, guarded, REQUEST_URL, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";
import { settleAll } from "../helpers/source";

/** 并发调用方数量。 */
const CALLERS = 4;
/** 一轮网络往返的延迟，让同一轮的调用方都停在共享条目上。 */
const LATENCY = 10;
/** 首发 401 与重放成功各一轮，共两次网络请求。 */
const ROUNDS_AFTER_REFRESH = 2;
/** 越权的 HTTP 状态。 */
const FORBIDDEN = 403;
/** 租户标识请求头，scope 据此分区。 */
const TENANT_HEADER = "x-tenant";
/** 两个互不相同的租户。 */
const TENANTS = ["tenant-a", "tenant-b"] as const;
/** 每个租户的调用方数量。 */
const CALLERS_PER_TENANT = 2;
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 装好 auth 与 share；服务端只认新 token。 */
function client(
  business = false,
  overrides: Parameters<typeof authClient>[0] = {},
  options: Parameters<typeof authClient>[2] = {},
) {
  const h = authClient(overrides, [axpShare<AxpResponse>()], options);
  h.net.on(
    "get",
    REQUEST_URL,
    guarded(() => TOKEN_NEW, business),
  );
  return h;
}
/** 同 key 并发发出调用方请求，可附带租户头。 */
function burst(h: ReturnType<typeof client>, count = CALLERS, tenant?: string) {
  return Array.from({ length: count }, () =>
    h.send({
      url: REQUEST_URL,
      share: true,
      latency: LATENCY,
      ...(tenant ? { headers: { [TENANT_HEADER]: tenant } } : {}),
    } as never),
  );
}

it.each([false, true])(
  "[auth.cb.onRefresh × share.req.share] 并发同 key 全部 401：跟随者共享首发的结果，只刷新一次，重放时重新合并，最终拿到同一个成功结果（business=%s）",
  /** share 在 auth 之内：每一轮各合并一次，刷新单飞（I5）。 */ async (business) => {
    const h = client(business);
    const results = await settleAll(...burst(h));
    expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
    expect(new Set(results).size).toBe(1);
    expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
    expect(h.net.totalStarted).toBe(ROUNDS_AFTER_REFRESH);
    expect(h.net.log.map(/** 每次发送携带的凭证。 */ (record) => record.auth)).toEqual([
      TOKEN_OLD,
      TOKEN_NEW,
    ]);
  },
);

it("[auth.reason.expired × share.req.share] 刷新失败：所有跟随者共享同一次 401，一次刷新，落定为 auth 过期，过期通知只一次", /** 失败路径下刷新与通知同样单飞。 */ async () => {
  const h = client(false, { onRefresh: /** 刷新失败。 */ () => false });
  const results = await settleAll(...burst(h));
  expect(results.map(/** 取类别与原因。 */ (r) => [r.kind, r.reason])).toEqual(
    Array(CALLERS).fill([AXP_KINDS.AUTH, "expired"]),
  );
  expect(h.net.totalStarted).toBe(1);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  expect(h.settings.onAccessExpired).toHaveBeenCalledTimes(1);
});

it("[auth.cb.onRefresh × share.req.share][core.opt.key] scope 不同的请求不共享：同 scope 的跟随者各自合并，刷新仍只一次", /** scope 隔离共享，不隔离单飞刷新。 */ async () => {
  const h = client(
    false,
    {},
    {
      key: {
        /** 以租户请求头分区，模拟按账号或租户隔离。 */
        scope: (request) =>
          String(AxiosHeaders.from(request.headers as never).get(TENANT_HEADER) ?? ""),
      },
    },
  );
  const [a, b] = TENANTS;
  const results = await settleAll(
    ...burst(h, CALLERS_PER_TENANT, a),
    ...burst(h, CALLERS_PER_TENANT, b),
  );
  expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
  const [a1, a2, b1, b2] = results;
  expect(a2).toBe(a1);
  expect(b2).toBe(b1);
  expect(b1).not.toBe(a1);
  expect(h.net.totalStarted).toBe(TENANTS.length * ROUNDS_AFTER_REFRESH);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
});

it("[auth.cb.onFailure × share.req.share] 越权 403 由所有跟随者共享：只一次网络请求，各自落定为 auth denied，不刷新", /** 共享的失败照常经过每个调用方自己的鉴权判定。 */ async () => {
  const h = client();
  h.net.on("get", REQUEST_URL, /** 一律越权。 */ () => failure(FORBIDDEN));
  const results = await settleAll(...burst(h));
  expect(results.map(/** 取类别与原因。 */ (r) => [r.kind, r.reason])).toEqual(
    Array(CALLERS).fill([AXP_KINDS.AUTH, "denied"]),
  );
  expect(h.net.totalStarted).toBe(1);
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
  expect(h.settings.onAccessDenied).toHaveBeenCalledTimes(CALLERS);
});
