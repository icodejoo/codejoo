import { describe, expect, it } from "vitest";
import { checkOrder, checkRange, countAborted, reachedServer, serverKeyOf, subsetMatch } from "../lib/matchers.ts";
import type { Observation } from "../lib/matchers.ts";

/** 构造观测 */
const obs = (over: Partial<Observation> = {}): Observation => ({ total: 0, inflight: 0, peak_inflight: 0, by_key: {}, by_path: {}, log: [], ...over });

describe("subsetMatch", () => {
  it("对象只比较列出的键，多余的键忽略", () => {
    expect(subsetMatch({ meta: { auth: "u1", hit: 2 }, x: 1 }, { meta: { auth: "u1" } })).toEqual([]);
  });

  it("值不同、键缺失、类型不对都报差异并带路径", () => {
    expect(subsetMatch({ a: 1 }, { a: 2 })).toEqual(["data.a: 实际 1，期望 2"]);
    expect(subsetMatch({}, { a: 1 })[0]).toMatch(/data\.a: 缺失/);
    expect(subsetMatch("x", { a: 1 })[0]).toMatch(/期望对象/);
    expect(subsetMatch({ a: 1 }, { a: { b: 1 } })[0]).toMatch(/data\.a: 期望对象/);
  });

  it("数组要求长度一致并逐项匹配；null 只等于 null", () => {
    expect(subsetMatch([{ a: 1, b: 2 }], [{ a: 1 }])).toEqual([]);
    expect(subsetMatch([1, 2], [1])[0]).toMatch(/长度 2 ≠ 1/);
    expect(subsetMatch({ auth: null }, { auth: null })).toEqual([]);
    expect(subsetMatch({ auth: "u1" }, { auth: null })).toHaveLength(1);
  });
});

describe("checkRange", () => {
  it("eq / min / max 任意组合", () => {
    expect(checkRange("n", 3, { eq: 3 })).toBeNull();
    expect(checkRange("n", 3, { eq: 4 })).toMatch(/= 4/);
    expect(checkRange("n", 3, { min: 1, max: 5 })).toBeNull();
    expect(checkRange("n", 0, { min: 1 })).toMatch(/≥ 1/);
    expect(checkRange("n", 9, { max: 5 })).toMatch(/≤ 5/);
    expect(checkRange("n", 0, { eq: 0 })).toBeNull();
  });
});

describe("checkOrder", () => {
  it("只比较预期里出现的 id 的相对顺序", () => {
    expect(checkOrder(["a", "x", "b", "c"], ["a", "b", "c"])).toBeNull();
    expect(checkOrder(["b", "a"], ["a", "b"])).toMatch(/实际 \[b,a\]/);
  });

  it("预期的请求没有落定也算违规", () => {
    expect(checkOrder(["a"], ["a", "b"])).toMatch(/未落定 b/);
  });
});

describe("from_cache 推断：到达服务器 = 服务端计数增加", () => {
  it("按 by_key 增量判断，不受其它 key 干扰", () => {
    const before = obs({ total: 1, by_key: { "GET /t/echo": 1 } });
    expect(reachedServer(before, obs({ total: 2, by_key: { "GET /t/echo": 1, other: 1 } }), "GET /t/echo")).toBe(false);
    expect(reachedServer(before, obs({ total: 2, by_key: { "GET /t/echo": 2 } }), "GET /t/echo")).toBe(true);
  });

  it("没有 key 时用 total 增量", () => {
    expect(reachedServer(obs({ total: 3 }), obs({ total: 3 }), undefined)).toBe(false);
    expect(reachedServer(obs({ total: 3 }), obs({ total: 4 }), undefined)).toBe(true);
  });

  it("服务端分组键：query.key 优先，路径含变量则未知", () => {
    expect(serverKeyOf("get", "/t/echo", undefined)).toBe("GET /t/echo");
    expect(serverKeyOf("GET", "/t/echo", { key: "k1" })).toBe("k1");
    expect(serverKeyOf("GET", "/t/public/pet/{id}", undefined)).toBeUndefined();
  });

  it("统计 aborted", () => {
    expect(countAborted(obs({ log: [{ aborted: true }, { aborted: false }, {}] }))).toBe(1);
  });
});
