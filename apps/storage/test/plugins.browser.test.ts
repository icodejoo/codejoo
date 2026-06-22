// 周边插件：fast/lazy/batchFast 绑定访问器、crossTab 跨标签同步、debug 解密快照。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factory } from "../src/core";
import { batchFast, fast, lazy } from "../src/fast";
import { crossTab } from "../src/sync";
import { codec } from "../src/codec";
import { Idb } from "../src/idb";
import { debug } from "../src/debug";
import { supported } from "../src/helper";
import { Memory } from "../src/memory";
import { proxy } from "../src/proxy";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("fast / lazy — 绑定 key 快捷器", () => {
  it("fast(ls,key) get/set/remove", () => {
    const { ls } = factory();
    const token = fast(ls, "fast_token");
    token.set("abc");
    expect(token.get()).toEqual("abc");
    token.remove();
    expect(token.get()).toEqual(null);
    expect(token.get("def")).toEqual("def");
  });
  it("lazy 首次调用才建、之后复用同一实例", () => {
    const { ls } = factory();
    const acc = lazy(ls, "lazy_k");
    const a1 = acc();
    const a2 = acc();
    expect(a1 === a2).toBe(true);
    a1.set("z");
    expect(a2.get()).toEqual("z");
  });
});

describe("batchFast — 批量绑定", () => {
  it("返回按 key 命名的访问器对象", () => {
    const { ls } = factory();
    const { token, user } = batchFast<unknown, ["token", "user"]>(ls, ["token", "user"]);
    token.set("abc");
    user.set({ id: 1 });
    expect(token.get()).toEqual("abc");
    expect(user.get()).toEqual({ id: 1 });
    user.remove();
    expect(user.get()).toEqual(null);
  });
});

describe("enckey — 键加密", () => {
  it("enckey 加密存储键，get 仍可读", () => {
    const { ls: e } = factory({ codeable: true, codec: codec("k1"), enckey: true });
    e.set("secretKey", "v");
    expect(localStorage.getItem("secretKey")).toEqual(null);
    expect(e.get("secretKey")).toEqual("v");
    expect(localStorage.length).toEqual(1);
  });
});

describe("debug — 解密快照", () => {
  it("debug 返回保留命名空间的明文快照（加密场景）", () => {
    const { ls: e } = factory({ codeable: true, codec: codec("k2"), enckey: true, namespace: "ns" });
    e.set("a", 1);
    e.set("b", { x: 2 });
    expect(debug(e)).toEqual({ "ns:a": 1, "ns:b": { x: 2 } });
  });
  it("debug 分别作用于 ls / ss / db", async () => {
    const store = factory({ db: new Idb("codejoo-bt-debug") });
    store.ls.clear();
    store.ss.clear();
    await store.db.clear();
    store.ls.set("k", "lv");
    store.ss.set("k", "sv");
    await store.db.set("k", "dv");
    expect(debug(store.ls)).toEqual({ k: "lv" });
    expect(debug(store.ss)).toEqual({ k: "sv" });
    expect(await debug(store.db)).toEqual({ k: "dv" });
    await store.db.clear();
  });
  it("debug 无副作用：不写回 _$debug，不污染 keys()/length", () => {
    const { ls } = factory({ namespace: "dbg" });
    ls.set("a", 1);
    ls.set("b", 2);
    const beforeLen = ls.length;
    debug(ls);
    expect(ls.length).toEqual(beforeLen);
    expect(ls.keys().sort()).toEqual(["a", "b"]);
    expect(localStorage.getItem("dbg:_$debug")).toEqual(null);
    expect(localStorage.getItem("_$debug")).toEqual(null);
  });
});

describe("crossTab — 跨标签同步插件", () => {
  it("原生 storage 可用时为空操作", () => {
    const { ls } = factory();
    const stop = crossTab(ls);
    expect(!(ls as unknown as { __crossTab?: boolean }).__crossTab).toBe(true);
    stop();
  });
  it("纯内存模式下经 BroadcastChannel 同步（隔离双实例模拟双标签）", async () => {
    const orig = supported.storage;
    supported.storage = false;
    const t1 = proxy(new Memory(), new Memory());
    const t2 = proxy(new Memory(), new Memory());
    const s1 = crossTab(t1, "test-ct");
    const s2 = crossTab(t2, "test-ct");
    supported.storage = orig;
    try {
      t1.set("k", { v: 1 }, 60000);
      await sleep(60);
      expect(t2.get("k")).toEqual({ v: 1 });
      t1.remove("k");
      await sleep(60);
      expect(t2.get("k")).toEqual(null);
    } finally {
      s1();
      s2();
    }
  });
  it("重复挂载幂等；stop 后卸载", () => {
    const orig = supported.storage;
    supported.storage = false;
    const t1 = proxy(new Memory(), new Memory());
    const stop1 = crossTab(t1, "test-ct2");
    const stop2 = crossTab(t1, "test-ct2");
    supported.storage = orig;
    const flag = () => (t1 as unknown as { __crossTab?: boolean }).__crossTab;
    expect(flag()).toBe(true);
    stop2();
    expect(flag()).toBe(true);
    stop1();
    expect(flag()).toBe(false);
  });
});
