// 周边插件：fast/lazy/batchFast 绑定访问器、debug 解密快照。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factory } from "../src/core";
import { batchFast, fast, lazy } from "../src/fast";
import { codec } from "../src/codec";
import { Idb } from "../src/idb";
import { debug } from "../src/debug";

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
  it("debug 不写入调试键，不增加 keys()/length", () => {
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
