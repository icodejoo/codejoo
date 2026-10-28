import { beforeEach, expect, it, vi } from "vitest";
import axpMock from "../../src/plugins/mock";
import axpShare from "../../src/plugins/share";
import { envelope, sourceClient } from "../helpers/source";

/** 并发用例统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 被 mock 且被共享的接口。 */
const REAL = "/real";
/** 探测地址。 */
const PROBE = `${MOCK}${REAL}`;
/** 并发调用方数量。 */
const CALLERS = 6;

/** 装好 mock 与 share；mock 默认成功。 */
function client() {
  const h = sourceClient([axpMock({ enable: true, mockUrl: MOCK }), axpShare()]);
  h.net.on("get", PROBE, () => envelope("mock"));
  h.net.on("get", REAL, () => envelope("real"));
  return h;
}
/** 并发发出同 key 的请求并等它们落定。 */
async function burst(h: ReturnType<typeof client>) {
  const pending = Array.from({ length: CALLERS }, () => h.send({ url: REAL, mock: true, share: true, latency: 5 } as never));
  await vi.runAllTimersAsync();
  return Promise.all(pending);
}

it("[mock.req.mock × share.req.share] 同 key 并发的 mock 成功请求：探测各发一次，不占共享条目、不合并", async () => {
  const h = client();
  const results = await burst(h);
  expect(h.net.calls("get", PROBE)).toBe(CALLERS);
  expect(h.net.calls("get", REAL)).toBe(0);
  expect(results.every((r) => r.data === "mock")).toBe(true);
});

it("[mock.req.mock × share.req.share] 同 key 并发且全部回落：探测各发一次，真实请求经 share 合并成一次", async () => {
  const h = client();
  h.net.on("get", PROBE, () => ({ status: 404 }));
  const results = await burst(h);
  expect(h.net.calls("get", PROBE)).toBe(CALLERS);
  expect(h.net.calls("get", REAL)).toBe(1);
  expect(new Set(results).size).toBe(1);
  expect(results[0].data).toBe("real");
});
