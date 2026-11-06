// B1/B2/B3/B4/B5 主矩阵保留于 core-regressions；此处只补 purge 及旧读与 clear 的交错。
import { describe, expect, it } from "vitest";
import { Memory } from "../src/memory";
import { proxy, type Handlers } from "../src/proxy";
import type { AsyncStorage } from "../src/index";
import { make } from "./helpers/matrix";
import { backing } from "./helpers/matrix";
import { clock } from "./helpers/clock";
import { fifo } from "./helpers/fifo";

/** 复用真实 IDB 夹具，FIFO 只替换后端原语。 */
async function raceFixture(backend: "IDB" | "FIFO") {
  const f = backend === "IDB" ? await make("db", { memoized: true, sliding: true, onError: () => {} }) : undefined;
  const store = f ? (backing(f.handler) as AsyncStorage) : fifo();
  const handler = f ? (f.handler as Handlers<AsyncStorage>) : proxy(store, new Memory(), { memoized: true, sliding: true, onError: () => {} });
  return {
    store,
    handler,
    /** 关闭原语后删除随机测试库。 */
    async cleanup() {
      if (f) await f.cleanup();
      else await handler.destroy();
    },
  };
}

describe.each(["IDB", "FIFO"] as const)("Additional race invariant %s", (backend) => {
  it.each(["set", "remove"] as const)("B1 delayed purge cannot overwrite a newer %s", async (mutation) => {
    const time = clock(),
      f = await raceFixture(backend),
      key = f.handler.namespace + "k";
    const get = f.store.get.bind(f.store);
    let reached!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => {
        reached = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    try {
      await f.handler.set("k", "old", 10);
      time.advance(10);
      f.store.get = async (k) => {
        const result = await get(k);
        reached();
        await gate;
        return result;
      };
      const purge = f.handler.purge();
      await reading;
      if (mutation === "set") await f.handler.set("k", "new");
      else await f.handler.remove("k");
      release();
      await purge;
      f.store.get = get;
      expect(await f.handler.get("k")).toBe(mutation === "set" ? "new" : null);
      expect((await get(key)) === null).toBe(mutation === "remove");
    } finally {
      release();
      f.store.get = get;
      await f.cleanup();
      time.restore();
    }
  });

  it.each(["renew", "expired", "corrupt"] as const)("B1 pending %s read cannot recreate data after clear", async (state) => {
    const time = clock(),
      f = await raceFixture(backend),
      key = f.handler.namespace + "k";
    try {
      await f.store.set(key, state === "corrupt" ? "{}" : JSON.stringify({ value: "old", createdAt: Date.now() - 1000, ttl: 1000, expireAt: Date.now() + (state === "expired" ? -1 : 500) }));
      await Promise.all([f.handler.get("k"), f.handler.clear()]);
      expect(await f.store.get(key)).toBeNull();
      expect(await f.handler.get("k")).toBeNull();
      expect(await f.handler.length).toBe(0);
    } finally {
      await f.cleanup();
      time.restore();
    }
  });
  it("F2 clear before get cannot return the old token", async () => {
    const f = await raceFixture(backend);
    try {
      await f.handler.set("token", "old");
      const clear = f.handler.clear(), read = f.handler.get("token", "default");
      await clear; expect(await read).toBe("default"); expect(await f.handler.keys()).toEqual([]);
    } finally { await f.cleanup(); }
  });

});
