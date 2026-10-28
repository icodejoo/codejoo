import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AcceptConfig } from "../lib/config.ts";
import type { AdapterName, NetworkName, Style } from "../lib/constants.ts";
import { NetemClient } from "../lib/netem-client.ts";
import { buildPlan } from "../lib/plan.ts";
import { runEntry, settleDelayMs } from "../lib/runner.ts";
import type { Expectation, Scenario, Step } from "../lib/types.ts";
import { startStub } from "./helpers/stub-server.ts";
import type { StubServer } from "./helpers/stub-server.ts";

/** 被测产物是否已打包；没有就跳过依赖它的测试（accept 脚本会先 vp pack） */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const hasDist = fs.existsSync(path.resolve(HERE, "..", "..", "dist", "esm", "index.mjs"));
const describeDist = hasDist ? describe : describe.skip;

describe("runner 里的纯逻辑", () => {
  it("settleDelayMs：只有 loading 配了 delay_close_ms 才额外等待", () => {
    const base = { id: "x.y", title: "t", requires: [], networks: ["normal"], steps: [], expect: {} } as unknown as Scenario;
    expect(settleDelayMs(base)).toBe(0);
    expect(settleDelayMs({ ...base, client: { plugins: { loading: {} } } })).toBe(0);
    expect(settleDelayMs({ ...base, client: { plugins: { loading: { delay_close_ms: 400 } } } })).toBe(460);
  });
});

/** 造场景：默认 normal 网络、两种风格 */
function mk(id: string, over: Partial<Scenario> & { steps: Step[]; expect: Record<string, Expectation> }): Scenario {
  return { id, title: id, why: "test", requires: [], networks: ["normal"], ...over };
}
const GENERIC = { client: { pending_after: { eq: 0 } } };

describeDist("流水线：对假服务器 + 假 netem 跑完整的 runEntry（http / fetch × http / business）", () => {
  let stub: StubServer;
  let config: AcceptConfig;
  let seq = 0;
  beforeAll(async () => {
    stub = await startStub();
    config = { server: stub.url, netem: stub.netemUrl, scenarios: "", filters: { ids: [], networks: [], styles: [], adapters: [] }, dry: false, jobs: 1, reportDir: "", verbose: false };
  });
  afterAll(async () => {
    await stub.close();
  });

  /** 对一个场景展开 adapter × style（及指定网络）并逐项执行，返回结果 */
  async function runAll(sc: Scenario, filters: { styles?: Style[]; adapters?: AdapterName[]; networks?: NetworkName[] } = {}) {
    const plan = buildPlan([sc], { ids: [], networks: filters.networks ?? [], styles: filters.styles ?? [], adapters: filters.adapters ?? [] });
    const deps = { config, netem: new NetemClient(stub.netemUrl), session: "ut" };
    const out = [];
    for (const e of plan) if (e.decision.kind === "run") out.push(await runEntry(e, ++seq, deps));
    return out;
  }
  const expectAllPass = (rs: Awaited<ReturnType<typeof runAll>>, count = 4): void => {
    expect(rs).toHaveLength(count);
    for (const r of rs) expect(r.reasons, `${r.network}/${r.style}/${r.adapter}`).toEqual([]);
    expect(rs.every((r) => r.status === "passed")).toBe(true);
  };

  it("basic：GET / POST 带 query 与 body 原样到达，hit 递增", async () => {
    const sc = mk("basic.get-post", {
      requires: ["log"],
      steps: [{ request: { id: "g", path: "/t/echo", query: { a: 1 } } }, { request: { id: "p", path: "/t/echo", method: "POST", body: { x: "é" }, query: { b: 2 } } }],
      expect: { "*": { results: { g: { ok: true, data: { request: { method: undefined, query: { a: "1" } } } }, p: { ok: true, data: { request: { body: { x: "é" }, query: { b: "2" } } } } }, ...GENERIC } },
    });
    // data.request.method 在假服务器里没有，去掉这个键避免误报
    delete (sc.expect["*"] as Expectation & { results: Record<string, { data: { request: Record<string, unknown> } }> }).results.g!.data.request.method;
    expectAllPass(await runAll(sc));
  });

  it("normalize：status:500 在两种风格下都归为 status:500，并通用断言通过", async () => {
    const sc = mk("basic.status-500", {
      requires: ["normalize"],
      client: { plugins: { normalize: {} } },
      steps: [{ request: { id: "r", path: "/t/echo", query: { status: 500 } } }],
      expect: { "*": { results: { r: { ok: false, error: "status:500" } }, ...GENERIC } },
    });
    expectAllPass(await runAll(sc));
  });

  it("请求级 normalize:false 只放行业务码失败：business 风格 code:5001 成功；http 风格的 HTTP 500 仍是 status:500 失败", async () => {
    const biz = mk("normalize.off-biz", {
      requires: ["normalize"],
      client: { plugins: { normalize: {} } },
      steps: [{ request: { id: "r", path: "/t/echo", query: { code: 5001 }, options: { normalize: false } } }],
      expect: { "*": { results: { r: { ok: true } }, ...GENERIC } },
    });
    expectAllPass(await runAll(biz, { styles: ["business"] }), 2);
    const http = mk("normalize.off-http", {
      requires: ["normalize"],
      client: { plugins: { normalize: {} } },
      steps: [{ request: { id: "r", path: "/t/echo", query: { status: 500 }, options: { normalize: false } } }],
      expect: { "*": { results: { r: { ok: false, error: "status:500" } }, ...GENERIC } },
    });
    // business 风格下 status:500 是 HTTP 200 + 业务码 500，属于业务码失败，normalize:false 本就放行，所以只看 http 风格
    expectAllPass(await runAll(http, { styles: ["http"] }), 2);
  });

  it("auth：过期令牌 → 刷新 1 次 → 重放成功（两种风格）", async () => {
    const sc = mk("auth.refresh-replay", {
      requires: ["auth"],
      client: { plugins: { auth: { url_pattern: "/t/private", refresh: "endpoint" } } },
      steps: [{ login: { user: "u1" } }, { expire_local: {} }, { request: { id: "r", path: "/t/private/me" } }],
      expect: {
        "*": { results: { r: { ok: true, data: { meta: { auth: "u1" } } } }, server: { by_path: { "/t/auth/refresh": { eq: 1 } } }, client: { refresh: { eq: 1 }, expired: { eq: 0 }, pending_after: { eq: 0 } } },
      },
    });
    expectAllPass(await runAll(sc));
  });

  it("auth：无令牌 → unauthenticated，不刷新；越权 403 → denied 且不刷新", async () => {
    const plugins = { auth: { url_pattern: "/t/private", refresh: "endpoint" } };
    const none = mk("auth.none", {
      requires: ["auth"],
      client: { plugins },
      steps: [{ login: { user: "u1" } }, { set_token: { access: "none", refresh: "keep" } }, { request: { id: "r", path: "/t/private/me" } }],
      expect: { "*": { results: { r: { ok: false, error: "unauthenticated" } }, client: { refresh: { eq: 0 }, expired: { eq: 0 }, pending_after: { eq: 0 } } } },
    });
    expectAllPass(await runAll(none));
    const deny = mk("auth.deny", {
      requires: ["auth"],
      client: { plugins },
      steps: [{ login: { user: "u1" } }, { request: { id: "r", path: "/t/private/me", query: { deny: 1 } } }],
      expect: { "*": { results: { r: { ok: false, error: "denied" } }, server: { by_path: { "/t/auth/refresh": { eq: 0 } } }, client: { denied: { eq: 1 }, refresh: { eq: 0 }, pending_after: { eq: 0 } } } },
    });
    expectAllPass(await runAll(deny));
  });

  it("auth：坏 refresh 刷新失败 → expired，且 refresh 只发起一次", async () => {
    const sc = mk("auth.bad-refresh", {
      requires: ["auth"],
      client: { plugins: { auth: { url_pattern: "/t/private", refresh: "endpoint" } } },
      steps: [{ login: { user: "u1" } }, { set_token: { access: "garbage", refresh: "garbage" } }, { request: { id: "r", path: "/t/private/me" } }],
      expect: { "*": { results: { r: { ok: false, error: "expired" } }, client: { refresh: { eq: 1 }, expired: { eq: 1 }, pending_after: { eq: 0 } } } },
    });
    expectAllPass(await runAll(sc));
  });

  it("cache + key：第二次命中缓存不到服务器（from_cache 由服务端观测推断）", async () => {
    const sc = mk("cache.hit", {
      requires: ["cache", "key"],
      client: { plugins: { key: {}, cache: { ttl_ms: 5000 } } },
      steps: [
        {
          sequence: [
            { request: { id: "r1", path: "/t/echo", options: { key: true, cache: true } } },
            { request: { id: "r2", path: "/t/echo", options: { key: true, cache: true } } },
            { clear_cache: {} },
            { request: { id: "r3", path: "/t/echo", options: { key: true, cache: true } } },
          ],
        },
      ],
      expect: {
        "*": {
          results: { r1: { ok: true, hit: 1, from_cache: false }, r2: { ok: true, hit: 1, from_cache: true }, r3: { ok: true, hit: 2, from_cache: false } },
          server: { by_path: { "/t/echo": { eq: 2 } } },
          ...GENERIC,
        },
      },
    });
    expectAllPass(await runAll(sc));
  });

  it("retry：前两次 500 后恢复，服务端共 3 次；business 风格（HTTP 200 + code 500）同样重试", async () => {
    const sc = mk("retry.500-then-ok", {
      requires: ["retry", "normalize"],
      client: { plugins: { retry: { max: 3, delay_ms: 10 }, normalize: {} } },
      steps: [{ request: { id: "r", path: "/t/echo", query: { fail_times: 2, key: "k" } } }],
      expect: { "*": { results: { r: { ok: true } }, server: { by_path: { "/t/echo": { eq: 3 } } }, ...GENERIC } },
    });
    expectAllPass(await runAll(sc));
  });

  it("auth：并发两个受保护请求 + 坏 refresh → 两个都是 expired，refresh 与 expired 回调各只触发一次", async () => {
    const sc = mk("auth.concurrent-expired", {
      requires: ["auth"],
      client: { plugins: { auth: { url_pattern: "/t/private", refresh: "endpoint" } } },
      steps: [
        { login: { user: "u1" } },
        { set_token: { access: "garbage", refresh: "garbage" } },
        { parallel: [{ request: { id: "a", path: "/t/private/me", query: { key: "a" } } }, { request: { id: "b", path: "/t/private/me", query: { key: "b" } } }] },
      ],
      expect: {
        "*": {
          results: { a: { ok: false, error: "expired" }, b: { ok: false, error: "expired" } },
          server: { by_path: { "/t/auth/refresh": { eq: 1 } } },
          client: { refresh: { eq: 1 }, expired: { eq: 1 }, pending_after: { eq: 0 } },
        },
      },
    });
    expectAllPass(await runAll(sc));
  });

  it("share：同 key 并发默认合并成一次；请求级 'none' 映射成 false，各发各的", async () => {
    const mkShare = (id: string, option: string | boolean, hits: number): Scenario =>
      mk(id, {
        requires: ["share", "key"],
        client: { plugins: { key: {}, share: { policy: "start" } } },
        steps: [
          {
            parallel: [
              { request: { id: "a", path: "/t/echo", query: { delay_ms: 80, key: "s" }, options: { key: true, share: option as never } } },
              { request: { id: "b", path: "/t/echo", query: { delay_ms: 80, key: "s" }, options: { key: true, share: option as never } } },
            ],
          },
        ],
        expect: { "*": { results: { a: { ok: true }, b: { ok: true } }, server: { by_path: { "/t/echo": { eq: hits } } }, ...GENERIC } },
      });
    expectAllPass(await runAll(mkShare("share.merged", true, 1)));
    expectAllPass(await runAll(mkShare("share.none", "none", 2)));
  });

  it("normalize: false：单次关闭业务判定，HTTP 200 + 非 0 业务码也 resolve（映射成 throws: false）；不关则抛 business:<code>", async () => {
    const off = mk("normalize.per-request-off", {
      requires: ["normalize"],
      client: { plugins: { normalize: {} } },
      steps: [{ request: { id: "r1", path: "/t/echo", query: { code: 5001 }, options: { normalize: false } } }],
      expect: { "*": { results: { r1: { ok: true } }, ...GENERIC } },
    });
    expectAllPass(await runAll(off));
    const on = mk("normalize.default-on", {
      requires: ["normalize"],
      client: { plugins: { normalize: {} } },
      steps: [{ request: { id: "r1", path: "/t/echo", query: { code: 5001 } } }],
      expect: { "*": { results: { r1: { ok: false, error: "business:5001" } }, ...GENERIC } },
    });
    expectAllPass(await runAll(on, { styles: ["http", "business"] }));
  });

  it("key：请求没写 key 就不生成 key（share:true 也不合并）；写了 key: true 才合并", async () => {
    const mkKey = (id: string, key: boolean | undefined, hits: number): Scenario =>
      mk(id, {
        requires: ["share", "key"],
        client: { plugins: { key: {}, share: { policy: "start" } } },
        steps: [
          {
            parallel: [
              { request: { id: "a", path: "/t/echo", query: { delay_ms: 80, key: "s" }, options: key === undefined ? { share: true } : { share: true, key } } },
              { request: { id: "b", path: "/t/echo", query: { delay_ms: 80, key: "s" }, options: key === undefined ? { share: true } : { share: true, key } } },
            ],
          },
        ],
        expect: { "*": { results: { a: { ok: true }, b: { ok: true } }, server: { by_path: { "/t/echo": { eq: hits } } }, ...GENERIC } },
      });
    expectAllPass(await runAll(mkKey("key.share-without-key", undefined, 2)));
    expectAllPass(await runAll(mkKey("key.share-with-key", true, 1)));
  });

  it("filter：装了 filter 但请求没写 filter: true 就原样发送；写了才剔除空值", async () => {
    const sc = mk("filter.off-by-default", {
      requires: ["filter"],
      client: { plugins: { filter: {} } },
      steps: [
        { request: { id: "r1", method: "POST", path: "/t/echo", body: { a: null, c: "", n: 0 } } },
        { request: { id: "r2", method: "POST", path: "/t/echo", body: { a: null, c: "", n: 0 }, options: { filter: true } } },
      ],
      expect: { "*": { results: { r1: { ok: true, data: { request: { body: { a: null, c: "", n: 0 } } } }, r2: { ok: true, data: { request: { body: { n: 0 } } } } }, ...GENERIC } },
    });
    const rs = await runAll(sc);
    expectAllPass(rs);
  });

  it("loading：并发只有一对 true/false；notify：失败只提示一次，silent 不提示", async () => {
    const loading = mk("loading.pair", {
      requires: ["loading"],
      client: { plugins: { loading: {} } },
      steps: [{ parallel: [{ request: { id: "a", path: "/t/echo", query: { delay_ms: 30 } } }, { request: { id: "b", path: "/t/echo", query: { delay_ms: 60 } } }] }],
      expect: { "*": { client: { loading: [true, false], pending_after: { eq: 0 } } } },
    });
    expectAllPass(await runAll(loading));
    const notify = mk("notify.once", {
      requires: ["notify", "normalize"],
      client: { plugins: { notify: {}, normalize: {} } },
      steps: [{ request: { id: "a", path: "/t/echo", query: { status: 500 } } }, { request: { id: "b", path: "/t/echo", query: { status: 500 }, options: { silent: true } } }],
      expect: { "*": { results: { a: { ok: false, error: "status:500" }, b: { ok: false, error: "status:500" } }, client: { notify: { eq: 1 }, pending_after: { eq: 0 } } } },
    });
    expectAllPass(await runAll(notify));
  });

  it("cancel：cancel_after_ms 取消 → canceled，服务端观测到 aborted，且不通知", async () => {
    const sc = mk("cancel.single", {
      requires: ["cancel"],
      client: { plugins: { cancel: {} } },
      steps: [{ request: { id: "r", path: "/t/echo", query: { delay_ms: 1500 }, cancel_after_ms: 100 } }],
      expect: { "*": { results: { r: { ok: false, error: "canceled" } }, server: { aborted: { min: 1 } }, duration_ms: { max: 1000 }, ...GENERIC } },
    });
    expectAllPass(await runAll(sc));
    const all = mk("cancel.all", {
      requires: ["cancel"],
      client: { plugins: { cancel: {} } },
      steps: [
        { fire: { request: { id: "a", path: "/t/echo", query: { delay_ms: 3000, key: "a" } } } },
        { fire: { request: { id: "b", path: "/t/echo", query: { delay_ms: 3000, key: "b" } } } },
        { cancel_all: { after_ms: 100 } },
      ],
      expect: { "*": { results: { a: { ok: false, error: "canceled" }, b: { ok: false, error: "canceled" } }, server: { aborted: { min: 2 } }, ...GENERIC } },
    });
    expectAllPass(await runAll(all));
  });

  it("坏响应：bad_json 与 html 都归为 parse；close 归为 network", async () => {
    const sc = mk("faults.parse", {
      requires: ["log"],
      steps: [
        { request: { id: "j", path: "/t/echo", query: { fault: "bad_json" } } },
        { request: { id: "h", path: "/t/echo", query: { fault: "html" } } },
        { request: { id: "c", path: "/t/echo", query: { fault: "close" } } },
      ],
      expect: { "*": { results: { j: { ok: false, error: "parse" }, h: { ok: false, error: "parse" }, c: { ok: false, error: ["network", "parse"] } }, ...GENERIC } },
    });
    expectAllPass(await runAll(sc));
  });

  it("repeat / fire / order：落定顺序按完成先后记录", async () => {
    const sc = mk("conc.order", {
      requires: ["log"],
      steps: [
        { parallel: [{ request: { id: "slow", path: "/t/echo", query: { delay_ms: 150, key: "s" } } }, { request: { id: "fast", path: "/t/echo", query: { delay_ms: 10, key: "f" } } }] },
        { repeat: { times: 2, step: { request: { id: "r", path: "/t/echo", query: { key: "rr" } } } } },
      ],
      expect: { "*": { order: ["fast", "slow"], results: { "r#0": { ok: true, hit: 1 }, "r#1": { ok: true, hit: 2 } }, ...GENERIC } },
    });
    expectAllPass(await runAll(sc));
  });

  it("dns 网络：不经过 netem，host 换成不可解析域名，错误为 network，服务端没有请求", async () => {
    const before = stub.netemCalls.length;
    const sc = mk("basic.dns", {
      networks: ["dns"],
      requires: ["log"],
      steps: [{ request: { id: "r", path: "/t/echo" } }],
      expect: { "*": { results: { r: { ok: false, error: "network" } }, server: { total: { eq: 0 } }, ...GENERIC } },
    });
    const rs = await runAll(sc);
    expectAllPass(rs);
    expect(stub.netemCalls.slice(before).some((c) => c.startsWith("POST /proxies"))).toBe(false);
  });

  it("network step 通过 netem 控制 API 切换；flap 走时间表", async () => {
    const before = stub.netemCalls.length;
    const sc = mk("network.switch", {
      requires: ["log"],
      steps: [{ network: "weak" }, { network: { mode: "refuse" } }, { network: "flap" }, { request: { id: "r", path: "/t/echo" } }],
      expect: { "*": { results: { r: { ok: true } } } },
    });
    expectAllPass(await runAll(sc, { styles: ["http"], adapters: ["http"] }), 1);
    const calls = stub.netemCalls.slice(before);
    expect(calls.some((c) => c.startsWith("POST /proxies "))).toBe(true);
    expect(calls.some((c) => c.includes('"profile":"weak"'))).toBe(true);
    expect(calls.some((c) => c.includes('"mode":"refuse"'))).toBe(true);
    expect(calls.some((c) => c.includes("/schedule") && c.includes('"at_ms":1500'))).toBe(true);
    expect(calls.some((c) => c.startsWith("DELETE /proxies/"))).toBe(true);
  });

  it("style step：运行中切风格，status:<n> 按请求发出时的风格匹配", async () => {
    const sc = mk("normalize.style-switch", {
      styles: ["http"],
      requires: ["normalize"],
      client: { plugins: { normalize: {} } },
      steps: [{ request: { id: "a", path: "/t/echo", query: { status: 500, key: "a" } } }, { style: "business" }, { request: { id: "b", path: "/t/echo", query: { status: 500, key: "b" } } }],
      expect: { "*": { results: { a: { ok: false, error: "status:500" }, b: { ok: false, error: "status:500" } }, ...GENERIC } },
    });
    expectAllPass(await runAll(sc, { adapters: ["http"] }), 1);
  });

  it("负向：预期没达成必须判失败并写明原因；映射不了的选项直接失败", async () => {
    const wrong = mk("neg.wrong", {
      requires: ["log"],
      steps: [{ request: { id: "r", path: "/t/echo" } }],
      expect: { "*": { results: { r: { ok: false, error: "timeout" } }, server: { total: { eq: 5 } } } },
    });
    const [r] = await runAll(wrong, { styles: ["http"], adapters: ["http"] });
    expect(r?.status).toBe("failed");
    expect(r?.reasons.some((x) => x.includes("期望失败"))).toBe(true);
    expect(r?.reasons.some((x) => x.includes("server.total"))).toBe(true);
    const unmapped = mk("neg.unmapped", {
      requires: ["cache"],
      client: { plugins: { cache: { bogus: 1 } } },
      steps: [{ request: { id: "r", path: "/t/echo" } }],
      expect: { "*": {} },
    });
    const [u] = await runAll(unmapped, { styles: ["http"], adapters: ["http"] });
    expect(u?.status).toBe("failed");
    expect(u?.reasons[0]).toMatch(/映射不了: 插件 cache\.bogus/);
  });

  it("运行超时：超过 timeout_ms 判失败，并报告 pending_after", async () => {
    const sc = mk("neg.timeout", {
      requires: ["log"],
      timeout_ms: 200,
      steps: [{ request: { id: "r", path: "/t/echo", query: { delay_ms: 1500 } } }],
      expect: { "*": {} },
    });
    const [r] = await runAll(sc, { styles: ["http"], adapters: ["http"] });
    expect(r?.status).toBe("failed");
    expect(r?.reasons.some((x) => x.includes("运行超过 200ms"))).toBe(true);
    expect(r?.reasons.some((x) => x.includes("pending_after"))).toBe(true);
  });
});
