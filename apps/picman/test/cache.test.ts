import { describe, expect, it } from "vitest";
import { PicmanCache } from "../src/sw/cache";

/** 极简内存 CacheStorage mock — 只实现用到的 open/put/match/delete/keys */
function memCaches(failPuts = 0): CacheStorage {
  const store = new Map<string, Response>();
  let fails = failPuts;
  const cache = {
    async put(req: Request | string, resp: Response) {
      if (fails > 0) {
        fails--;
        throw new DOMException("quota", "QuotaExceededError");
      }
      store.set(typeof req === "string" ? req : req.url, resp);
    },
    async match(req: Request | string) {
      return store.get(typeof req === "string" ? req : (req as Request).url);
    },
    async delete(req: Request | string) {
      return store.delete(typeof req === "string" ? req : (req as Request).url);
    },
    async keys() {
      return [...store.keys()].map((u) => new Request(u));
    },
  };
  return { open: async () => cache as unknown as Cache } as unknown as CacheStorage;
}

const opts = { name: "t", maxEntries: 2, maxAgeSeconds: 100 };
const URL1 = "https://a.com/1.gif";
const URL2 = "https://a.com/2.gif";
const URL3 = "https://a.com/3.gif";

describe("PicmanCache", () => {
  it("put 后 match 命中,key 与二次请求 URL 一致", async () => {
    const c = new PicmanCache(opts, memCaches(), () => 1000);
    expect(await c.putStage(URL1, "1", new Response("full"))).toBe(true);
    const hit = await c.matchStage(URL1, "1");
    expect(hit).toBeDefined();
    expect(await hit!.text()).toBe("full");
  });
  it("超 maxEntries 驱逐最旧,ff 成对删", async () => {
    let t = 0;
    const c = new PicmanCache(opts, memCaches(), () => ++t);
    await c.putStage(URL1, "ff", new Response("f1"));
    await c.putStage(URL1, "1", new Response("1"));
    await c.putStage(URL2, "1", new Response("2"));
    await c.putStage(URL3, "1", new Response("3")); // 挤掉 URL1
    expect(await c.matchStage(URL1, "1")).toBeUndefined();
    expect(await c.matchStage(URL1, "ff")).toBeUndefined();
    expect(await c.matchStage(URL3, "1")).toBeDefined();
  });
  it("过期条目 match 不命中", async () => {
    let now = 1000;
    const c = new PicmanCache(opts, memCaches(), () => now);
    await c.putStage(URL1, "1", new Response("x"));
    now += 101 * 1000;
    expect(await c.matchStage(URL1, "1")).toBeUndefined();
  });
  it("put 持续失败返回 false 不抛", async () => {
    const c = new PicmanCache(opts, memCaches(99), () => 1);
    expect(await c.putStage(URL1, "1", new Response("x"))).toBe(false);
  });
});
