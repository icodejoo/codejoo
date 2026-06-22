// 同步后端（localStorage/sessionStorage）核心行为：基础存取、TTL、sliding、namespace、raw、memoized、readonly、cloned、批量、keys/purge/clear。
// 真实 Chromium，真实 localStorage。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factory } from "../src/core";
import { codec } from "../src/codec";
import { JSONX } from "../src/serialization";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("ls — 基础同步读写", () => {
  it("set + get 字符串", () => {
    const { ls } = factory();
    ls.set("k", "hello");
    expect(ls.get("k")).toEqual("hello");
  });
  it("set + get 对象（自动 JSON 序列化）", () => {
    const { ls } = factory();
    ls.set("obj", { a: 1, b: [2, 3] });
    expect(ls.get("obj")).toEqual({ a: 1, b: [2, 3] });
  });
  it("get 缺失键 → null", () => {
    const { ls } = factory();
    expect(ls.get("nope")).toEqual(null);
  });
  it("get 默认值（缺失时返回默认）", () => {
    const { ls } = factory();
    expect(ls.get("nope", 42)).toEqual(42);
  });
  it("get 存在则忽略默认值", () => {
    const { ls } = factory();
    ls.set("n", 7);
    expect(ls.get("n", 42)).toEqual(7);
  });
  it("remove", () => {
    const { ls } = factory();
    ls.set("rm", 1);
    ls.remove("rm");
    expect(ls.get("rm")).toEqual(null);
  });
  it("length 反映条目数", () => {
    const { ls } = factory();
    ls.set("a", 1);
    ls.set("b", 2);
    expect(ls.length).toEqual(2);
  });
  it("clear 清空", () => {
    const { ls } = factory();
    ls.set("x", 1);
    ls.clear();
    expect(ls.length).toEqual(0);
  });
  it("存取假值（空串/0/false）不被吞成 null", () => {
    const { ls } = factory();
    ls.set("empty", "");
    ls.set("zero", 0);
    ls.set("flag", false);
    expect(ls.get("empty")).toEqual("");
    expect(ls.get("zero")).toEqual(0);
    expect(ls.get("flag")).toEqual(false);
  });
});

describe("过期 — ttl / expireAt", () => {
  it("ttl 未到期可读", () => {
    const { ls } = factory();
    ls.set("t1", "v", 1000);
    expect(ls.get("t1")).toEqual("v");
  });
  it("ttl 到期后返回 null 并被清除", async () => {
    const { ls } = factory();
    ls.set("t2", "v", 30);
    await sleep(50);
    expect(ls.get("t2")).toEqual(null);
    expect(localStorage.getItem("t2")).toEqual(null);
  });
  it("expireAt 未来时间（Date）可读", () => {
    const { ls } = factory();
    ls.set("e1", "v", { expireAt: new Date(Date.now() + 1000) });
    expect(ls.get("e1")).toEqual("v");
  });
  it("expireAt 过去时间 → 放弃写入（非滑动）", () => {
    const { ls } = factory();
    ls.set("e2", "v", { expireAt: Date.now() - 1000 });
    expect(ls.get("e2")).toEqual(null);
  });
  it("expireAt 接受日期字符串", () => {
    const { ls } = factory();
    ls.set("e3", "v", { expireAt: new Date(Date.now() + 1000).toISOString() });
    expect(ls.get("e3")).toEqual("v");
  });
});

describe("sliding — 滑动续期", () => {
  it("每次读命中按 ttl 续期", async () => {
    const { ls: s } = factory({ sliding: true });
    s.set("sl", "v", 80);
    await sleep(50);
    expect(s.get("sl")).toEqual("v");
    await sleep(50);
    expect(s.get("sl")).toEqual("v");
  });
  it("续期有阈值：剩余寿命 >90% 时跳过回写", () => {
    const { ls: s } = factory({ sliding: true });
    s.set("sl2", "v", 10000);
    const before = localStorage.getItem("sl2");
    expect(s.get("sl2")).toEqual("v");
    expect(localStorage.getItem("sl2")).toEqual(before);
  });
  it("剩余寿命 <90% 时正常续期回写", async () => {
    const { ls: s } = factory({ sliding: true });
    s.set("sl3", "v", 100);
    const before = JSON.parse(localStorage.getItem("sl3")!).expireAt;
    await sleep(30);
    expect(s.get("sl3")).toEqual("v");
    const after = JSON.parse(localStorage.getItem("sl3")!).expireAt;
    expect(after > before).toBe(true);
  });
  it("sliding 但无 ttl 时，过去的 expireAt 拒绝写入（不落盘死条目）", () => {
    const { ls: s } = factory({ sliding: true });
    s.set("dead", "v", { expireAt: Date.now() - 1000 });
    expect(s.get("dead")).toEqual(null);
    expect(localStorage.getItem("dead")).toEqual(null);
  });
  it("sliding + ttl 时，过去的 expireAt 改为从现在按 ttl 续期", () => {
    const { ls: s } = factory({ sliding: true });
    s.set("renew", "v", { expireAt: Date.now() - 1000, ttl: 500 });
    expect(s.get("renew")).toEqual("v");
  });
});

describe("namespace — 命名空间隔离", () => {
  it("不同命名空间同名 key 互不干扰", () => {
    const { ls: a } = factory({ namespace: "appA" });
    const { ls: b } = factory({ namespace: "appB" });
    a.set("token", "A");
    b.set("token", "B");
    expect(a.get("token")).toEqual("A");
    expect(b.get("token")).toEqual("B");
    expect(localStorage.getItem("appA:token") != null).toBe(true);
  });
  it("setNamespace 原地切换前缀，已持有引用自动生效（切账号）", () => {
    const store = factory({ namespace: "userA" });
    store.ls.set("token", "TA");
    expect(localStorage.getItem("userA:token") != null).toBe(true);
    store.setNamespace("userB");
    expect(store.ls.get("token")).toEqual(null);
    store.ls.set("token", "TB");
    expect(localStorage.getItem("userB:token") != null).toBe(true);
    expect(store.ls.get("token")).toEqual("TB");
    expect(localStorage.getItem("userA:token") != null).toBe(true);
  });
});

describe("clear — 命名空间/enckey 作用域", () => {
  it("namespace 实例 clear 只清自己的键，不波及他人", () => {
    localStorage.setItem("foreign", "keep");
    const { ls: a } = factory({ namespace: "nsA" });
    const { ls: b } = factory({ namespace: "nsB" });
    a.set("k", 1);
    b.set("k", 2);
    a.clear();
    expect(a.get("k")).toEqual(null);
    expect(b.get("k")).toEqual(2);
    expect(localStorage.getItem("foreign")).toEqual("keep");
  });
  it("enckey 实例 clear 只清能解开的键", () => {
    localStorage.setItem("foreign", "keep");
    const { ls: e } = factory({ codeable: true, codec: codec("pw"), enckey: true });
    e.set("k", 1);
    e.clear();
    expect(e.get("k")).toEqual(null);
    expect(localStorage.getItem("foreign")).toEqual("keep");
  });
  it("无命名空间且未加密键时 clear 整库清空（保持旧语义）", () => {
    const { ls } = factory();
    localStorage.setItem("foreign", "x");
    ls.set("own", 1);
    ls.clear();
    expect(localStorage.length).toEqual(0);
  });
});

describe("raw — 裸存模式", () => {
  it("raw 直接存原始字符串（无 entity 信封）", () => {
    const { ls: r } = factory({ raw: true });
    r.set("raw", "plain");
    expect(localStorage.getItem("raw")).toEqual("plain");
    expect(r.get("raw")).toEqual("plain");
  });
});

describe("memoized — 读缓存", () => {
  it("memoized 命中缓存（绕过底层变更）", () => {
    const { ls: m } = factory({ memoized: true });
    m.set("c", "cached");
    localStorage.setItem("c", JSON.stringify({ value: "changed" }));
    expect(m.get("c")).toEqual("cached");
  });
});

describe("serialize — JSONX 富类型", () => {
  it("JSONX.stringify/parse 往返 Date/Map/Set/bigint", () => {
    const data = {
      d: new Date("2026-06-06T00:00:00.000Z"),
      m: new Map([["x", 1n]]),
      s: new Set([1, 2, 3]),
      big: 9007199254740993n,
    };
    const back = JSONX.parse(JSONX.stringify(data));
    expect(back).toEqual(data);
    expect(back.d instanceof Date && back.m instanceof Map && back.s instanceof Set).toBe(true);
    expect(typeof back.big === "bigint").toBe(true);
  });
  it("storage 配 JSONX 存取富类型", () => {
    const { ls: j } = factory({ serialize: JSONX.stringify, deserialize: JSONX.parse });
    const v = { when: new Date(0), tags: new Set(["a"]) };
    j.set("rich", v);
    expect(j.get("rich")).toEqual(v);
    expect((j.get("rich") as { when: Date }).when instanceof Date).toBe(true);
  });
});

describe("readonly — 只写一次", () => {
  it("非空时丢弃写入，空时才写", () => {
    const { ls: r } = factory({ readonly: true });
    r.set("ro", "first");
    expect(r.get("ro")).toEqual("first");
    r.set("ro", "second");
    expect(r.get("ro")).toEqual("first");
    r.remove("ro");
    r.set("ro", "third");
    expect(r.get("ro")).toEqual("third");
  });
  it("已过期视为空，允许写入", async () => {
    const { ls: r } = factory({ readonly: true });
    r.set("roe", "x", 30);
    await sleep(50);
    r.set("roe", "y");
    expect(r.get("roe")).toEqual("y");
  });
});

describe("ss — sessionStorage", () => {
  it("ss 基础读写", () => {
    const { ss } = factory();
    ss.set("sk", "sv");
    expect(ss.get("sk")).toEqual("sv");
    expect(sessionStorage.getItem("sk") != null).toBe(true);
  });
});

describe("批量 — 数组 keys", () => {
  it("ls 批量 set/get/remove，默认值逐位生效", () => {
    const { ls } = factory();
    ls.set(["ba", "bb", "bc"], [1, "x", { z: 1 }]);
    expect(ls.get(["ba", "bb", "bc"])).toEqual([1, "x", { z: 1 }]);
    expect(ls.get(["ba", "missing"], [0, "dflt"])).toEqual([1, "dflt"]);
    ls.remove(["ba", "bb"]);
    expect(ls.get(["ba", "bb", "bc"])).toEqual([null, null, { z: 1 }]);
  });
  it("批量 set：values 短于 keys 时缺位键跳过（不写入 undefined）", () => {
    const { ls } = factory();
    ls.set(["k1", "k2", "k3"], [1, 2]);
    expect(ls.get(["k1", "k2", "k3"])).toEqual([1, 2, null]);
    expect(localStorage.getItem("k3")).toEqual(null);
  });
});

describe("keys / purge — 枚举与主动清理", () => {
  it("keys() 仅返回本命名空间逻辑键，不混入外部数据", () => {
    localStorage.setItem("foreign", "1");
    const { ls: a } = factory({ namespace: "ka" });
    a.set(["k1", "k2"], [1, 2]);
    expect(a.keys().sort()).toEqual(["k1", "k2"]);
  });
  it("keys() enckey 场景返回解密后的逻辑键", () => {
    const { ls: e } = factory({ codeable: true, codec: codec("pw"), enckey: true, namespace: "ke" });
    e.set("sec", 1);
    expect(e.keys()).toEqual(["sec"]);
  });
  it("purge() 主动回收过期但从未被读取的条目", async () => {
    const { ls: p } = factory({ namespace: "pg" });
    p.set("dead", 1, 30);
    p.set("alive", 2, 60000);
    await sleep(50);
    p.purge();
    expect(localStorage.getItem("pg:dead") == null).toBe(true);
    expect(localStorage.getItem("pg:alive") != null).toBe(true);
  });
});

describe("cloned — memo 副本隔离", () => {
  it("cloned: true 时修改返回值不污染缓存", () => {
    const { ls: c } = factory({ memoized: true, cloned: true, namespace: "cl" });
    c.set("o", { n: 1 });
    (c.get("o") as { n: number }).n = 999;
    expect((c.get("o") as { n: number }).n).toEqual(1);
  });
  it("默认共享引用（零开销路径行为不变）", () => {
    const { ls: c } = factory({ memoized: true, namespace: "cl2" });
    c.set("o", { n: 1 });
    (c.get("o") as { n: number }).n = 999;
    expect((c.get("o") as { n: number }).n).toEqual(999);
  });
});

describe("raw 混用 — 共享 memo 守卫", () => {
  it("非 raw 实例不把 raw 字符串误读为 entity（不再返回 undefined）", () => {
    const { ls: r } = factory({ raw: true, memoized: true });
    const { ls: s } = factory();
    r.set("mix", "rawstr");
    expect(s.get("mix") !== undefined).toBe(true);
    expect(s.get("mix")).toEqual(null);
  });
});
