import { afterEach, describe, expect, it, vi } from "vitest";
import { Idb } from "../src/idb";
import { supported } from "../src/helper";
import { factory } from "../src/core";

/** 每次测试使用独立的数据库。 */
const name = () => `platform-${crypto.randomUUID()}`;
afterEach(() => vi.restoreAllMocks());

describe("platform IDB 原子更新", () => {
  it("两个独立 factory 的 readonly 使用事务条件写", async () => {
    const dbName = name();
    const a = factory({ db: new Idb(dbName), readonly: true });
    const b = factory({ db: new Idb(dbName), readonly: true });
    await Promise.all([a.db.set("once", "a"), b.db.set("once", "b")]);
    expect(await a.db.get("once")).toBe(await b.db.get("once"));
    expect(["a", "b"]).toContain(await a.db.get("once"));
    await Promise.all([a.destroy(), b.destroy()]);
  });
  it("两个连接并发条件写只有一个成功，旧读条件删除不覆盖新值", async () => {
    const dbName = name();
    const a = new Idb(dbName);
    const b = new Idb(dbName);
    expect(a.kind).toBe("idb");
    expect(b.kind).toBe("idb");
    let wins = 0;
    await Promise.all(
      [a, b].map((db, i) =>
        db.update("k", (current) => {
          if (current !== null) return undefined;
          wins++;
          return String(i);
        }),
      ),
    );
    expect(wins).toBe(1);
    const old = await a.get("k");
    await b.set("k", "new");
    expect(await a.update("k", (current) => (current === old ? null : undefined))).toBe("new");
    expect(await a.update("k", () => null)).toBeNull();
    expect(await b.get("k")).toBeNull();
    await Promise.all([a.destroy(), b.destroy()]);
  });
  it("fn 抛错回滚，显式 abort 以 AbortError 拒绝", async () => {
    const db = new Idb(name());
    await db.set("k", "old");
    const error = new Error("callback");
    await expect(
      db.update("k", () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await db.get("k")).toBe("old");
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      const req = put.call(this, value, key);
      req.addEventListener("success", () => this.transaction.abort());
      return req;
    });
    await expect(db.set("k", "new")).rejects.toHaveProperty("name", "AbortError");
    await expect(db.update("k", () => "new")).rejects.toHaveProperty("name", "AbortError");
    expect(await db.get("k")).toBe("old");
    await db.destroy();
  });
  it("打开失败不污染全局能力或其他实例，退避后可重试", async () => {
    const open = vi.spyOn(IDBFactory.prototype, "open").mockImplementationOnce(() => {
      throw new Error("temporary");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = 100;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const a = new Idb(name());
    await Promise.all([a.set("a", "1"), a.set("b", "2")]);
    expect(a.kind).toBe("idb");
    expect(open).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(supported.indexedDB).toBe(true);
    const b = new Idb(name());
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await b.set("real", "idb");
    expect(put).toHaveBeenCalled();
    await a.get("a");
    expect(open).toHaveBeenCalledTimes(2);
    now += 1000;
    await a.set("recovered", "yes");
    expect(open).toHaveBeenCalledTimes(3);
    expect(await a.get("recovered")).toBe("yes");
    await Promise.all([a.destroy(), b.destroy()]);
  });

  it("请求错误与同步操作错误保留原异常", async () => {
    const db = new Idb(name());
    await db.set("k", "old");
    const add = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      return add.call(this, value, key);
    });
    await expect(db.set("k", "duplicate")).rejects.toHaveProperty("name", "ConstraintError");
    await expect(db.update("k", () => "duplicate")).rejects.toHaveProperty("name", "ConstraintError");
    spy.mockRestore();
    const error = new Error("sync put");
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw error;
    });
    await expect(db.set("k", "new")).rejects.toBe(error);
    await expect(db.update("k", () => "new")).rejects.toBe(error);
    expect(await db.get("k")).toBe("old");
    await db.destroy();
  });

  it("连接关闭和版本变更后重新打开，下标越界与缺键返回 null", async () => {
    const db = new Idb(name());
    await db.set("a", "1");
    const first = (await (db as any).db) as IDBDatabase;
    first.dispatchEvent(new Event("versionchange"));
    expect(await db.get("a")).toBe("1");
    const second = (await (db as any).db) as IDBDatabase;
    expect(first).not.toBe(second);
    second.close();
    second.dispatchEvent(new Event("close"));
    expect(await db.keys()).toEqual(["a"]);
    expect(await db.key(1)).toBeNull();
    expect(await db.key(-1)).toBeNull();
    expect(await db.key(NaN)).toBe("a");
    expect(await db.get("absent")).toBeNull();
    expect(await db.update("absent", () => undefined)).toBeNull();
    await db.destroy();
    await db.destroy();
  });

  it("异步打开失败、destroy 在途与指数退避上限", async () => {
    let now = 100;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const error = new DOMException("failed", "UnknownError");
    const open = vi.spyOn(IDBFactory.prototype, "open").mockImplementation(() => {
      const req = { error, onerror: null as null | (() => void) };
      queueMicrotask(() => req.onerror?.());
      return req as unknown as IDBOpenDBRequest;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = new Idb(name());
    const pending = db.set("k", "memory");
    await Promise.all([pending, db.destroy()]);
    expect(warn).toHaveBeenCalledTimes(1);
    await db.get("k");
    expect(open).toHaveBeenCalledTimes(1);
    // destroy 不应令一个失败的打开请求跳过退避，后续失败仍有上限。
    for (let i = 0; i < 8; i++) {
      now += 60_000;
      await db.get("k");
    }
    expect(warn).toHaveBeenCalled();
    expect((db as any).retryDelay).toBe(30_000);
    const calls = open.mock.calls.length;
    await db.get("k");
    expect(open).toHaveBeenCalledTimes(calls);
    await db.destroy();
  });
});
