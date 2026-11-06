// 仅保留 IDB 原语、真实事务及 factory 生命周期；公共语义见 matrix-*。
import { afterEach, describe, expect, it, vi } from "vitest";
import { factory, Idb } from "../src/index";
import { Memory } from "../src/memory";
import { proxy } from "../src/proxy";
import { clock } from "./helpers/clock";

/** 每例数据库及其连接统一关闭、删库，保证重复运行没有遗留。 */
const databases = new Map<string, Idb>();

/** 创建随机隔离的真实数据库。 */
function database() {
  const name = "idb-special-" + crypto.randomUUID(),
    store = new Idb(name);
  databases.set(name, store);
  return store;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const [name, store] of databases) {
    await store.destroy();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IDB test connection leaked"));
    });
  }
  databases.clear();
});

describe("IDB platform-specific contracts", () => {
  it("direct string backend set get remove clear length and key", async () => {
    const store = database();
    await store.set("a", "1");
    await store.set("b", "2");
    expect(await store.get("a")).toBe("1");
    expect(await store.length()).toBe(2);
    expect([await store.key(0), await store.key(1)].toSorted()).toEqual(["a", "b"]);
    await store.remove("a");
    expect(await store.get("a")).toBeNull();
    expect(await store.length()).toBe(1);
    await store.clear();
    expect(await store.length()).toBe(0);
  });

  it("using db without an explicit instance rejects with actionable guidance", async () => {
    const store = factory();
    try {
      await expect(store.db.get("missing")).rejects.toThrow("requires an IndexedDB instance");
    } finally {
      await store.destroy();
    }
  });

  it("factory destroy releases all layers and preserves their persisted values", async () => {
    const namespace = "factory-" + crypto.randomUUID(),
      store = factory({ db: database(), namespace });
    try {
      store.ls.set("k", "local");
      store.ss.set("k", "session");
      await store.db.set("k", "database");
      const pending = store.destroy();
      expect(pending).toBeInstanceOf(Promise);
      await pending;
      expect(store.ls.get("k")).toBe("local");
      expect(store.ss.get("k")).toBe("session");
      expect(await store.db.get("k")).toBe("database");
    } finally {
      store.ls.clear();
      store.ss.clear();
      await store.db.clear();
      await store.destroy();
    }
  });

  it("request success followed by transaction abort reports abort and rolls back memo and disk", async () => {
    const put = IDBObjectStore.prototype.put,
      onError = vi.fn();
    const store = factory({ db: database(), memoized: true, onError });
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = put.call(this, value, key),
        transaction = this.transaction;
      request.addEventListener("success", () => transaction.abort());
      return request;
    });
    try {
      await store.db.set("k", 1);
      spy.mockRestore();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.lastCall?.[0]).toMatchObject({ kind: "abort", op: "set", key: "k", error: expect.objectContaining({ name: "AbortError" }) });
      expect(await store.db.get("k")).toBeNull();
      expect(await store.db.length).toBe(0);
    } finally {
      spy.mockRestore();
      await store.destroy();
    }
  });

  it("sliding renewal and unrelated write leave memo expiry identical to committed entity", async () => {
    const time = clock(),
      backend = database(),
      memo = new Memory(),
      handler = proxy(backend, memo, { sliding: true });
    try {
      await handler.set("k", "v", { ttl: 1000, memoized: true });
      time.advance(150);
      await Promise.all([handler.get("k"), handler.set("other", 1)]);
      expect(memo.get("k")).toEqual(JSON.parse((await backend.get("k"))!));
      expect(await handler.get("k")).toBe("v");
    } finally {
      await handler.destroy();
      time.restore();
    }
  });
});
