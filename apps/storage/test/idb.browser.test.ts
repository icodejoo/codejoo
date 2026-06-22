// IndexedDB 异步后端：Idb 直接用法 + db（异步 proxy）全特性 + 批量 + purge + namespace clear。
// 每个 it 用独立 db 名，避免跨用例污染。
import { describe, expect, it } from "vitest";
import { factory } from "../src/core";
import { Idb } from "../src/idb";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Idb — 异步底层直接用", () => {
  it("Idb set/get/remove/length/key", async () => {
    const idb = new Idb("codejoo-bt-idb-direct");
    await idb.clear();
    await idb.set("a", "1");
    await idb.set("b", "2");
    expect(await idb.get("a")).toEqual("1");
    expect(await idb.length()).toEqual(2);
    const k0 = await idb.key(0);
    expect(k0 === "a" || k0 === "b").toBe(true);
    await idb.remove("a");
    expect(await idb.get("a")).toEqual(null);
    expect(await idb.length()).toEqual(1);
    await idb.clear();
    expect(await idb.length()).toEqual(0);
  });
});

describe("db — 异步 proxy 全特性", () => {
  it("db set/get（返回 Promise）", async () => {
    const { db } = factory({ db: new Idb("codejoo-bt-db-setget"), namespace: "x" });
    await db.clear();
    const p = db.set("k", { v: 1 });
    expect(p instanceof Promise).toBe(true);
    await p;
    expect(await db.get("k")).toEqual({ v: 1 });
    await db.clear();
  });
  it("db 默认值", async () => {
    const { db } = factory({ db: new Idb("codejoo-bt-db-default"), namespace: "x" });
    await db.clear();
    expect(await db.get("missing", "d")).toEqual("d");
  });
  it("db ttl 过期", async () => {
    const { db } = factory({ db: new Idb("codejoo-bt-db-ttl"), namespace: "x" });
    await db.clear();
    await db.set("t", "v", 30);
    expect(await db.get("t")).toEqual("v");
    await sleep(50);
    expect(await db.get("t")).toEqual(null);
    await db.clear();
  });
  it("db remove / length", async () => {
    const { db } = factory({ db: new Idb("codejoo-bt-db-rmlen"), namespace: "x" });
    await db.clear();
    await db.set("a", 1);
    await db.set("b", 2);
    expect(await db.length).toEqual(2);
    await db.remove("a");
    expect(await db.length).toEqual(1);
    await db.clear();
  });
  it("未传 db 实例时使用 db 抛错提示", async () => {
    const { db: missing } = factory();
    let threw = false;
    try {
      await missing.get("x");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe("db namespace clear（异步作用域）", () => {
  it("db 命名空间 clear 只清本命名空间", async () => {
    const shared = new Idb("codejoo-bt-nsclear");
    const { db: p } = factory({ db: shared, namespace: "p" });
    const { db: q } = factory({ db: shared, namespace: "q" });
    await shared.clear();
    await p.set("k", 1);
    await q.set("k", 2);
    await p.clear();
    expect(await p.get("k")).toEqual(null);
    expect(await q.get("k")).toEqual(2);
    await shared.clear();
  });
});

describe("db 批量 / purge（异步，批量走循环）", () => {
  it("db 批量 set/get/remove", async () => {
    const { db: bdb } = factory({ db: new Idb("codejoo-bt-batch"), namespace: "bt" });
    await bdb.clear();
    await bdb.set(["x", "y", "z"], [10, "s", { a: 1 }], 60000);
    expect(await bdb.get(["x", "y", "z", "none"], [0, "", {}, "d"])).toEqual([10, "s", { a: 1 }, "d"]);
    await bdb.remove(["x", "y"]);
    expect(await bdb.get(["x", "z"])).toEqual([null, { a: 1 }]);
    await bdb.clear();
    expect(await bdb.length).toEqual(0);
  });
  it("db 批量 + memoized：缓存命中与后端未命中混合", async () => {
    const { db: mdb } = factory({ db: new Idb("codejoo-bt-batch2"), namespace: "bm", memoized: true });
    await mdb.clear();
    await mdb.set("hit", "cached");
    await mdb.set("miss", "fromdb");
    expect(await mdb.get(["hit", "miss", "none"], [0, 0, "d"])).toEqual(["cached", "fromdb", "d"]);
    await mdb.clear();
  });
  it("db purge() 回收过期但未读取条目", async () => {
    const { db: pdb } = factory({ db: new Idb("codejoo-bt-purge"), namespace: "pp" });
    await pdb.clear();
    await pdb.set("dead", 1, 30);
    await pdb.set("alive", 2, 60000);
    await sleep(50);
    await pdb.purge();
    expect(await pdb.length).toEqual(1);
    expect(await pdb.get("alive")).toEqual(2);
    await pdb.clear();
  });
});

describe("destroy — 资源回收", () => {
  it("proxy.destroy 清空 memo 缓存但保留落盘数据（同步层）", () => {
    localStorage.clear();
    const { ls: m } = factory({ memoized: true });
    m.set("d", "v");
    localStorage.setItem("d", JSON.stringify({ value: "changed" }));
    expect(m.get("d")).toEqual("v");
    m.destroy();
    expect(m.get("d")).toEqual("changed");
    localStorage.clear();
  });
  it("factory.destroy 统一释放 ls/ss/db（返回 Promise），落盘数据保留", async () => {
    const store = factory({ db: new Idb("codejoo-bt-destroy") });
    store.ls.clear();
    await store.db.clear();
    store.ls.set("k", "v");
    await store.db.set("k", "dv");
    const p = store.destroy();
    expect(p instanceof Promise).toBe(true);
    await p;
    expect(store.ls.get("k")).toEqual("v");
    expect(await store.db.get("k")).toEqual("dv");
    await store.db.clear();
    store.ls.clear();
  });
});
