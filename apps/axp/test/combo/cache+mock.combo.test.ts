import { expect, it } from "vitest";
import axpCache, { clearCache } from "../../src/plugins/cache";
import axpMock from "../../src/plugins/mock";
import type { AxpResponse } from "../../src/response";
import { envelope, sourceClient } from "../helpers/source";

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 被 mock 且被缓存的接口。 */
const REAL = "/real";
/** 探测地址。 */
const PROBE = `${MOCK}${REAL}`;

/** 装好 mock 与 cache；mock 默认成功，真实接口返回 real。 */
function client() {
  const h = sourceClient([
    axpMock<AxpResponse>({ enable: true, mockUrl: MOCK }),
    axpCache<AxpResponse>(),
  ]);
  h.net.on("get", PROBE, () => envelope("mock"));
  h.net.on("get", REAL, () => envelope("real"));
  return h;
}

it("[mock.req.mock × cache.req.cache] 同 key 两次 mock 成功：探测各发一次，探测响应不写入缓存", async () => {
  const h = client();
  const first = await h.send({ url: REAL, mock: true, cache: true });
  const second = await h.send({ url: REAL, mock: true, cache: true });
  expect([first.data, second.data]).toEqual(["mock", "mock"]);
  expect(h.net.calls("get", PROBE)).toBe(2);
  expect(h.net.calls("get", REAL)).toBe(0);
  expect(clearCache(h.api)).toBe(0);
});

it("[mock.req.mock × cache.req.cache] mock 404 回落：真实响应被缓存，再次请求探测照发、真实结果命中缓存", async () => {
  const h = client();
  h.net.on("get", PROBE, () => ({ status: 404 }));
  const first = await h.send({ url: REAL, mock: true, cache: true });
  expect(first.data).toBe("real");
  expect(clearCache(h.api)).toBe(1);
  const again = await h.send({ url: REAL, mock: true, cache: true });
  const second = await h.send({ url: REAL, mock: true, cache: true });
  expect(again.data).toBe("real");
  expect(second).toBe(again);
  expect(h.net.calls("get", PROBE)).toBe(3);
  expect(h.net.calls("get", REAL)).toBe(2);
});

it("[mock.req.mock × cache.req.cache] 缓存先命中的真实结果不受 mock 影响：mock:false 的请求读写同一条缓存", async () => {
  const h = client();
  const real = await h.send({ url: REAL, cache: true });
  const viaMock = await h.send({ url: REAL, mock: true, cache: true });
  expect(real.data).toBe("real");
  expect(viaMock.data).toBe("mock");
  expect((await h.send({ url: REAL, cache: true })).data).toBe("real");
  expect(h.net.calls("get", REAL)).toBe(1);
});
