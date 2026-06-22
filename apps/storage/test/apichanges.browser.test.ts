// 近期 API 变更/修复的专项用例 + 审查缺口补测。
// 对照 proxy.ts 的 Handlers 接口 + interface.ts 契约。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "../src/core";
import { codec } from "../src/codec";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

// ── 变更 1：批量 get 只有元组形式 ──
describe("API 变更 1 — 批量 get 元组形式", () => {
  it("get(keys, defaults) 逐位取默认值类型，缺位为 unknown", () => {
    const { ls } = factory();
    ls.set("a", 1);
    expect(ls.get(["a", "b"], [0, false])).toEqual([1, false]);
    expect(ls.get(["a", "b"], [0])).toEqual([1, null]);
    expect(ls.get(["a", "b"])).toEqual([1, null]);
  });
  it("get<[number,boolean]>(keys) 显式泛型（无默认值）每位 X|null", () => {
    const { ls } = factory();
    ls.set("a", 5);
    const r = ls.get<[number, boolean]>(["a", "b"]);
    expect(r).toEqual([5, null]);
  });
});

// ── 变更 2：set 第三参不再支持 boolean，memoized 改用对象 ──
describe("API 变更 2 — set 第三参：数字=ttl，对象 memoized", () => {
  it("set(k,v,60000) 仍是 ttl（毫秒）", () => {
    const { ls } = factory();
    ls.set("k", "v", 60000);
    const raw = JSON.parse(localStorage.getItem("k")!);
    expect(typeof raw.expireAt).toEqual("number");
    expect(raw.ttl).toEqual(60000);
  });
  it("set(k,v,{memoized:true}) 写入 memo（绕过底层变更命中缓存）", () => {
    const { ls } = factory();
    ls.set("k", "cached", { memoized: true });
    localStorage.setItem("k", JSON.stringify({ value: "changed", createdAt: Date.now() }));
    expect(ls.get("k")).toEqual("cached");
  });
  it("set(k,v,{memoized:false}) 覆盖实例级 memoized，不写 memo", () => {
    const { ls } = factory({ memoized: true });
    ls.set("k", "v", { memoized: false });
    localStorage.setItem("k", JSON.stringify({ value: "changed", createdAt: Date.now() }));
    // 未写 memo → 读穿底层得到被改后的值
    expect(ls.get("k")).toEqual("changed");
  });
});

// ── 变更 3：onError 选项 ──
describe("API 变更 3 — onError 写入失败回调", () => {
  it("force:true 经 purge 重试仍失败 → onError({op:'set',key,error})", () => {
    const onError = vi.fn();
    const { ls } = factory({ onError, force: true });
    const err = new DOMException("quota", "QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw err;
    });
    ls.set("k", "v");
    expect(onError).toHaveBeenCalledTimes(1);
    const info = onError.mock.calls[0][0];
    expect(info.op).toEqual("set");
    expect(info.key).toEqual("k");
    expect(info.error).toBe(err);
  });
  it("有 onError 时不再 console.error", () => {
    const onError = vi.fn();
    const spyErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ls } = factory({ onError });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    ls.set("k", "v");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(spyErr).not.toHaveBeenCalled();
  });
  it("批量 set 下每个失败键各回调一次", () => {
    const onError = vi.fn();
    const { ls } = factory({ onError });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    ls.set(["a", "b", "c"], [1, 2, 3]);
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError.mock.calls.map((c) => c[0].key).sort()).toEqual(["a", "b", "c"]);
  });
});

// ── 变更 4：ttl 非法值告警并忽略，数据照常持久化 ──
describe("API 变更 4 — ttl 非法矩阵（告警并忽略 ttl）", () => {
  for (const bad of [0, -1, -1000, NaN, Infinity, -Infinity]) {
    it(`ttl=${bad} → 忽略 ttl，数据持久化、永不过期`, () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { ls } = factory();
      ls.set("k", "v", bad);
      expect(warn).toHaveBeenCalled();
      expect(ls.get("k")).toEqual("v");
      const raw = JSON.parse(localStorage.getItem("k")!);
      expect(raw.expireAt).toBeUndefined();
      expect(raw.ttl).toBeUndefined();
    });
  }
});

// ── 变更 5：enckey/codeable 无 codec → console.warn ──
describe("API 变更 5 — enckey/codeable 无 codec 告警", () => {
  it("enckey:true 但无 codec → warn，键保持明文", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ls } = factory({ enckey: true });
    ls.set("plain", "v");
    expect(warn).toHaveBeenCalled();
    expect(localStorage.getItem("plain") != null).toBe(true);
  });
  it("codeable:true 但无 codec → warn，值未编码", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ls } = factory({ codeable: true });
    ls.set("k", "v");
    expect(warn).toHaveBeenCalled();
    expect(localStorage.getItem("k")!.includes("v")).toBe(true);
  });
});

// ── 变更 6：length 按命名空间作用域 ──
describe("API 变更 6 — length 按命名空间/enckey 作用域", () => {
  it("namespace 实例 length 只数本实例管辖键", () => {
    localStorage.setItem("foreign", "1");
    const { ls: a } = factory({ namespace: "la" });
    a.set("k1", 1);
    a.set("k2", 2);
    expect(a.length).toEqual(2);
  });
  it("enckey 实例 length 只数能解开的键", () => {
    localStorage.setItem("foreign", "1");
    const { ls: e } = factory({ codeable: true, codec: codec("pw"), enckey: true });
    e.set("k1", 1);
    expect(e.length).toEqual(1);
  });
});

// ── 变更 7：memo 按 factory 实例隔离 ──
describe("API 变更 7 — memo 按 factory 实例隔离", () => {
  it("不同 factory() 不共享读缓存", () => {
    const { ls: a } = factory({ memoized: true });
    const { ls: b } = factory({ memoized: true });
    a.set("k", "fromA");
    // a 写入时填了 a 自己的 memo。偷改底层后：a 命中 a 的 memo（仍 fromA）；
    // b 从未读过 k、其 memo 为空（与 a 隔离）→ 读穿底层得 changed。
    localStorage.setItem("k", JSON.stringify({ value: "changed", createdAt: Date.now() }));
    expect(a.get("k")).toEqual("fromA");
    expect(b.get("k")).toEqual("changed");
  });
});

// ── 变更 8：debug() 无副作用（在 plugins 测试已覆盖一份，这里再验 raw 场景不落 [object Object]）──
describe("API 变更 8 — debug() 无副作用", () => {
  it("不写回 _$debug，length 不变", () => {
    const { ls } = factory();
    ls.set("a", 1);
    const before = ls.length;
    // 动态 import 避免与 plugins 文件重复声明
    return import("../src/debug").then(({ debug }) => {
      debug(ls);
      expect(ls.length).toEqual(before);
      expect(localStorage.getItem("_$debug")).toEqual(null);
    });
  });
});

// ── 缺口：配额超限 ──
describe("缺口 — 配额超限", () => {
  it("force:false 时写入失败直接抛出（不重试）", () => {
    const { ls } = factory({ force: false });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => ls.set("k", "v")).toThrow();
  });
  it("force:true 先 purge 清过期再重试；若重试成功则写入成功", () => {
    const { ls } = factory({ force: true });
    // 先放一条过期条目供 purge 回收
    ls.set("dead", "x", 30);
    let calls = 0;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      calls++;
      // 第一次新键写入抛配额错；purge 删除 dead 后的重试放行
      if (calls === 1 && k === "k") throw new DOMException("quota", "QuotaExceededError");
      return real.call(this, k, v);
    });
    return sleep(50).then(() => {
      ls.set("k", "v");
      vi.restoreAllMocks();
      expect(ls.get("k")).toEqual("v");
    });
  });
});

// ── 缺口：cloned 深隔离 ──
describe("缺口 — cloned 深隔离（嵌套对象/Map/Set）", () => {
  it("嵌套对象改动不污染缓存", () => {
    const { ls } = factory({ memoized: true, cloned: true, namespace: "dc" });
    ls.set("o", { inner: { n: 1 }, arr: [1, 2] });
    const got = ls.get("o") as { inner: { n: number }; arr: number[] };
    got.inner.n = 999;
    got.arr.push(3);
    const again = ls.get("o") as { inner: { n: number }; arr: number[] };
    expect(again.inner.n).toEqual(1);
    expect(again.arr).toEqual([1, 2]);
  });
  it("Map/Set 改动不污染缓存（配 JSONX）", async () => {
    const { JSONX } = await import("../src/serialization");
    const { ls } = factory({ memoized: true, cloned: true, namespace: "dc2", serialize: JSONX.stringify, deserialize: JSONX.parse });
    ls.set("m", { map: new Map([["a", 1]]), set: new Set([1]) });
    const got = ls.get("m") as { map: Map<string, number>; set: Set<number> };
    got.map.set("b", 2);
    got.set.add(2);
    const again = ls.get("m") as { map: Map<string, number>; set: Set<number> };
    expect(again.map.size).toEqual(1);
    expect(again.set.size).toEqual(1);
  });
});

// ── 缺口：sliding 90% 阈值两侧 ──
describe("缺口 — sliding 90% 阈值两侧", () => {
  it(">90% 剩余：跳过回写", () => {
    const { ls } = factory({ sliding: true });
    ls.set("k", "v", 10000);
    const before = localStorage.getItem("k");
    ls.get("k");
    expect(localStorage.getItem("k")).toEqual(before);
  });
  it("<90% 剩余：回写续期", async () => {
    const { ls } = factory({ sliding: true });
    ls.set("k", "v", 100);
    const before = JSON.parse(localStorage.getItem("k")!).expireAt;
    await sleep(30);
    ls.get("k");
    const after = JSON.parse(localStorage.getItem("k")!).expireAt;
    expect(after > before).toBe(true);
  });
});

// ── 缺口：destroy 后再用 ──
describe("缺口 — destroy 后再用", () => {
  it("同步层 destroy 后仍可继续读写（仅清了 memo）", () => {
    const { ls } = factory({ memoized: true });
    ls.set("k", "v");
    ls.destroy();
    expect(ls.get("k")).toEqual("v");
    ls.set("k2", "v2");
    expect(ls.get("k2")).toEqual("v2");
  });
});

// ── 缺口：多 factory 实例 memo 隔离（与变更 7 互补：raw 字符串守卫场景） ──
describe("缺口 — 多 factory 实例 memo 隔离不串读", () => {
  it("实例 A 的 memoized 写入不出现在实例 B 的 memo", () => {
    const { ls: a } = factory({ memoized: true, namespace: "ma" });
    const { ls: b } = factory({ memoized: true, namespace: "ma" });
    // a 写入只填 a 的 memo；b 的 memo 与之隔离。
    a.set("k", "A");
    // b 从未读过 k：偷改底层后 b 读穿底层得 changed（若与 a 共享 memo 会得到 a 缓存的 A）。
    localStorage.setItem("ma:k", JSON.stringify({ value: "changed", createdAt: Date.now() }));
    expect(b.get("k")).toEqual("changed");
    // a 仍命中自己的 memo
    expect(a.get("k")).toEqual("A");
  });
});

// ── 缺口：空数组批量 ──
describe("缺口 — 空数组批量", () => {
  it("空 keys 批量 get/set/remove 不报错", () => {
    const { ls } = factory();
    expect(ls.get([])).toEqual([]);
    expect(() => ls.set([], [])).not.toThrow();
    expect(() => ls.remove([])).not.toThrow();
  });
});

// ── 缺口：values 短于 keys ──
describe("缺口 — values 短于 keys", () => {
  it("缺位键跳过并告警，不写入 undefined", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ls } = factory();
    ls.set(["a", "b", "c"], [1]);
    expect(warn).toHaveBeenCalled();
    expect(ls.get(["a", "b", "c"])).toEqual([1, null, null]);
    expect(localStorage.getItem("b")).toEqual(null);
    expect(localStorage.getItem("c")).toEqual(null);
  });
});
