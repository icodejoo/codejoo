import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KERNEL_CAPABILITIES, PLUGIN_CAPABILITIES, SUPPORTED_CAPABILITIES } from "../lib/constants.ts";
import {
  checkRequestOptions,
  validateScenarioMapping,
  mapCacheOptions,
  mapKeyOption,
  mapRequestOptions,
  withNeutralDefaults,
  injectsBusinessFailure,
  authUrlPatterns,
  PLUGIN_OPTION_MAP,
  REQUEST_OPTION_MAP,
  UNSUPPORTED_PLUGINS,
} from "../lib/mapping.ts";
import { parseConfig } from "../lib/config.ts";
import { analyzeDryRun, renderDryRun } from "../lib/dry-run.ts";
import { buildPlan } from "../lib/plan.ts";
import { buildMatrix, renderMatrix, skippedResult, totalsOf } from "../lib/report.ts";
import type { RunResult, Scenario } from "../lib/types.ts";
import { checkLoadingPaired } from "../lib/events.ts";
import { STEP_KINDS } from "../lib/walk.ts";

const sc = (over: Partial<Scenario> = {}): Scenario => ({ id: "x.one", title: "t", requires: [], networks: ["normal"], steps: [{ wait: 1 }], expect: { "*": {} }, ...over });

describe("映射：中立选项 → axp 参数", () => {
  it("请求级选项翻译", () => {
    expect(mapRequestOptions({ auth: true, cache: { ttl_ms: 300, key: "ck" }, timeout_ms: 500, silent: true })).toEqual({
      protected: true,
      cache: { expires: 300, key: "ck" },
      timeout: 500,
      silent: true,
    });
    expect(mapRequestOptions({ cache: false, share: "race", loading: false, mock: true, normalize: false })).toEqual({
      cache: false,
      share: "race",
      loading: false,
      mock: true,
      throws: false,
    });
    expect(mapRequestOptions(undefined)).toEqual({});
  });

  it("normalize: false 翻成 throws: false（失败也 resolve 出响应）；normalize: true 是内核默认，不输出任何字段", () => {
    expect(mapRequestOptions({ normalize: false })).toEqual({ throws: false });
    expect(mapRequestOptions({ normalize: true })).toEqual({});
    expect(mapRequestOptions({ normalize: false })).not.toHaveProperty("normalize");
  });

  it("share: 'none' 翻成 false（新架构没有 'none' 策略）；true 与策略名原样", () => {
    expect(mapRequestOptions({ share: "none" }).share).toBe(false);
    expect(mapRequestOptions({ share: false }).share).toBe(false);
    expect(mapRequestOptions({ share: true }).share).toBe(true);
    for (const policy of ["start", "end", "race"] as const) expect(mapRequestOptions({ share: policy }).share).toBe(policy);
    expect(mapRequestOptions({})).not.toHaveProperty("share");
    // 'none' 仍是合法的中立写法，能过校验
    expect(checkRequestOptions({ id: "r", path: "/x", options: { share: "none" } })).toEqual([]);
  });

  it("key：中立 true 直接是 axp 默认行为（含参数），'deep' 是同义写法也翻成 true；false 与显式字符串原样", () => {
    expect(mapRequestOptions({ key: true }).key).toBe(true);
    expect(mapRequestOptions({ key: "deep" }).key).toBe(true);
    expect(mapRequestOptions({ key: false }).key).toBe(false);
    expect(mapRequestOptions({ key: "fixed" }).key).toBe("fixed");
    expect(mapRequestOptions({})).not.toHaveProperty("key");
  });

  it("key：'simple'（只看方法+路径）新 key 服务没有这个模式，映射不了——校验阶段报错，直接调用也抛错", () => {
    expect(checkRequestOptions({ id: "r", path: "/x", options: { key: "simple" } })[0]).toMatch(/请求 r 选项 key: .*simple/);
    expect(validateScenarioMapping(sc({ steps: [{ request: { id: "r", path: "/x", options: { key: "simple" } } }] }))).toHaveLength(1);
    expect(() => mapKeyOption("simple")).toThrow(/映射不了/);
    expect(() => mapRequestOptions({ key: "simple" })).toThrow(/映射不了/);
    // 其它写法都能过校验
    for (const key of [true, false, "deep", "fixed"]) expect(checkRequestOptions({ id: "r", path: "/x", options: { key } })).toEqual([]);
  });

  it("cache.methods：映射成 cache 插件选项（转小写），不写就不传（沿用 axp 默认 get/head）", () => {
    expect(mapCacheOptions({ ttl_ms: 300, max: 5, methods: ["GET", "POST"] })).toEqual({ expires: 300, max: 5, methods: ["get", "post"] });
    expect(mapCacheOptions({ ttl_ms: 300 })).toEqual({ expires: 300 });
    expect(mapCacheOptions({})).not.toHaveProperty("methods");
    // 空名单 = 任何方法都不缓存，必须原样传，不能当成"没写"
    expect(mapCacheOptions({ methods: [] })).toEqual({ methods: [] });
    expect(validateScenarioMapping(sc({ client: { plugins: { cache: { ttl_ms: 1, methods: ["GET", "PUT"] } } } }))).toEqual([]);
    expect(validateScenarioMapping(sc({ client: { plugins: { cache: { methods: "GET" } } } }))[0]).toMatch(/cache\.methods: 需要字符串数组/);
  });

  it("中立默认：请求没写 key 就显式 key: false；装了 filter 且请求没写时显式 filter: false；写了的不动", () => {
    expect(withNeutralDefaults({}, undefined)).toEqual({ key: false });
    expect(withNeutralDefaults({}, { filter: {} })).toEqual({ key: false, filter: false });
    expect(withNeutralDefaults({ key: true, filter: true }, { filter: {} })).toEqual({ key: true, filter: true });
    expect(withNeutralDefaults({ key: "fixed" }, { cache: {} })).toEqual({ key: "fixed" });
    // 没装 filter 就不碰 filter
    expect(withNeutralDefaults({}, { cache: {} })).not.toHaveProperty("filter");
    // 不改入参
    const input = {};
    withNeutralDefaults(input, { filter: {} });
    expect(input).toEqual({});
  });

  it("injectsBusinessFailure：按服务端规则判断是否纯业务失败（HTTP 2xx + 非 0 业务码）", () => {
    // status=500：http 风格是 HTTP 500（不是纯业务失败），business 风格是 HTTP 200 + code 500
    expect(injectsBusinessFailure({ status: 500 }, "http")).toBe(false);
    expect(injectsBusinessFailure({ status: 500 }, "business")).toBe(true);
    // code=1001（不写 status）：两种风格都是 HTTP 200 + 业务码
    expect(injectsBusinessFailure({ code: 1001 }, "http")).toBe(true);
    expect(injectsBusinessFailure({ code: 1001 }, "business")).toBe(true);
    // status 与 code 同时出现：http 风格以 HTTP 状态为准
    expect(injectsBusinessFailure({ status: 500, code: 5001 }, "http")).toBe(false);
    expect(injectsBusinessFailure({ status: 500, code: 5001 }, "business")).toBe(true);
    // 没注入、code=0、非数字：都不是
    expect(injectsBusinessFailure(undefined, "business")).toBe(false);
    expect(injectsBusinessFailure({ delay_ms: 5 }, "business")).toBe(false);
    expect(injectsBusinessFailure({ code: 0 }, "business")).toBe(false);
    expect(injectsBusinessFailure({ code: "abc" }, "business")).toBe(false);
  });

  it("filter：请求级布尔原样映射成 config.filter；非布尔显式报错", () => {
    expect(mapRequestOptions({ filter: true })).toEqual({ filter: true });
    expect(mapRequestOptions({ filter: false })).toEqual({ filter: false });
    expect(mapRequestOptions({})).not.toHaveProperty("filter");
    expect(checkRequestOptions({ id: "r", path: "/x", options: { filter: true } })).toEqual([]);
    expect(checkRequestOptions({ id: "r", path: "/x", options: { filter: { ignoreKeys: ["a"] } as never } })[0]).toMatch(/filter/);
  });

  it("retry：数字/布尔原样，对象翻译并把方法转小写", () => {
    expect(mapRequestOptions({ retry: 1 }).retry).toBe(1);
    expect(mapRequestOptions({ retry: false }).retry).toBe(false);
    expect(mapRequestOptions({ retry: { max: 2, delay_ms: 50, statuses: [429], methods: ["GET", "POST"], respect_retry_after: true } }).retry).toEqual({
      max: 2,
      delay: 50,
      statusCodes: [429],
      methods: ["get", "post"],
      respectRetryAfter: true,
    });
  });

  it("auth.url_pattern 是前缀语义：翻成 [前缀, 前缀/*]", () => {
    expect(authUrlPatterns("/t/private")).toEqual(["/t/private", "/t/private/*"]);
    expect(authUrlPatterns("/t/public/guard/")).toEqual(["/t/public/guard", "/t/public/guard/*"]);
    expect(authUrlPatterns(undefined)).toEqual(["/t/private", "/t/private/*"]);
  });
});

describe("映射不了的选项要显式报错", () => {
  it("未知插件选项 / 取值不支持 / axp 没有的能力", () => {
    expect(validateScenarioMapping(sc({ client: { plugins: { cache: { ttl_ms: 1, bogus: 2 } } } }))).toEqual(["插件 cache.bogus: 没有对应的 axp 参数"]);
    expect(validateScenarioMapping(sc({ client: { plugins: { auth: { refresh: "other" } } } }))[0]).toMatch(/auth\.refresh: 仅支持/);
    expect(validateScenarioMapping(sc({ client: { plugins: { breaker: { threshold: 1 } } } }))).toEqual(["插件 breaker: axp 没有该能力"]);
    expect(validateScenarioMapping(sc({ client: { plugins: { key: { scope: "tenant" } } } }))[0]).toMatch(/key\.scope/);
  });

  it("请求选项：breaker 无对应能力；retry/cache 对象里的未知键也报错", () => {
    expect(checkRequestOptions({ id: "r", path: "/x", options: { breaker: false } })[0]).toMatch(/breaker/);
    expect(checkRequestOptions({ id: "r", path: "/x", options: { retry: { max: 1, jitter: true } as never } })[0]).toMatch(/retry\.jitter/);
    expect(checkRequestOptions({ id: "r", path: "/x", options: { cache: { ttl_ms: 1, foo: 1 } as never } })[0]).toMatch(/cache\.foo/);
    expect(checkRequestOptions({ id: "r", path: "/x", options: { cache: true, retry: 1 } })).toEqual([]);
  });

  it("嵌套在 parallel/fire/repeat 里的请求也会被检查", () => {
    const s = sc({ steps: [{ parallel: [{ fire: { repeat: { times: 2, step: { request: { id: "r", path: "/x", options: { breaker: true } } } } } }] }] });
    expect(validateScenarioMapping(s)).toHaveLength(1);
  });

  it("映射表的每个插件都有登记，step 类型共 16 种", () => {
    expect(Object.keys(PLUGIN_OPTION_MAP).sort()).toEqual(["auth", "cache", "cancel", "envs", "filter", "key", "loading", "log", "mock", "normalize", "notify", "repath", "retry", "share"]);
    expect(Object.keys(REQUEST_OPTION_MAP).sort()).toEqual(["auth", "breaker", "cache", "filter", "key", "loading", "mock", "normalize", "retry", "share", "silent", "timeout_ms"]);
    expect(STEP_KINDS).toHaveLength(16);
  });

  it("能力清单：内核具备（cancel/key/normalize/log）+ 插件提供 = axp 全部能力 = 映射表登记的插件，缺失的三项不在其中", () => {
    expect(KERNEL_CAPABILITIES.toSorted()).toEqual(["cancel", "key", "log", "normalize"]);
    expect(PLUGIN_CAPABILITIES.filter((c) => KERNEL_CAPABILITIES.includes(c))).toEqual([]);
    expect([...SUPPORTED_CAPABILITIES].toSorted()).toEqual([...PLUGIN_CAPABILITIES, ...KERNEL_CAPABILITIES].toSorted());
    expect([...SUPPORTED_CAPABILITIES].toSorted()).toEqual(Object.keys(PLUGIN_OPTION_MAP).toSorted());
    for (const c of UNSUPPORTED_PLUGINS) expect(SUPPORTED_CAPABILITIES.has(c), c).toBe(false);
  });

  it("mapping.md 的能力清单与代码一致（内核具备 / 插件提供 / 缺失 三行）", () => {
    const doc = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "mapping.md"), "utf8");
    /** 取 md 里"<标签>：`a b c`"这一行的名单 */
    const listOf = (label: string): string[] => (new RegExp(`${label}：\`([^\`]+)\``).exec(doc)?.[1] ?? "").split(/\s+/).filter(Boolean).toSorted();
    expect(listOf("内核具备")).toEqual(KERNEL_CAPABILITIES.toSorted());
    expect(listOf("插件提供")).toEqual(PLUGIN_CAPABILITIES.toSorted());
    expect(listOf("缺失")).toEqual(UNSUPPORTED_PLUGINS.toSorted());
  });

  const dir = "E:/workspaces/api-ws-demo/testkit/scenarios";
  it.skipIf(!fs.existsSync(dir))("真实场景里，schema 的 pluginOptions 与请求 options 的每个字段都已登记", () => {
    const schema = JSON.parse(fs.readFileSync(path.join(dir, "..", "scenario.schema.json"), "utf8"));
    for (const p of Object.keys(schema.$defs.pluginOptions.properties)) expect(PLUGIN_OPTION_MAP[p] ?? (UNSUPPORTED_PLUGINS.includes(p) ? [] : undefined), `pluginOptions.${p}`).toBeDefined();
    for (const o of Object.keys(schema.$defs.request.properties.options.properties)) expect(REQUEST_OPTION_MAP[o], `options.${o}`).toBeDefined();
    for (const k of Object.keys(schema.$defs.step.properties)) expect(STEP_KINDS as readonly string[], `step ${k}`).toContain(k);
  });
});

describe("config：命令行优先于环境变量，未知过滤值直接报错", () => {
  const acceptDir = path.resolve("accept");
  it("默认值与相对路径", () => {
    const c = parseConfig([], { TESTKIT_SCENARIOS: "rel/dir" }, "/work", acceptDir);
    expect(c.server).toBe("http://127.0.0.1:47080");
    expect(c.netem).toBe("http://127.0.0.1:47090");
    expect(c.scenarios).toBe(path.resolve("/work", "rel/dir"));
    expect(c.dry).toBe(false);
  });

  it("过滤条件：命令行覆盖环境变量，逗号分隔", () => {
    const c = parseConfig(["--id", "auth.,cache.", "--network", "weak", "--adapter", "fetch", "--dry"], { TESTKIT_NETWORK: "normal", TESTKIT_STYLE: "business" }, "/w", acceptDir);
    expect(c.filters).toEqual({ ids: ["auth.", "cache."], networks: ["weak"], styles: ["business"], adapters: ["fetch"] });
    expect(c.dry).toBe(true);
  });

  it("非法取值抛错", () => {
    expect(() => parseConfig(["--network", "mars"], {}, "/w", acceptDir)).toThrow(/未知的网络/);
    expect(() => parseConfig(["--jobs", "0"], {}, "/w", acceptDir)).toThrow(/--jobs/);
  });
});

describe("report / dry-run", () => {
  const mk = (over: Partial<RunResult>): RunResult => ({ key: "k", scenarioId: "auth.x", domain: "auth", network: "normal", style: "http", adapter: "http", status: "passed", reasons: [], durationMs: 1, ...over });

  it("汇总三态与跳过原因；矩阵按 领域×网络×风格 合并 adapter", () => {
    const rs = [mk({}), mk({ adapter: "fetch" }), mk({ status: "failed", reasons: ["x"] }), mk({ domain: "cache", status: "skipped", reasons: ["skipped: missing timeout"] }), mk({ domain: "cache", style: "business" })];
    expect(totalsOf(rs)).toEqual({ total: 5, passed: 3, failed: 1, skipped: 1, skipReasons: { "missing timeout": 1 } });
    const m = buildMatrix(rs);
    expect(m.auth?.["normal@http"]).toEqual({ passed: 2, failed: 1, skipped: 0 });
    expect(m.cache?.["normal@business"]).toEqual({ passed: 1, failed: 0, skipped: 0 });
    const text = renderMatrix(m);
    expect(text).toContain("风格 http");
    expect(text).toContain("2✗1");
  });

  it("跳过项的结果写成 skipped: <原因>", () => {
    const [e] = buildPlan([sc({ requires: ["breaker"] })], { ids: [], networks: [], styles: [], adapters: [] });
    expect(skippedResult(e!).reasons).toEqual(["skipped: missing breaker"]);
  });

  it("dry-run：统计总数/跳过/不可映射；缺能力而跳过的场景单独列出", () => {
    const list = [sc({ id: "a.ok" }), sc({ id: "a.bad", requires: ["cache"], client: { plugins: { cache: { bogus: 1 } } } }), sc({ id: "b.skip", requires: ["breaker"], client: { plugins: { breaker: {} } } })];
    const r = analyzeDryRun(buildPlan(list, { ids: [], networks: [], styles: [], adapters: [] }));
    expect(r.summary).toMatchObject({ total: 12, toRun: 8, skipped: 4 });
    expect(r.unmappedRunnable.map((x) => x.id)).toEqual(["a.bad"]);
    expect(r.unmappedSkipped.map((x) => x.id)).toEqual(["b.skip"]);
    const text = renderDryRun(r);
    expect(text).toContain("missing breaker: 4");
    expect(text).toContain("a.bad");
  });

  it("loading 成对检查", () => {
    expect(checkLoadingPaired([])).toBeNull();
    expect(checkLoadingPaired([true, false, true, false])).toBeNull();
    expect(checkLoadingPaired([true])).toMatch(/未成对/);
    expect(checkLoadingPaired([false, true])).toMatch(/最后一个/);
  });
});
