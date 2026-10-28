import { describe, expect, it } from "vitest";
import { expectKeys, resolveExpectation } from "../lib/expect.ts";
import { buildPlan, matchesIdFilter, missingCapabilities, summarizePlan } from "../lib/plan.ts";
import type { Filters } from "../lib/config.ts";
import type { Expectation, Scenario } from "../lib/types.ts";

/** 构造最小场景 */
function sc(over: Partial<Scenario> & { expect?: Record<string, Expectation> } = {}): Scenario {
  return { id: "x.one", title: "t", requires: [], networks: ["normal"], steps: [{ wait: 1 }], expect: { "*": {} }, ...over };
}
const NO_FILTER: Filters = { ids: [], networks: [], styles: [], adapters: [] };

describe("expect 合并：网络@风格 > 网络 > *@风格 > *", () => {
  it("候选键从低到高", () => {
    expect(expectKeys("weak", "business")).toEqual(["*", "*@business", "weak", "weak@business"]);
  });

  it("高优先级的同名字段覆盖低优先级，未覆盖的字段保留", () => {
    const s = sc({
      networks: ["normal", "weak"],
      expect: {
        "*": { results: { r: { ok: true } }, client: { pending_after: { eq: 0 } } },
        "*@business": { results: { r: { ok: false } } },
        normal: { server: { total: { eq: 1 } } },
        "normal@business": { results: { r: { ok: false, error: "status:500" } } },
      },
    });
    const normalBiz = resolveExpectation(s, "normal", "business");
    expect(normalBiz?.results).toEqual({ r: { ok: false, error: "status:500" } });
    expect(normalBiz?.server).toEqual({ total: { eq: 1 } });
    expect(normalBiz?.client).toEqual({ pending_after: { eq: 0 } });
    // normal@http：没有 *@http，也没有 normal@http → 用 normal 的 server + * 的 results
    expect(resolveExpectation(s, "normal", "http")?.results).toEqual({ r: { ok: true } });
    // weak@business：只命中 * 与 *@business
    expect(resolveExpectation(s, "weak", "business")?.results).toEqual({ r: { ok: false } });
    expect(resolveExpectation(s, "weak", "business")?.server).toBeUndefined();
  });

  it("没有任何键命中时返回 null", () => {
    expect(resolveExpectation(sc({ expect: { weak: {} } }), "normal", "http")).toBeNull();
  });
});

describe("plan：场景 × 网络 × 风格 × adapter", () => {
  it("默认两种风格、两种 adapter 全展开", () => {
    const plan = buildPlan([sc({ networks: ["normal", "weak"] })], NO_FILTER);
    expect(plan).toHaveLength(2 * 2 * 2);
    expect(new Set(plan.map((e) => e.key)).size).toBe(8);
  });

  it("styles 收窄风格", () => {
    const plan = buildPlan([sc({ styles: ["http"] })], NO_FILTER);
    expect(plan.map((e) => e.style)).toEqual(["http", "http"]);
  });

  it("缺能力 → skipped: missing <cap>，多个缺失合并书写", () => {
    const s = sc({ requires: ["auth", "breaker", "timeout"] });
    expect(missingCapabilities(s)).toEqual(["breaker", "timeout"]);
    const e = buildPlan([s], NO_FILTER)[0];
    expect(e?.decision).toEqual({ kind: "skip", category: "missing-capability", reason: "missing breaker+timeout" });
  });

  it("expect.skip 只跳过对应网络", () => {
    const s = sc({ networks: ["normal", "offline"], expect: { "*": {}, offline: { skip: "断网时无意义" } } });
    const plan = buildPlan([s], { ...NO_FILTER, adapters: ["http"], styles: ["http"] });
    const byNet = Object.fromEntries(plan.map((e) => [e.network, e.decision.kind]));
    expect(byNet).toEqual({ normal: "run", offline: "skip" });
    expect(plan.find((e) => e.network === "offline")?.decision).toMatchObject({ category: "not-applicable", reason: "not applicable: 断网时无意义" });
  });

  it("D21：没装 normalize 却期望业务码透传成功 → 该风格跳过（理由写明内核不可关闭）；装了 normalize 或失败本就是 HTTP 失败则照常执行", () => {
    const req = (id: string, query: Record<string, unknown>, options?: Record<string, unknown>) => ({ request: { id, path: "/t/echo", query, ...(options ? { options } : {}) } });
    const decisions = (s: Scenario) => Object.fromEntries(buildPlan([s], { ...NO_FILTER, adapters: ["http"] }).map((e) => [e.style, e.decision.kind]));
    // status=500：business 风格是 HTTP 200 + code 500（业务失败，期望透传成功 → 跳过），http 风格是 HTTP 500（照常执行）
    const status500 = sc({ steps: [req("r", { status: 500 })], expect: { "*": { results: { r: { ok: false } } }, "normal@business": { results: { r: { ok: true } } } } });
    expect(decisions(status500)).toEqual({ http: "run", business: "skip" });
    expect(buildPlan([status500], { ...NO_FILTER, adapters: ["http"], styles: ["business"] })[0]?.decision).toMatchObject({
      category: "not-applicable",
      reason: expect.stringContaining("axp 归一化为内核能力，不支持关闭"),
    });
    // code=5001（不写 status）：两种风格都是 HTTP 200 + 业务码，都跳过
    const code5001 = sc({ steps: [req("r", { code: 5001 })], expect: { "*": { results: { r: { ok: true } } } } });
    expect(decisions(code5001)).toEqual({ http: "skip", business: "skip" });
    // 装了 normalize：业务码本来就判失败，不属于这条规则
    expect(decisions({ ...code5001, client: { plugins: { normalize: {} } } })).toEqual({ http: "run", business: "run" });
    // 请求自己写了 normalize: false（映射成 throws: false）：本来就 resolve，照常执行
    expect(decisions(sc({ steps: [req("r", { code: 5001 }, { normalize: false })], expect: { "*": { results: { r: { ok: true } } } } }))).toEqual({ http: "run", business: "run" });
    // 期望的就是失败：照常执行
    expect(decisions(sc({ steps: [req("r", { code: 5001 })], expect: { "*": { results: { r: { ok: false, error: "business:5001" } } } } }))).toEqual({ http: "run", business: "run" });
    // 没有注入失败的普通请求：照常执行
    expect(decisions(sc({ steps: [req("r", {})], expect: { "*": { results: { r: { ok: true } } } } }))).toEqual({ http: "run", business: "run" });
    // repeat 展开的 id#i 也算同一个请求
    const repeated = sc({ steps: [{ repeat: { times: 2, step: req("r", { code: 5001 }) } }], expect: { "*": { results: { "r#0": { ok: true }, "r#1": { ok: true } } } } });
    expect(decisions(repeated)).toEqual({ http: "skip", business: "skip" });
  });

  it("blackhole 下期望 timeout 却没配任何超时 → 只跳过 blackhole 档；配了 base_timeout_ms 或请求 timeout_ms 的照常执行", () => {
    const hang = sc({ networks: ["normal", "blackhole"], steps: [{ request: { id: "r", path: "/t/echo" } }], expect: { "*": {}, blackhole: { results: { r: { ok: false, error: "timeout" } } } } });
    const byNet = (s: Scenario) => Object.fromEntries(buildPlan([s], { ...NO_FILTER, adapters: ["http"], styles: ["http"] }).map((e) => [e.network, e.decision]));
    const planned = byNet(hang);
    expect(planned.normal).toEqual({ kind: "run" });
    expect(planned.blackhole).toMatchObject({ kind: "skip", category: "not-applicable", reason: "not applicable: 场景未配置超时，blackhole 下请求无法落定" });
    expect(byNet({ ...hang, client: { base_timeout_ms: 500 } }).blackhole).toEqual({ kind: "run" });
    const requestLevel = sc({
      networks: ["blackhole"],
      steps: [{ request: { id: "r", path: "/t/echo", options: { timeout_ms: 300 } } }],
      expect: { "*": { results: { r: { ok: false, error: ["network", "timeout"] } } } },
    });
    expect(byNet(requestLevel).blackhole).toEqual({ kind: "run" });
    // 期望里没有 timeout（例如只断言 pending_after），不跳过
    const noTimeoutExpected = sc({ networks: ["blackhole"], steps: [{ request: { id: "r", path: "/t/echo" } }], expect: { "*": { results: { r: { ok: false, error: "network" } } } } });
    expect(byNet(noTimeoutExpected).blackhole).toEqual({ kind: "run" });
  });

  it("过滤：id 前缀、网络、风格、adapter", () => {
    const list = [sc({ id: "auth.a", networks: ["normal", "weak"] }), sc({ id: "cache.b", networks: ["normal"] })];
    expect(buildPlan(list, { ...NO_FILTER, ids: ["auth."] }).every((e) => e.scenario.id === "auth.a")).toBe(true);
    expect(buildPlan(list, { ...NO_FILTER, networks: ["weak"] }).every((e) => e.network === "weak")).toBe(true);
    expect(buildPlan(list, { ...NO_FILTER, styles: ["business"], adapters: ["fetch"] })).toHaveLength(3);
    expect(matchesIdFilter("auth.a", [])).toBe(true);
    expect(matchesIdFilter("auth.a", ["cache.", "auth."])).toBe(true);
    expect(matchesIdFilter("auth.a", ["cache."])).toBe(false);
  });

  it("映射问题随条目带出", () => {
    const s = sc({ client: { plugins: { cache: { bogus: 1 } } }, requires: ["cache"] });
    expect(buildPlan([s], NO_FILTER)[0]?.issues).toEqual(["插件 cache.bogus: 没有对应的 axp 参数"]);
  });

  it("汇总：总数、执行数、跳过原因分布、按 adapter", () => {
    const list = [sc({ id: "a.x", requires: ["breaker"] }), sc({ id: "a.y" })];
    const sum = summarizePlan(buildPlan(list, NO_FILTER));
    expect(sum).toMatchObject({ scenarios: 2, total: 8, toRun: 4, skipped: 4, skipReasons: { "missing breaker": 4 }, byAdapter: { http: 2, fetch: 2 } });
  });
});
