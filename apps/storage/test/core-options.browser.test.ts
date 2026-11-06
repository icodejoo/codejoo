import { afterEach, describe, expect, it, vi } from "vitest";
import { Memory } from "../src/memory";
import { proxy, COMMIT } from "../src/proxy";
import { fast, lazy } from "../src/fast";
import type { AsyncStorage } from "../src/interface";

afterEach(() => vi.restoreAllMocks());

/** 用独立内存提供异步后端，覆盖同步异常归一和批量接口。 */
function backend(): AsyncStorage {
  const data = new Memory();
  return { get: async k => data.get(k), set: async (k, v) => { data.set(k, v); }, remove: async k => { data.remove(k); }, clear: async () => data.clear(), key: async i => data.key(i), keys: async () => data.keys(), length: async () => data.length };
}

describe.each([false, true])("core batch and options async=%s", async => {
  it("batch defaults align with keys and removal reports logical commit keys", async () => {
    const h = proxy(async ? backend() : new Memory(), new Memory(), { namespace: "ns" });
    const listener = vi.fn(), stop = h[COMMIT](listener);
    await h.set(["a", "b"], [1, 2]);
    expect(await h.get(["a", "b", "missing"], [0, 0, false])).toEqual([1, 2, false]);
    expect(await h.get(["a", "absent"])).toEqual([1, null]);
    await h.remove(["a", "b"]); expect(await h.keys()).toEqual([]);
    expect(listener.mock.lastCall![0]).toMatchObject({ op: "remove", key: "b", namespace: "ns:", payload: null });
    stop(); await h.set("silent", 3); expect(listener).toHaveBeenCalledTimes(4);
    await h.destroy();
  });
  it("raw validation, invalid expiry and cloned objects preserve storage", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = async ? backend() : new Memory(), h = proxy(store, new Memory(), { cloned: true, memoized: true });
    await h.set("object", { n: 1 }); const value = await h.get<{ n: number }>("object"); value!.n = 2;
    expect(await h.get("object")).toEqual({ n: 1 }); await h.set("null", null); expect(await h.get("null")).toBeNull();
    await h.set("scalar", 1); expect(await h.get("scalar")).toBe(1);
    await h.set("expired", 1, { expireAt: 0 }); expect(await store.get("expired")).toBeNull(); await h.destroy();
    const raw = proxy(store, new Memory(), { raw: true }); await raw.set("raw", 42); expect(await store.get("raw")).toBeNull();
    await raw.set("raw", "plain"); expect(await raw.get("raw")).toBe("plain"); expect(warn).toHaveBeenCalledTimes(2); await raw.destroy();
  });
  it("key and value codecs round trip across namespace changes", async () => {
    const codec = { encode: (s: string) => "@" + s, decode: (s: string) => s.slice(1) };
    const h = proxy(async ? backend() : new Memory(), new Memory(), { codeable: true, enckey: true, codec });
    await h.set("k", 1); expect(await h.get("k")).toBe(1); h.setNamespace("next"); expect(h.namespace).toBe("next:");
    await h.set("k", 2); expect(await h.keys()).toEqual(["k"]); expect(await h.get("k")).toBe(2); await h.destroy();
  });
});

it("core async synchronous backend errors become rejected promises", async () => {
  const store = backend(), error = new Error("read"); store.get = () => { throw error; };
  const h = proxy(store, new Memory()); await expect(h.get("k")).rejects.toBe(error); await h.destroy();
});

it("core fast and lazy share accessors and forward write options", () => {
  const h = proxy(new Memory(), new Memory()), get = lazy<number>(h, "k");
  expect(get()).toBe(get()); const access = fast<number>(h, "k"); access.set(1, { memoized: true });
  expect(get().get(0)).toBe(1); get().remove(); expect(access.get()).toBeNull(); h.destroy();
});

it("core force false reports the original failure without retry", () => {
  const store = new Memory(), error = new Error("quota"), onError = vi.fn();
  store.set = vi.fn(() => { throw error; }); const h = proxy(store, new Memory(), { force: false, onError });
  h.set("k", 1); expect(store.set).toHaveBeenCalledOnce(); expect(onError.mock.lastCall![0]).toMatchObject({ kind: "write", error }); h.destroy();
});
