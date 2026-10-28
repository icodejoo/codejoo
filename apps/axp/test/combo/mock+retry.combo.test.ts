import { beforeEach, expect, it, vi } from "vitest";
import axpMock from "../../src/plugins/mock";
import axpRetry from "../../src/plugins/retry";
import type { AxpResponse } from "../../src/response";
import { failure, POLLUTED_ONCE, pollutingBody, pollutingTransform } from "../helpers/b3";
import { envelope, settleAll, sourceClient } from "../helpers/source";

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 被 mock 且可重试的接口。 */
const REAL = "/real";
/** 探测地址。 */
const PROBE = `${MOCK}${REAL}`;
/** 一次重试预算，足以覆盖"失败一次再成功"。 */
const ONE_RETRY = 1;
/** 服务端故障的 HTTP 状态。 */
const HTTP_ERROR = 500;
/** mock 服务器上没有这条接口。 */
const NOT_FOUND = 404;
/** 首发失败再重试成功，共两轮尝试。 */
const ROUNDS_AFTER_RETRY = 2;
/** 首发失败。 */
const FIRST_SEND = 1;
/** mock 与真实接口的返回值。 */
const MOCK_DATA = "from-mock";
/** 真实接口的返回值。 */
const REAL_DATA = "from-real";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 装好 retry 与全局 mock；探测默认返回 mock 数据，真实接口返回 real 数据。 */
function client() {
  const h = sourceClient([
    axpRetry<AxpResponse>({ max: ONE_RETRY, delay: 0 }),
    axpMock<AxpResponse>({ enable: true, mock: true, mockUrl: MOCK }),
  ]);
  h.net.on("get", PROBE, () => envelope(MOCK_DATA));
  h.net.on("get", REAL, () => envelope(REAL_DATA));
  return h;
}

it("[mock.req.mock × retry.opt.max] 请求级 mock:false 在每次重试里都保留：不探测 mock，只打真实接口（承接旧用例）", /** 重试各轮尝试读到的仍是同一份请求级开关。 */ async () => {
  const h = client();
  h.net.on(
    "get",
    REAL,
    /** 首发 500，其后成功。 */ (_config, hit) =>
      hit === FIRST_SEND ? failure(HTTP_ERROR) : envelope(REAL_DATA),
  );
  const [r] = await settleAll(h.send({ url: REAL, mock: false }));
  expect(r!.data).toBe(REAL_DATA);
  expect(h.net.log.map(/** 实际发出的地址。 */ (record) => record.url)).toEqual([REAL, REAL]);
});

it("[mock.req.mock × retry.opt.max] mock 探测失败（非回落）时 retry 重试：每次尝试都重新探测，真实接口始终不碰", /** mock 在 attempt 之内，每轮都参与。 */ async () => {
  const h = client();
  h.net.on(
    "get",
    PROBE,
    /** 探测首发 500，其后命中。 */ (_config, hit) =>
      hit === FIRST_SEND ? failure(HTTP_ERROR) : envelope(MOCK_DATA),
  );
  const [r] = await settleAll(h.send({ url: REAL, mock: true }));
  expect(r!.data).toBe(MOCK_DATA);
  expect(h.net.calls("get", PROBE)).toBe(ROUNDS_AFTER_RETRY);
  expect(h.net.calls("get", REAL)).toBe(0);
});

it("[mock.req.mock × retry.opt.max] 探测回落后真实接口失败：retry 把「探测 + 回落」当一轮整体重做，预算只用一次", /** 回落不消耗重试次数。 */ async () => {
  const h = client();
  h.net.on("get", PROBE, /** mock 服务器没有这条接口。 */ () => failure(NOT_FOUND));
  h.net.on(
    "get",
    REAL,
    /** 真实接口首发 500，其后成功。 */ (_config, hit) =>
      hit === FIRST_SEND ? failure(HTTP_ERROR) : envelope(REAL_DATA),
  );
  const [r] = await settleAll(h.send({ url: REAL, mock: true }));
  expect(r!.data).toBe(REAL_DATA);
  expect(h.net.log.map(/** 实际发出的地址。 */ (record) => record.url)).toEqual([
    PROBE,
    REAL,
    PROBE,
    REAL,
  ]);
});

it("[mock.req.mock × retry.opt.methods] 请求体一致（I7）：探测、回落、重试共四次发送，请求体相同，调用方数据不被改", /** mock 与 retry 共用同一份请求体基准。 */ async () => {
  const bodies: unknown[] = [];
  const h = sourceClient([
    axpRetry<AxpResponse>({ max: ONE_RETRY, delay: 0, methods: ["post"] }),
    axpMock<AxpResponse>({ enable: true, mock: true, mockUrl: MOCK }),
  ]);
  h.net.on(
    "post",
    PROBE,
    /** 记录请求体，mock 没有这条接口。 */ (config) => {
      bodies.push(config.data);
      return failure(NOT_FOUND);
    },
  );
  h.net.on(
    "post",
    REAL,
    /** 记录请求体，首发 500，其后成功。 */ (config, hit) => {
      bodies.push(config.data);
      return hit === FIRST_SEND ? failure(HTTP_ERROR) : envelope(REAL_DATA);
    },
  );
  const data = pollutingBody();
  const [r] = await settleAll(
    h.send({ url: REAL, method: "post", data, transformRequest: [pollutingTransform] }),
  );
  expect(r!.ok).toBe(true);
  expect(bodies).toEqual([POLLUTED_ONCE, POLLUTED_ONCE, POLLUTED_ONCE, POLLUTED_ONCE]);
  expect(data).toEqual(pollutingBody());
});
