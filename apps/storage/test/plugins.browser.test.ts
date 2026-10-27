// 周边插件：fast/lazy/batchFast 绑定访问器、crossTab 跨标签同步、debug 解密快照。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { factory } from "../src/core";
import { batchFast, fast, lazy } from "../src/fast";
import { crossTab } from "../src/sync";
import { codec } from "../src/codec";
import { Idb } from "../src/idb";
import { debug } from "../src/debug";
import { supported } from "../src/helper";
import { Memory } from "../src/memory";
import { proxy } from "../src/proxy";
import type { BaseStorageOptions } from "../src/interface";

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

/** 向 BroadcastChannel 发消息（同源通道，无 targetOrigin 概念） */
// oxlint-disable-next-line unicorn/require-post-message-target-origin
const post = (bc: BroadcastChannel, msg: unknown): void => bc.postMessage(msg);

/** 模拟一个纯内存模式的「标签」并挂载 crossTab（挂载瞬间临时关闭 supported.storage） */
const mountTab = (channel: string, opts?: BaseStorageOptions) => {
  const orig = supported.storage;
  supported.storage = false;
  const h = proxy(new Memory(), new Memory(), opts);
  const stop = crossTab(h, channel);
  supported.storage = orig;
  return { h, stop };
};

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
  it("命名空间不同的标签不回放；相同命名空间正常回放", async () => {
    const a = mountTab("test-ct-ns", { namespace: "userA" });
    const a2 = mountTab("test-ct-ns", { namespace: "userA" });
    const b = mountTab("test-ct-ns", { namespace: "userB" });
    try {
      a.h.set("k", 1);
      await vi.waitFor(() => expect(a2.h.get("k")).toEqual(1)); // 同命名空间已收到 → 消息已投递
      expect(b.h.get("k")).toEqual(null);
      expect(b.h.length).toEqual(0);
      b.h.set("keep", 2);
      a.h.clear(); // A 的 clear 不应清掉 B 的数据
      a.h.set("ctl", 3); // 对照：消息按序投递，a2 收到它说明前面的 clear 广播已被各标签处理完
      await vi.waitFor(() => expect(a2.h.get("ctl")).toEqual(3));
      expect(b.h.get("keep")).toEqual(2);
    } finally {
      a.stop();
      a2.stop();
      b.stop();
    }
  });
  it("未知 op / 非数组消息被忽略，不会清空数据", async () => {
    const t = mountTab("test-ct-bogus");
    const bc = new BroadcastChannel("test-ct-bogus");
    try {
      t.h.set("keep", 1);
      post(bc, ["bogus", ""]);
      post(bc, ["bogus"]);
      post(bc, "junk");
      post(bc, ["set", "", "ctl", 2, undefined]); // 对照：合法消息按序处理，说明前面的已被消费
      await vi.waitFor(() => expect(t.h.get("ctl")).toEqual(2));
      expect(t.h.get("keep")).toEqual(1);
    } finally {
      bc.close();
      t.stop();
    }
  });
  it("op 合法但键不合法（缺失/非字符串）被忽略，不抛错；合法的批量数组键照常回放", async () => {
    const t = mountTab("test-ct-badkey");
    const bc = new BroadcastChannel("test-ct-badkey");
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener("error", onErr);
    try {
      t.h.set("keep", 1);
      post(bc, ["set", ""]);
      post(bc, ["remove", ""]);
      post(bc, ["set", "", 123, 1]);
      post(bc, ["remove", "", ["a", 1]]);
      post(bc, ["set", "", ["a", "b"], [1, 2]]); // 对照：合法批量消息按序处理
      await vi.waitFor(() => expect(t.h.get("b")).toEqual(2));
      expect(t.h.get("a")).toEqual(1);
      expect(t.h.get("keep")).toEqual(1);
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener("error", onErr);
      bc.close();
      t.stop();
    }
  });
  it("stop 幂等：旧 stop 再次调用不会还原重新挂载后的包装", () => {
    const orig = supported.storage;
    supported.storage = false;
    const h = proxy(new Memory(), new Memory());
    const stopA = crossTab(h, "test-ct-stop");
    stopA();
    const stopB = crossTab(h, "test-ct-stop");
    supported.storage = orig;
    const flag = () => (h as unknown as { __crossTab?: boolean }).__crossTab;
    stopA();
    expect(flag()).toBe(true);
    stopB();
    expect(flag()).toBe(false);
    stopB(); // 重复调用无副作用
    expect(flag()).toBe(false);
  });
});

describe("supported — 存储探测相互独立", () => {
  it("sessionStorage 访问抛 SecurityError 时 session=false，localStorage 不受影响，factory 不崩", async () => {
    const desc = Object.getOwnPropertyDescriptor(window, "sessionStorage")!;
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    const origSession = supported.session;
    try {
      // 带查询串重新求值 helper 模块，让探测在 sessionStorage 抛错的环境下重跑一次
      const { supported: s } = await import(/* @vite-ignore */ `../src/helper.ts?probe=${Date.now()}`);
      expect(s.storage).toBe(true);
      expect(s.session).toBe(false);
      // 以探测结果驱动 factory：ss 退回内存兜底，不触碰会抛错的 window.sessionStorage
      supported.session = s.session;
      const { ls, ss } = factory();
      ss.set("k", 1);
      expect(ss.get("k")).toEqual(1);
      ls.set("k", 2);
      expect(ls.get("k")).toEqual(2);
    } finally {
      supported.session = origSession;
      Object.defineProperty(window, "sessionStorage", desc);
    }
  });
});
