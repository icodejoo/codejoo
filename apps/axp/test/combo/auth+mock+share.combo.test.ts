import { beforeEach, expect, it, vi } from "vitest";
import axpMock from "../../src/plugins/mock";
import axpShare from "../../src/plugins/share";
import type { AxpResponse } from "../../src/response";
import { authClient, failure, guarded, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";
import { envelope, settleAll } from "../helpers/source";

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 受保护、可被 mock 且可被共享的接口。 */
const REAL = "/review-auth";
/** 探测地址。 */
const PROBE = `${MOCK}${REAL}`;
/** 并发调用方数量。 */
const CALLERS = 3;
/** 一次探测或真实请求的网络延迟。 */
const LATENCY = 5;
/** 首发 401 与重放成功各一轮。 */
const ROUNDS_AFTER_REFRESH = 2;
/** mock 与真实接口的返回值。 */
const MOCK_DATA = "from-mock";
/** 受保护路由放行时返回的数据，见 guarded。 */
const REAL_DATA = "ok";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 装好 auth、全局 mock 与 share；探测默认返回 mock 数据，真实接口只认新 token。 */
function client() {
  const h = authClient({}, [axpMock<AxpResponse>({ enable: true, mock: true, mockUrl: MOCK }), axpShare<AxpResponse>()]);
  h.net.on("get", PROBE, () => envelope(MOCK_DATA));
  h.net.on(
    "get",
    REAL,
    guarded(() => TOKEN_NEW),
  );
  return h;
}

it("[auth.cb.onRefresh × mock.req.mock × share.req.share] 刷新重放保留请求级 mock:false 与 share:false：不探测 mock、各调用方各发各的（承接旧用例）", /** auth 重放不改写请求级开关。 */ async () => {
  const h = client();
  const results = await settleAll(...Array.from({ length: 2 }, () => h.send({ url: REAL, mock: false, share: false, latency: LATENCY } as never)));
  expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
  expect(h.net.log.map(/** 实际发出的地址。 */ (record) => record.url)).toEqual([REAL, REAL, REAL, REAL]);
  expect(h.net.calls("get", PROBE)).toBe(0);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
});

it("[auth.cb.onRefresh × mock.req.mock × share.req.share] 全部回落的并发 401：探测每轮各自发送且带当轮 token，真实请求每轮合并成一次，刷新只一次", /** 探测不占共享，回落的真实请求才合并；auth 在最外层，每次重放都重新探测。 */ async () => {
  const h = client();
  h.net.on("get", PROBE, /** mock 服务器没有这条接口。 */ () => failure(404));
  const results = await settleAll(...Array.from({ length: CALLERS }, () => h.send({ url: REAL, mock: true, share: true, latency: LATENCY } as never)));
  expect(results.every(/** 全部成功。 */ (r) => r.ok)).toBe(true);
  expect(results[0]!.data).toBe(REAL_DATA);
  expect(new Set(results).size).toBe(1);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  const probes = h.net.log.filter(/** 探测请求。 */ (record) => record.url === PROBE);
  const reals = h.net.log.filter(/** 真实请求。 */ (record) => record.url === REAL);
  expect(probes.map(/** 探测携带的凭证。 */ (record) => record.auth)).toEqual([...Array(CALLERS).fill(TOKEN_OLD), ...Array(CALLERS).fill(TOKEN_NEW)]);
  expect(reals.map(/** 真实请求携带的凭证。 */ (record) => record.auth)).toEqual([TOKEN_OLD, TOKEN_NEW]);
  expect(reals).toHaveLength(ROUNDS_AFTER_REFRESH);
});

it("[auth.cb.onRefresh × mock.req.mock × share.req.share] mock 探测命中的并发请求：探测各发一次、不合并，没有真实请求也就没有 401 与刷新", /** mock 命中在 source 层短路，auth 看不到失败。 */ async () => {
  const h = client();
  const results = await settleAll(...Array.from({ length: CALLERS }, () => h.send({ url: REAL, mock: true, share: true, latency: LATENCY } as never)));
  expect(results.map(/** 取数据。 */ (r) => r.data)).toEqual(Array(CALLERS).fill(MOCK_DATA));
  expect(h.net.calls("get", PROBE)).toBe(CALLERS);
  expect(h.net.calls("get", REAL)).toBe(0);
  expect(h.settings.onRefresh).not.toHaveBeenCalled();
});
