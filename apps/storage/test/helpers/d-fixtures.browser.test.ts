import { describe, expect, it } from "vitest";
import { BACKENDS, make } from "../backends";
import { JSONX } from "../../src/index";
import { clock } from "./clock";

describe.each(BACKENDS)("D 共享夹具 %s", (backend) => {
  it("统一 await 读写并清理后端", async () => {
    const { handler, cleanup } = await make(backend);
    try {
      await handler.set("key", { value: 1 });
      expect(await handler.get("key")).toEqual({ value: 1 });
      if (backend === "ls(memory)") expect(localStorage.getItem(`${handler.namespace}key`)).toBeNull();
      expect(await handler.keys()).toEqual(["key"]);
      await handler.remove("key");
      expect(await handler.get("key")).toBeNull();
    } finally {
      await cleanup();
    }
  });
  it("仅 fake Date 时 TTL 精确到期且真实异步完成", async () => {
    const time = clock();
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const fixture = await make(backend);
      cleanup = fixture.cleanup;
      await fixture.handler.set("ttl", "value", 1000);
      time.advance(999);
      expect(await fixture.handler.get("ttl")).toBe("value");
      time.advance(1);
      expect(await fixture.handler.get("ttl")).toBeNull();
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    } finally {
      try {
        await cleanup?.();
      } finally {
        time.restore();
      }
    }
  });
  it("保留父 realm 的 Date/Map/Set 序列化语义", async () => {
    const { handler, cleanup } = await make(backend, { serialize: JSONX.stringify, deserialize: JSONX.parse });
    try {
      const value = { date: new Date(1), map: new Map([["key", 1]]), set: new Set([1]) };
      await handler.set("collections", value);
      expect(await handler.get("collections")).toEqual(value);
    } finally {
      await cleanup();
    }
  });
});

describe("D 夹具资源隔离", () => {
  it("构造选项抛错时仍移除兜底 iframe", async () => {
    const before = document.querySelectorAll("iframe").length;
    const failure = new Error("fixture initialization failed");
    await expect(
      make("ls(memory)", {
        /** 模拟调用方选项 getter 在初始化期间抛错。 */
        get namespace(): string {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(document.querySelectorAll("iframe").length).toBe(before);
  });
  it("随机数据库互不污染且清理后删除真实库", async () => {
    const a = await make("db");
    const b = await make("db");
    try {
      await a.handler.set("key", 1);
      expect(await b.handler.get("key")).toBeNull();
      expect(await a.handler.get("key")).toBe(1);
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
    const names = (await indexedDB.databases()).map((database) => database.name);
    expect(names).not.toContain(a.databaseName);
    expect(names).not.toContain(b.databaseName);
  });
  it("构造兜底后恢复原生 window 属性", async () => {
    const storage = window.localStorage;
    const idb = window.indexedDB;
    const fixture = await make("db(memory)");
    try {
      await fixture.handler.set("key", 1);
      expect((await indexedDB.databases()).map((database) => database.name)).not.toContain(fixture.databaseName);
      expect(window.localStorage).toBe(storage);
      expect(window.indexedDB).toBe(idb);
    } finally {
      await fixture.cleanup();
    }
  });
});
