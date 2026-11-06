import { afterEach, describe, expect, it } from "vitest";
import { factory } from "../src/core";
import { codec } from "../src/codec";
import { supported } from "../src/helper";
import { STORE } from "../src/proxy";
import { Idb } from "../src/idb";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("sync 原生后端标记", () => {
  it("适配器保留实际种类与原生 area 身份", () => {
    const { ls, ss } = factory();
    expect(ls[STORE].kind).toBe("local");
    expect(ls[STORE].area).toBe(localStorage);
    expect(ss[STORE].kind).toBe("session");
    expect(ss[STORE].area).toBe(sessionStorage);
    const native = ls[STORE];
    native.set("adapter", "payload");
    expect(native.get("adapter")).toBe("payload");
    expect(native.length).toBe(1);
    expect(native.key(0)).toBe("adapter");
    expect(native.keys?.()).toEqual(["adapter"]);
    native.remove("adapter");
    expect(native.get("adapter")).toBeNull();
    native.set("adapter", "payload");
    native.clear();
    expect(native.length).toBe(0);
  });
  it("切换三层命名空间并释放显式 db，缺省 db 仍按原契约报错", async () => {
    const store = factory({ db: new Idb(`sync-kind-${crypto.randomUUID()}`) });
    store.setNamespace("kind:%");
    expect([store.ls.namespace, store.ss.namespace, store.db.namespace]).toEqual(Array(3).fill("kind%3A%25:"));
    store.ls.set("key", "local");
    store.ss.set("key", "session");
    await store.db.set("key", "idb");
    await store.destroy();
    expect(store.ls.get("key")).toBe("local");
    expect(store.ss.get("key")).toBe("session");
    await store.db.clear();
    await store.destroy();
    const empty = factory();
    await expect(empty.db.get("key")).rejects.toThrow("requires an IndexedDB instance");
    await empty.destroy();
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
