import { beforeEach, expect, it, vi } from "vitest";
import axpShare, { type ISharedOptions, type SharePolicy } from "../../src/plugins/share";
import { envelope, requestRecorder, sourceClient } from "../helpers/source";

/** 共享测试统一使用假时钟，保证乱序到达可重复。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 插件名称。 */
const NAME = "axp:share";
/** 被共享的接口。 */
const URL = "/shared";
/** 慢请求的网络延迟。 */
const SLOW = 30;
/** 快请求的网络延迟。 */
const FAST = 5;
/** 中等速度的网络延迟。 */
const MIDDLE = 10;

/** 建立路由按命中序号返回 `hit-N` 的共享客户端。 */
function sharedClient(options: ISharedOptions = {}) {
  const h = sourceClient([axpShare(options)]);
  h.net.on("get", URL, (_config, hit) => envelope(`hit-${hit}`));
  return h;
}
/** 推进假时钟直到所有请求落定。 */
async function settled<T>(...pending: Promise<T>[]): Promise<T[]> {
  await vi.runAllTimersAsync();
  return Promise.all(pending);
}

it("[share.prop.name][share.opt.enable] 名称为 axp:share，enable:false 不进链也不共享", async () => {
  const plugin = axpShare({ enable: false });
  expect(plugin.name).toBe(NAME);
  const h = sourceClient([plugin]);
  h.net.on("get", URL, () => envelope(1));
  expect(h.api.inspect()).toEqual([]);
  await settled(h.send({ url: URL, share: true }), h.send({ url: URL, share: true }));
  expect(h.net.calls("get", URL)).toBe(2);
  expect(sourceClient([axpShare()]).api.inspect()).toEqual([{ stage: "source", name: NAME }]);
});

it("[share.opt.policy][share.req.share] start 并发 50 个同 key 请求只发一次，所有人拿到同一个 R，结束后重新发送", async () => {
  const h = sharedClient();
  const results = await settled(...Array.from({ length: 50 }, () => h.send({ url: URL, share: true, latency: FAST } as never)));
  expect(h.net.calls("get", URL)).toBe(1);
  expect(new Set(results).size).toBe(1);
  expect(results[0].data).toBe("hit-1");
  const [next] = await settled(h.send({ url: URL, share: true }));
  expect(next.data).toBe("hit-2");
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[share.opt.policy] start 不同 key 互不干扰，各自发请求", async () => {
  const h = sharedClient();
  h.net.on("get", "/other", () => envelope("other"));
  const [a, b] = await settled(h.send({ url: URL, share: true }), h.send({ url: "/other", share: true }));
  expect([a.data, b.data]).toEqual(["hit-1", "other"]);
  expect(h.net.totalStarted).toBe(2);
});

it("[share.req.share] 请求没写 share、false、null、enable:false、0 与函数（已删除的动态写法）都不共享", async () => {
  const h = sharedClient();
  for (const share of [undefined, false, null, { enable: false }, 0, () => "start"]) {
    const before = h.net.calls("get", URL);
    // oxlint-disable-next-line no-await-in-loop -- 每种写法用同一客户端依次核对发送次数。
    await settled(h.send({ url: URL, share: share as never }), h.send({ url: URL, share: share as never }));
    expect(h.net.calls("get", URL) - before).toBe(2);
  }
});

it.each<[string, unknown, SharePolicy | undefined, number]>([
  ["true 沿用插件级 start", true, undefined, 1],
  ["true 沿用插件级 end", true, "end", 2],
  ["策略字符串 end 覆盖插件级 start", "end", undefined, 2],
  ["策略字符串 race 覆盖插件级 start", "race", undefined, 2],
  ["对象 { policy } 覆盖插件级", { policy: "race" }, undefined, 2],
  ["非法策略字符串回退插件级 start", "none", undefined, 1],
  ["对象里非法策略回退插件级 start", { policy: "none" }, undefined, 1],
  ["空对象沿用插件级 start", {}, undefined, 1],
])("[share.req.share][share.opt.policy] %s", async (_label, share, policy, calls) => {
  const h = sharedClient({ policy });
  await settled(h.send({ url: URL, share: share as never }), h.send({ url: URL, share: share as never }));
  expect(h.net.calls("get", URL)).toBe(calls);
});

it("[share.opt.policy] 插件级非法策略回退 start", async () => {
  const h = sharedClient({ policy: "none" as never });
  await settled(h.send({ url: URL, share: true }), h.send({ url: URL, share: true }));
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[share.opt.policy] end 每次都发，只有最新一次的结果分发给所有订阅者，前面的结果丢弃", async () => {
  const h = sharedClient({ policy: "end" });
  const [first, second, third] = await settled(
    h.send({ url: URL, share: true, latency: FAST } as never),
    h.send({ url: URL, share: true, latency: SLOW } as never),
    h.send({ url: URL, share: true, latency: MIDDLE } as never),
  );
  expect(h.net.calls("get", URL)).toBe(3);
  // 第三个发出的最新，即使它先于第二个返回，也只有它的结果有效。
  expect([first.data, second.data, third.data]).toEqual(["hit-3", "hit-3", "hit-3"]);
  expect(first).toBe(third);
  const [again] = await settled(h.send({ url: URL, share: "end" }));
  expect(again.data).toBe("hit-4");
});

it("[share.opt.policy] end 各自独立的 key 如实返回，失败也不例外", async () => {
  const h = sharedClient({ policy: "end" });
  h.net.on("get", "/bad", () => ({ status: 500 }));
  const [ok, bad] = await settled(h.send({ url: URL, share: true }), h.send({ url: "/bad", share: true }));
  expect(ok.data).toBe("hit-1");
  expect(bad.httpStatus).toBe(500);
});

it("[share.opt.policy] race 第一个成功的胜出，较慢的成功不覆盖它", async () => {
  const h = sharedClient({ policy: "race" });
  const [slow, fast] = await settled(h.send({ url: URL, share: true, latency: SLOW } as never), h.send({ url: URL, share: true, latency: FAST } as never));
  expect(h.net.calls("get", URL)).toBe(2);
  expect(slow).toBe(fast);
  expect(fast.data).toBe("hit-2");
});

it("[share.opt.policy] race 先失败后成功：成功者胜出；成功之后到达的失败被忽略", async () => {
  const h = sharedClient({ policy: "race" });
  h.net.on("get", URL, (_config, hit) => (hit === 2 ? envelope("won") : { status: 500 }));
  const [a, b, c] = await settled(h.send({ url: URL, share: true, latency: FAST } as never), h.send({ url: URL, share: true, latency: MIDDLE } as never), h.send({ url: URL, share: true, latency: SLOW } as never));
  expect([a.data, b.data, c.data]).toEqual(["won", "won", "won"]);
  expect(a.ok).toBe(true);
});

it("[share.opt.policy] race 业务失败（HTTP 200 + 非成功码）不算赢家，后到的成功者胜出", async () => {
  const h = sharedClient({ policy: "race" });
  h.net.on("get", URL, (_config, hit) => (hit === 1 ? { status: 200, data: { code: 500, data: null, message: "biz" } } : envelope("ok")));
  const [a, b] = await settled(h.send({ url: URL, share: true, latency: FAST } as never), h.send({ url: URL, share: true, latency: SLOW } as never));
  expect(a.data).toBe("ok");
  expect(b).toBe(a);
});

it("[share.opt.policy] race 全部失败：所有订阅者拿到最后到达的那个失败", async () => {
  const h = sharedClient({ policy: "race" });
  h.net.on("get", URL, (_config, hit) => ({ status: hit === 1 ? 500 : 503 }));
  const [a, b] = await settled(h.send({ url: URL, share: true, latency: SLOW } as never), h.send({ url: URL, share: true, latency: FAST } as never));
  // 第一个请求最慢，是最后一个到达的失败。
  expect(a.httpStatus).toBe(500);
  expect(b).toBe(a);
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[share.opt.policy] race 单个请求失败直接如实返回，之后重新比赛", async () => {
  const h = sharedClient({ policy: "race" });
  h.net.on("get", URL, (_config, hit) => (hit === 1 ? { status: 500 } : envelope("later")));
  const [bad] = await settled(h.send({ url: URL, share: true }));
  expect(bad.httpStatus).toBe(500);
  const [good] = await settled(h.send({ url: URL, share: true }));
  expect(good.data).toBe("later");
});

it("[share.opt.methods] 默认只共享 get 与 head，其它方法即使请求级开启也各自发送", async () => {
  const h = sharedClient();
  h.net.on("post", URL, () => envelope("posted"));
  h.net.on("head", URL, () => envelope("head"));
  await settled(
    h.send({ url: URL, method: "post", data: { a: 1 }, share: true }),
    h.send({ url: URL, method: "post", data: { a: 1 }, share: true }),
    h.send({ url: URL, method: "head", share: true }),
    h.send({ url: URL, method: "head", share: true }),
  );
  expect(h.net.calls("post", URL)).toBe(2);
  expect(h.net.calls("head", URL)).toBe(1);
});

it("[share.opt.methods] methods 可改为包含 POST，大小写不敏感；get 不在表中就不共享", async () => {
  const h = sharedClient({ methods: ["POST"] });
  h.net.on("post", URL, () => envelope("posted"));
  await settled(h.send({ url: URL, method: "post", data: { a: 1 }, share: true }), h.send({ url: URL, method: "post", data: { a: 1 }, share: true }), h.send({ url: URL, share: true }), h.send({ url: URL, share: true }));
  expect(h.net.calls("post", URL)).toBe(1);
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[share.fn.axpShare] key 为 null（key:false、不可哈希）直接放行；显式 key 让不同地址共享同一次请求", async () => {
  const h = sharedClient();
  await settled(h.send({ url: URL, share: true, key: false }), h.send({ url: URL, share: true, key: false }));
  expect(h.net.calls("get", URL)).toBe(2);
  const unhashable = { url: URL, share: true, params: { id: new Map() } } as never;
  await settled(h.send(unhashable), h.send(unhashable));
  expect(h.net.calls("get", URL)).toBe(4);
  h.net.on("get", "/a", () => envelope("a"));
  h.net.on("get", "/b", () => envelope("b"));
  const [a, b] = await settled(h.send({ url: "/a", share: true, key: "same" }), h.send({ url: "/b", share: true, key: "same" }));
  expect(h.net.calls("get", "/a") + h.net.calls("get", "/b")).toBe(1);
  expect(b).toBe(a);
});

it("[share.fn.axpShare] 订阅者拿到的是首发那次的 R：只发一次；各调用方自己的请求仍在各自的上下文里", async () => {
  const outside = requestRecorder("pre");
  const inside = requestRecorder("post");
  const h = sourceClient([axpShare(), outside.plugin, inside.plugin]);
  h.net.on("get", URL, () => envelope("x"));
  const [first, follower] = await settled(h.send({ url: URL, share: true, headers: { "x-who": "first" } }), h.send({ url: URL, share: true, headers: { "x-who": "follower" } }));
  expect(follower).toBe(first);
  expect(first.request.url).toBe(URL);
  // pre 段在 share 之前：每个调用方各自的请求都在自己的上下文里。
  expect(outside.seen.map((request) => (request.headers as Record<string, string>)["x-who"])).toEqual(["first", "follower"]);
  // post 段在 share 之后：只有首发那次真正往下走。
  expect(inside.seen).toHaveLength(1);
  expect(h.net.calls("get", URL)).toBe(1);
});

it("[share.req.share] 不修改调用方的请求对象，选项原样保留在请求上", async () => {
  const h = sharedClient();
  const config = { url: URL, share: { policy: "end" }, wrap: true } as const;
  const snapshot = JSON.stringify(config);
  const pending = h.api.request(config);
  await vi.runAllTimersAsync();
  const r = await pending;
  expect(JSON.stringify(config)).toBe(snapshot);
  expect(r.request.share).toEqual(config.share);
});

it("[share.method.lifecycle] eject 后不再共享，在途订阅者仍拿到结果", async () => {
  const h = sharedClient();
  const inflight = h.send({ url: URL, share: true, latency: SLOW } as never);
  const follower = h.send({ url: URL, share: true, latency: SLOW } as never);
  expect(h.api.eject(NAME)).toBe(true);
  await settled(h.send({ url: URL, share: true }), h.send({ url: URL, share: true }));
  const [a, b] = await settled(inflight, follower);
  expect(a).toBe(b);
  expect(h.net.calls("get", URL)).toBe(3);
});
