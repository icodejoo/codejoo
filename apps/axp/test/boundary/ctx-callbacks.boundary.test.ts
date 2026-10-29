import { beforeEach, expect, it, vi } from "vitest";
import type { AxpContext } from "../../src/context";
import axpCache from "../../src/plugins/cache";
import axpMock from "../../src/plugins/mock";
import axpRetry from "../../src/plugins/retry";
import type { AxpPlugin } from "../../src/types";
import { authClient, failure, guarded, run, TOKEN_NEW, REFRESH_TOKEN } from "../helpers/b3";
import { envelope, settleAll, sourceClient } from "../helpers/source";

/** 全部等待经假时钟推进。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 被测接口地址。 */
const URL = "/ctx";
/** 另一个接口地址，用来确认 ctx 属于当前请求。 */
const OTHER_URL = "/ctx-other";
/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 服务端重试头名。 */
const RETRY_AFTER = "retry-after";

/** 在 attempt 阶段直接落定指定失败的内层插件，并统计触达次数。 */
function failing(kind: "internal" | "cancel") {
  const hits = { count: 0 };
  const plugin: AxpPlugin = {
    name: `fail-${kind}`,
    stage: "attempt",
    /** 不走网络，直接返回内核失败。 */ handle(ctx) {
      hits.count++;
      return Promise.resolve(ctx.fail({ failure: kind, error: kind === "internal" ? new Error("bug") : undefined }));
    },
  };
  return { plugin, hits };
}

it.each(["internal", "cancel"] as const)("[cache.cb.shouldCache] shouldCache 恒真也不写入 %s 失败：第二次请求不命中缓存", async (kind) => {
  const { plugin, hits } = failing(kind);
  const shouldCache = vi.fn(() => true);
  const h = sourceClient([axpCache({ shouldCache }), plugin]);
  await run(h, { url: URL, cache: true, throws: false }).catch(/** internal 总会抛出，只关心是否命中。 */ () => undefined);
  await run(h, { url: URL, cache: true, throws: false }).catch(() => undefined);
  expect(hits.count).toBe(2);
  expect(shouldCache).not.toHaveBeenCalled();
});

it.each([
  ["business", { status: 200, data: { code: 500, data: null } }],
  ["http", { status: 503 }],
])("[cache.cb.shouldCache] 其他失败（%s）在 shouldCache 恒真时照常缓存", async (_label, route) => {
  const h = sourceClient([axpCache({ shouldCache: () => true })]);
  h.net.on("get", URL, () => route);
  await run(h, { url: URL, cache: true, throws: false });
  await run(h, { url: URL, cache: true, throws: false });
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[cache.cb.shouldCache] 网络失败在 shouldCache 恒真时照常缓存", async () => {
  const h = sourceClient([axpCache({ shouldCache: () => true })]);
  h.net.on("get", URL, () => {
    throw Object.assign(new Error("offline"), { code: "ERR_NETWORK", isAxiosError: true });
  });
  await run(h, { url: URL, cache: true, throws: false });
  await run(h, { url: URL, cache: true, throws: false });
  expect(h.net.calls("get", URL)).toBe(1);
});

it.each([
  ["插件级", true],
  ["请求级", false],
])("[cache.cb.shouldCache] %s 回调末位收到当前请求的 ctx", async (_label, global) => {
  const seen: unknown[] = [];
  const spy = /** 记录收到的 ctx 请求地址。 */ (_r: unknown, ctx: AxpContext<any>) => {
    seen.push(ctx.request.url);
    return true;
  };
  const h = sourceClient([axpCache(global ? { shouldCache: spy } : {})]);
  h.net.on("get", URL, () => envelope(1));
  h.net.on("get", OTHER_URL, () => envelope(2));
  await run(h, { url: URL, cache: global ? true : { shouldCache: spy } });
  await run(h, { url: OTHER_URL, cache: global ? true : { shouldCache: spy } });
  expect(seen).toEqual([URL, OTHER_URL]);
});

it("[retry.opt.respectRetryAfter] 函数形态末位收到当前请求的 ctx；少参数旧写法照常工作", async () => {
  const seen: unknown[] = [];
  const h = authClient({}, []);
  h.api.use(
    axpRetry({
      max: 1,
      respectRetryAfter: /** 读取上下文里的请求地址。 */ (_r, ctx) => {
        seen.push(ctx.request.url);
        return false;
      },
      delay: 0,
    }),
  );
  h.net.on("get", URL, () => ({ status: 503, headers: { [RETRY_AFTER]: "1" } }));
  await run(h, { url: URL, protected: false });
  expect(seen).toEqual([URL]);
  const legacy = sourceClient([axpRetry({ max: 1, delay: 0, respectRetryAfter: /** 旧写法只收响应。 */ (r) => r.status === 503 })]);
  legacy.net.on("get", URL, (_c, hit) => ({ status: hit === 1 ? 503 : 200, headers: { [RETRY_AFTER]: "0" } }));
  expect((await run(legacy, { url: URL })).ok).toBe(true);
});

it("[retry.opt.delay] 延迟函数第四个参数是当前请求的 ctx；少参数旧写法照常工作", async () => {
  const seen: unknown[] = [];
  const h = sourceClient([
    axpRetry({
      max: 1,
      delay: /** 读取上下文里的请求地址。 */ (_attempt, _max, _r, ctx) => {
        seen.push(ctx.request.url);
        return 0;
      },
    }),
  ]);
  h.net.on("get", URL, (_c, hit) => (hit === 1 ? { status: 503 } : envelope(1)));
  expect((await run(h, { url: URL })).ok).toBe(true);
  expect(seen).toEqual([URL]);
  const legacy = sourceClient([axpRetry({ max: 1, delay: /** 旧写法只收 attempt。 */ (attempt) => attempt - attempt })]);
  legacy.net.on("get", URL, (_c, hit) => (hit === 1 ? { status: 503 } : envelope(1)));
  expect((await run(legacy, { url: URL })).ok).toBe(true);
});

it("[mock.opt.fallbackWhen] 回落判定末位收到当前请求的 ctx；少参数旧写法照常工作", async () => {
  const seen: unknown[] = [];
  const h = sourceClient([
    axpMock({
      enable: true,
      mock: true,
      mockUrl: MOCK,
      fallbackWhen: /** 记录请求地址并要求回落。 */ (_r, ctx) => {
        seen.push(ctx.request.url);
        return true;
      },
    }),
  ]);
  h.net.on("get", `${MOCK}${URL}`, () => envelope("mock"));
  h.net.on("get", URL, () => envelope("real"));
  expect((await run(h, { url: URL })).data).toBe("real");
  expect(seen).toEqual([URL]);
  const legacy = sourceClient([axpMock({ enable: true, mock: true, mockUrl: MOCK, fallbackWhen: /** 旧写法只收响应。 */ (r) => r.status === 404 })]);
  legacy.net.on("get", `${MOCK}${URL}`, () => envelope("mock"));
  expect((await run(legacy, { url: URL })).data).toBe("mock");
});

it("[auth.cb.onRefresh][auth.cb.onAccessExpired][auth.cb.onAccessDenied] 三个回调末位都收到当前请求的 ctx", async () => {
  const refreshed: unknown[] = [];
  const expired: unknown[] = [];
  const denied: unknown[] = [];
  const h = authClient({
    onRefresh: /** 刷新失败，进入过期。 */ (_r, _tm, ctx) => {
      refreshed.push(ctx.request.url);
      return false;
    },
    onAccessExpired: /** 记录过期通知的 ctx。 */ (_r, _tm, ctx) => {
      expired.push(ctx.request.url);
    },
    onAccessDenied: /** 记录拒绝通知的 ctx。 */ (_r, _tm, ctx) => {
      denied.push(ctx.request.url);
    },
  });
  h.net.on(
    "get",
    URL,
    guarded(() => "never"),
  );
  await run(h, { url: URL, throws: false });
  expect(refreshed).toEqual([URL]);
  expect(expired).toEqual([URL]);
  h.tm.set("again", "refresh");
  h.net.on("get", OTHER_URL, () => failure(403));
  await run(h, { url: OTHER_URL, throws: false });
  expect(denied).toEqual([OTHER_URL]);
});

it("[auth.cb.onRefresh] 并发 401 单飞刷新：onRefresh 只收到首个触发请求的 ctx，onAccessDenied 各收到各自的 ctx", async () => {
  const refreshed: string[] = [];
  const denied: string[] = [];
  const h = authClient({
    onRefresh: /** 延后一拍完成刷新，让第二个请求加入同一轮。 */ async (_r, tm, ctx) => {
      refreshed.push(ctx.request.url ?? "");
      await new Promise((resolve) => setTimeout(resolve, 10));
      tm.set(TOKEN_NEW, REFRESH_TOKEN);
    },
    onAccessDenied: /** 记录拒绝通知的 ctx。 */ (_r, _tm, ctx) => {
      denied.push(ctx.request.url ?? "");
    },
  });
  h.net.on(
    "get",
    URL,
    guarded(() => TOKEN_NEW),
  );
  h.net.on(
    "get",
    OTHER_URL,
    guarded(() => TOKEN_NEW),
  );
  const [a, b] = await settleAll(h.send({ url: URL }), h.send({ url: OTHER_URL }));
  expect(a.ok && b.ok).toBe(true);
  expect(refreshed).toEqual([URL]);
  h.net.on("get", URL, () => failure(403));
  h.net.on("get", OTHER_URL, () => failure(403));
  await settleAll(h.send({ url: URL, throws: false }), h.send({ url: OTHER_URL, throws: false }));
  expect(denied.toSorted()).toEqual([URL, OTHER_URL]);
});

it("[retry.opt.delay][retry.opt.respectRetryAfter] 并发请求各自重试：回调收到各自的 ctx", async () => {
  const delays = new Map<number, string>();
  const afters = new Map<number, string>();
  const h = sourceClient([
    axpRetry({
      max: 1,
      respectRetryAfter: /** 记录各请求的 ctx。 */ (_r, ctx) => {
        afters.set(ctx.id, ctx.request.url ?? "");
        return false;
      },
      delay: /** 记录各请求的 ctx。 */ (_attempt, _max, _r, ctx) => {
        delays.set(ctx.id, ctx.request.url ?? "");
        return 0;
      },
    }),
  ]);
  for (const url of [URL, OTHER_URL]) h.net.on("get", url, (_c, hit) => (hit === 1 ? { status: 503, headers: { [RETRY_AFTER]: "1" } } : envelope(url)));
  const [a, b] = await settleAll(h.send({ url: URL }), h.send({ url: OTHER_URL }));
  expect(a.data).toBe(URL);
  expect(b.data).toBe(OTHER_URL);
  expect(delays.size).toBe(2);
  expect([...delays.values()].toSorted()).toEqual([URL, OTHER_URL]);
  expect(afters).toEqual(delays);
});
