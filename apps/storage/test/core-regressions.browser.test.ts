import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageErrorInfo } from "../src/errors";
import { Idb } from "../src/idb";
import { Memory } from "../src/memory";
import { proxy, COMMIT } from "../src/proxy";
import { factory } from "../src/core";
import { debug } from "../src/debug";
import { batchFast } from "../src/fast";
import type { AsyncStorage, SyncStore } from "../src/interface";

/** 用微任务 FIFO 串行执行后端操作，读返回发起顺序的快照。 */
function fifo(): AsyncStorage {
  const data = new Memory(); let tail = Promise.resolve();
  /** 操作按发起顺序落盘。 */
  const call = <T>(fn: () => T): Promise<T> => { const result = tail.then(fn); tail = result.then(() => undefined); return result; };
  return { get: k => call(() => data.get(k)), set: (k, v) => call(() => data.set(k, v)), remove: k => call(() => data.remove(k)), clear: () => call(() => data.clear()), keys: () => call(() => data.keys()), key: i => call(() => data.key(i)), length: () => call(() => data.length) };
}
/** 每个用例分配独立真实数据库。 */
const databases = new Set<string>(), handles = new Set<Idb>();
/** 记录真实测试数据库，统一关闭和删除。 */
function database(name: string): Idb { databases.add(name); const handle = new Idb(name); handles.add(handle); return handle; }
const backends = { FIFO: fifo, IDB: () => database("core-" + crypto.randomUUID()) };
afterEach(async () => {
  vi.restoreAllMocks(); await Promise.all([...handles].map(handle => handle.destroy())); handles.clear();
  await Promise.all([...databases].map(name => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("Test database still open"));
  }))); databases.clear();
});

describe.each(Object.entries(backends))("core races %s", (_name, create) => {
  it.each(["renew", "expired", "corrupt"].flatMap(state => ["set", "remove"].map(mutation => [state, mutation])))("B1 %s read then %s guards backend and memo", async (state, mutation) => {
    const store = create(), memo = new Memory();
    const h = proxy(store, memo, { memoized: true, sliding: true, onError: () => {} });
    const now = Date.now();
    const old = state === "corrupt" ? "{}" : JSON.stringify({ value: "old", createdAt: now - 10000, ttl: 10000, expireAt: now + (state === "expired" ? -1 : 5000) });
    await store.set("k", old);
    const read = h.get("k");
    const write = mutation === "set" ? h.set("k", "new") : h.remove("k");
    await Promise.all([read, write]);
    expect((await store.get("k")) === null ? null : JSON.parse((await store.get("k"))!).value).toBe(mutation === "set" ? "new" : null);
    expect(memo.get("k")?.value ?? null).toBe(mutation === "set" ? "new" : null);
    expect(await h.get("k")).toBe(mutation === "set" ? "new" : null);
    await h.destroy();
  });
  it.each(["remove", "clear"] as const)("B2 dispatched set then %s does not refill memo", async (mutation) => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true });
    const original = store.set.bind(store); let reached!: () => void, release!: () => void;
    const dispatched = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    store.set = async (key, value) => { await original(key, value); reached(); await gate; };
    const write = h.set("k", "old"); await dispatched;
    expect(JSON.parse((await store.get("k"))!).value).toBe("old");
    try {
      await (mutation === "remove" ? h.remove("k") : h.clear()); release(); await write;
      expect(await store.get("k")).toBeNull(); expect(memo.get("k")).toBeNull(); expect(await h.get("k")).toBeNull();
    } finally { release(); store.set = original; await h.destroy(); }
  });
  it.each(["keys", "clear", "purge"] as const)("B3 %s keeps its initial keyspace", async (operation) => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { namespace: "a", memoized: true });
    await h.set("k", "A"); h.setNamespace("b"); await h.set("k", "B"); h.setNamespace("a");
    const pending = h[operation](); h.setNamespace("b"); await pending;
    expect(JSON.parse((await store.get("b:k"))!).value).toBe("B");
    expect(await store.get("a:k") === null).toBe(operation === "clear");
    expect(memo.get("a:k")).toBeNull(); expect(await h.get("k")).toBe("B"); expect(memo.get("b:k").value).toBe("B"); await h.destroy();
  });
  it("destroy prevents pending read backfill", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true });
    await store.set("k", '{"value":"v","createdAt":1}'); const read = h.get("k"); const close = h.destroy(); await Promise.all([read, close]);
    expect(memo.get("k")).toBeNull(); expect(JSON.parse((await store.get("k"))!).value).toBe("v");
  });
  it("unrelated key write does not discard pending memo fill", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true });
    await store.set("a", '{"value":1}'); await Promise.all([h.get("a"), h.set("b", 2)]);
    expect(memo.get("a").value).toBe(1); expect(memo.get("b").value).toBe(2); expect(JSON.parse((await store.get("a"))!).value).toBe(1); await h.destroy();
  });
  it("readonly preserves null and concurrent first writer wins", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { readonly: true, memoized: true });
    await Promise.all([h.set("k", null), h.set("k", "second")]);
    expect(JSON.parse((await store.get("k"))!).value).toBeNull(); expect(memo.get("k").value).toBeNull(); expect(await h.get("k")).toBeNull(); await h.destroy();
  });
  it("serialize rejects asynchronously and callback errors preserve identity", async () => {
    const store = create(), memo = new Memory(), error = new Error("serialize");
    const h = proxy(store, memo, { serialize: () => { throw error; } });
    let promise: Promise<void> | undefined; expect(() => { promise = h.set("k", 1); }).not.toThrow(); await expect(promise).rejects.toBe(error);
    expect(await store.get("k")).toBeNull(); expect(memo.get("k")).toBeNull();
    const callback = new Error("callback"), spy = vi.fn((_info: StorageErrorInfo) => { throw callback; });
    const b = proxy(store, memo, { serialize: () => { throw error; }, onError: spy });
    await expect(b.set("k", 1)).rejects.toBe(callback); expect(spy).toHaveBeenCalledTimes(1); expect(spy.mock.calls[0][0].error).toBe(error); await h.destroy();
  });
  it("corrupt/type distinctions preserve backend and memo contract", async () => {
    const store = create(), memo = new Memory(), onError = vi.fn(), h = proxy(store, memo, { memoized: true, onError });
    for (const text of ['{}', '{"foo":1}', '{"value":1,"ttl":"10"}']) {
      await store.set("bad", text); expect(await h.get("bad", 42)).toBe(42); expect(await store.get("bad")).toBeNull(); expect(memo.get("bad")).toBeNull(); expect(onError.mock.lastCall![0].kind).toBe("corrupt");
    }
    await h.set("k", "text"); const before = await store.get("k"); expect(await h.get("k", 0)).toBe(0); expect(onError.mock.lastCall![0].kind).toBe("type"); expect(await store.get("k")).toBe(before); expect(memo.get("k").value).toBe("text"); expect(await h.get("k")).toBe("text");
    await h.destroy();
  });
  it("foreign entity without createdAt never renews", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true, sliding: true });
    const text = JSON.stringify({ value: "v", ttl: 10000, expireAt: Date.now() + 1000 }); await store.set("k", text);
    expect(await h.get("k")).toBe("v"); expect(await store.get("k")).toBe(text); expect(memo.get("k").expireAt).toBe(JSON.parse(text).expireAt); await h.destroy();
  });
  it("successful commits include exact payload and renewal source", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true, sliding: true }), listener = vi.fn();
    const off = h[COMMIT](listener); await h.set("k", "v", 10000); expect(listener.mock.lastCall![0].payload).toBe(await store.get("k")); expect(listener.mock.lastCall![0].renewal).toBe(false);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 2000); await h.get("k");
    expect(listener.mock.lastCall![0].renewal).toBe(true); expect(listener.mock.lastCall![0].expireAt).toBe(memo.get("k").expireAt); expect(listener.mock.lastCall![0].payload).toBe(await store.get("k")); off(); await h.destroy();
  });
});

describe("core memo Hub and safe dictionaries", () => {
  it("same backend factories invalidate each other including nonmemo writer", () => {
    const a = factory({ namespace: "core-hub", memoized: true }), b = factory({ namespace: "core-hub" });
    try { a.ls.set("k", 1); expect(a.ls.get("k")).toBe(1); b.ls.set("k", 2); expect(a.ls.get("k")).toBe(2); b.ls.clear(); expect(a.ls.get("k")).toBeNull(); } finally { void a.destroy(); void b.destroy(); }
  });
  it("storage events distinguish area, empty key, and clear", () => {
    const store = new Memory(), memo = new Memory(); Object.defineProperty(store, "area", { value: localStorage });
    const h = proxy(store, memo, { memoized: true }); h.set("", 1); h.set("k", 2);
    window.dispatchEvent(new StorageEvent("storage", { storageArea: sessionStorage, key: "k" })); expect(memo.get("k").value).toBe(2);
    window.dispatchEvent(new StorageEvent("storage", { storageArea: localStorage, key: "" })); expect(memo.get("")).toBeNull(); expect(memo.get("k").value).toBe(2);
    window.dispatchEvent(new StorageEvent("storage", { storageArea: localStorage, key: null })); expect(memo.length).toBe(0); expect(store.length).toBe(2); h.destroy();
  });
  it("nonmemo instances never register and destroy releases final listener", () => {
    const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
    const plain = proxy(new Memory(), new Memory()); expect(add.mock.calls.filter(c => c[0] === "storage")).toHaveLength(0); plain.destroy();
    const h = proxy(new Memory(), new Memory(), { memoized: true }); h.set("k", 1); h.destroy(); expect(remove.mock.calls.some(c => c[0] === "storage")).toBe(true);
  });
  it("__proto__ stays an own dictionary key", () => {
    const h = proxy(new Memory(), new Memory()); const access = batchFast(h, ["__proto__"]); access.__proto__.set("safe");
    expect(Object.getPrototypeOf(access)).toBeNull(); expect(Object.hasOwn(access, "__proto__")).toBe(true);
    const snapshot = debug(h); expect(Object.hasOwn(snapshot, "__proto__")).toBe(true); expect(snapshot.__proto__).toBe("safe"); expect(Object.getPrototypeOf(snapshot)).toBeNull();
  });
  it("write and abort preserve original backend errors and callback exceptions", async () => {
    for (const name of ["QuotaExceededError", "AbortError"]) {
      const store = fifo(), memo = new Memory(), error = new DOMException("failed", name), onError = vi.fn(); store.set = () => Promise.reject(error);
      const h = proxy(store, memo, { memoized: true, onError, force: false }); await h.set("k", 1);
      expect(onError.mock.calls[0][0].kind).toBe(name === "AbortError" ? "abort" : "write"); expect(onError.mock.calls[0][0].error).toBe(error); expect(await store.get("k")).toBeNull(); expect(memo.get("k")).toBeNull(); await h.destroy();
    }
  });
});

describe.each(Object.entries(backends))("core snapshots %s", (_name, create) => {
  it("debug keeps captured namespace across asynchronous enumeration", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true, namespace: "a" });
    await h.set("k", "A"); h.setNamespace("b"); await h.set("k", "B"); h.setNamespace("a");
    const pending = debug(h); h.setNamespace("b");
    expect(await pending).toEqual({ "a:k": "A" }); expect(memo.get("a:k")).toBeNull(); expect(JSON.parse((await store.get("a:k"))!).value).toBe("A"); expect(JSON.parse((await store.get("b:k"))!).value).toBe("B"); expect(await h.get("k")).toBe("B"); await h.destroy();
  });
  it("undefined envelope is corrupt even when set memoized", async () => {
    const store = create(), memo = new Memory(), onError = vi.fn(), h = proxy(store, memo, { memoized: true, onError });
    await h.set("k", undefined); expect(await h.get("k", "default")).toBe("default"); expect(onError.mock.lastCall![0].kind).toBe("corrupt"); expect(await store.get("k")).toBeNull(); expect(memo.get("k")).toBeNull(); await h.destroy();
  });
});

describe("core native events and atomic update", () => {
  it("same origin iframe write invalidates parent memo", async () => {
    const h = factory({ namespace: "core-iframe", memoized: true }); h.ls.set("k", "old");
    const frame = document.createElement("iframe");
    try {
      const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
      frame.srcdoc = `<script>localStorage.setItem('core-iframe:k',JSON.stringify({value:'new',createdAt:1}));<` + `/script>`;
      document.body.append(frame); await loaded;
      await vi.waitFor(() => expect(h.ls.get("k")).toBe("new")); expect(JSON.parse(localStorage.getItem("core-iframe:k")!).value).toBe("new");
    } finally { frame.remove(); h.ls.clear(); await h.destroy(); }
  });
  it("two independent IDB readonly instances use one atomic winner", async () => {
    const name = "core-atomic-" + crypto.randomUUID(), a = database(name), b = database(name), ma = new Memory(), mb = new Memory();
    const x = proxy(a, ma, { readonly: true, memoized: true }), y = proxy(b, mb, { readonly: true, memoized: true });
    await Promise.all([x.set("k", "A"), y.set("k", "B")]);
    const winner = JSON.parse((await a.get("k"))!).value;
    expect(["A", "B"]).toContain(winner); expect(ma.get("k")?.value ?? mb.get("k")?.value).toBe(winner);
    expect([ma.get("k"), mb.get("k")].filter(Boolean)).toHaveLength(1); expect(await x.get("k")).toBe(winner); expect(await y.get("k")).toBe(winner); await x.destroy(); await y.destroy();
  });
  it("atomic conditional renewal and expiry deletion cannot overwrite another instance", async () => {
    const name = "core-atomic-" + crypto.randomUUID(), a = database(name), b = database(name), memo = new Memory();
    const h = proxy(a, memo, { memoized: true, sliding: true }), other = proxy(b, new Memory());
    for (const expired of [false, true]) {
      const now = Date.now(); await a.set("k", JSON.stringify({ value: "old", createdAt: now - 10000, ttl: 10000, expireAt: now + (expired ? -1 : 5000) }));
      const original = a.update.bind(a); let update: ((value: void) => void) | undefined;
      const reached = new Promise<void>(resolve => { update = resolve; }); let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => { release = resolve; });
      a.update = async (key, fn) => { update!(); await gate; return original(key, fn); };
      const read = h.get("k"); await reached; await other.set("k", "new"); release!(); await read;
      expect(JSON.parse((await a.get("k"))!).value).toBe("new"); expect(memo.get("k")).toBeNull();
      a.update = original;
    }
    await h.destroy(); await other.destroy();
  });
  it("IDB BroadcastChannel invalidation is opt-in and releases on destroy", async () => {
    const name = "core-broadcast-" + crypto.randomUUID(), a = database(name), b = database(name), memo = new Memory();
    const x = proxy(a, memo, { memoized: true, broadcast: true }), y = proxy(b, new Memory(), { broadcast: true });
    try { await x.set("k", 1); await y.set("k", 2); await vi.waitFor(() => expect(memo.get("k")).toBeNull()); expect(await x.get("k")).toBe(2); expect(JSON.parse((await a.get("k"))!).value).toBe(2); } finally { await x.destroy(); await y.destroy(); }
  });
});

describe.each(Object.entries(backends))("core error callbacks %s", (_name, create) => {
  it("corrupt callback throws before deletion and remains the same error", async () => {
    const store = create(), memo = new Memory(), error = new Error("callback"), callback = vi.fn(() => { throw error; });
    const h = proxy(store, memo, { memoized: true, onError: callback }); await store.set("k", "{}");
    await expect(h.get("k")).rejects.toBe(error); expect(await store.get("k")).toBe("{}"); expect(memo.get("k")).toBeNull(); expect(callback).toHaveBeenCalledTimes(1); await h.destroy();
  });
  it("write callback exceptions are never recategorized", async () => {
    const store = create(), memo = new Memory(), error = new Error("backend"), thrown = new Error("callback"), callback = vi.fn((_info: StorageErrorInfo) => { throw thrown; });
    store.set = () => Promise.reject(error); const h = proxy(store, memo, { memoized: true, onError: callback });
    await expect(h.set("k", 1)).rejects.toBe(thrown); expect(callback).toHaveBeenCalledTimes(1); expect(callback.mock.calls[0][0].error).toBe(error); expect(await store.get("k")).toBeNull(); expect(memo.get("k")).toBeNull(); await h.destroy();
  });
  it("completed operations release version and readonly queue maps", async () => {
    const maps = new Set<Map<unknown, unknown>>(), original = Map.prototype.set;
    const spy = vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key, value) {
      if (value && typeof value === "object" && ("_refs" in value || value instanceof Promise)) maps.add(this);
      return original.call(this, key, value);
    });
    const store = create(), memo = new Memory(), h = proxy(store, memo, { readonly: true, memoized: true });
    try {
      for (let i = 0; i < 30; i++) { await h.set("k" + i, i); await h.get("k" + i); await h.remove("k" + i); }
      await Promise.resolve(); expect(maps.size).toBeGreaterThanOrEqual(2); for (const map of maps) expect(map.size).toBe(0); expect(await store.length()).toBe(0); expect(memo.length).toBe(0);
    } finally { spy.mockRestore(); await h.destroy(); }
  });
});

describe("core keyspace compatibility and cache", () => {
  it("scoped clear separates a, a:b and percent namespaces", () => {
    const store = new Memory(), ma = new Memory(), mb = new Memory(), mc = new Memory();
    const a = proxy(store, ma, { namespace: "a", memoized: true }), b = proxy(store, mb, { namespace: "a:b", memoized: true }), c = proxy(store, mc, { namespace: "a%3Ab", memoized: true });
    try {
      a.set("x", "A"); b.set("x", "B"); c.set("x", "C");
      expect(store.keys().toSorted()).toEqual(["a%253Ab:x", "a%3Ab:x", "a:x"].toSorted());
      expect(a.keys()).toEqual(["x"]); expect(b.keys()).toEqual(["x"]); expect(c.keys()).toEqual(["x"]);
      a.clear(); expect(store.get("a:x")).toBeNull(); expect(ma.get("a:x")).toBeNull(); expect(b.get("x")).toBe("B"); expect(c.get("x")).toBe("C"); expect(mb.get("a%3Ab:x").value).toBe("B"); expect(mc.get("a%253Ab:x").value).toBe("C");
    } finally { a.destroy(); b.destroy(); c.destroy(); }
  });
  it("1000 encrypted keys reuse reverse decoding across keys and length", () => {
    const encode = (s: string) => "@" + s, decode = vi.fn((s: string) => s.startsWith("@") ? s.slice(1) : null);
    const store = new Memory(), memo = new Memory(), h = proxy(store, memo, { namespace: "enc", enckey: true, codec: { encode, decode } });
    for (let i = 0; i < 1000; i++) h.set(String(i), i);
    expect(h.keys()).toHaveLength(1000); decode.mockClear(); expect(h.keys()).toHaveLength(1000); expect(h.length).toBe(1000); expect(decode).not.toHaveBeenCalled(); expect(store.length).toBe(1000); expect(memo.length).toBe(0); h.destroy();
  });
});

describe.each(Object.entries(backends))("core overlapping writes %s", (_name, create) => {
  it("read started during pending set cannot overwrite committed memo", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true });
    await store.set("k", '{"value":"old"}');
    const original = store.get.bind(store); let signal: (() => void) | undefined, release: (() => void) | undefined;
    const reached = new Promise<void>(resolve => { signal = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    store.get = async key => { const text = await original(key); signal!(); await gate; return text; };
    const write = h.set("k", "new"), read = h.get("k"); await reached; await write; release!(); await read;
    expect(JSON.parse((await original("k"))!).value).toBe("new"); expect(memo.get("k").value).toBe("new"); store.get = original; expect(await h.get("k")).toBe("new"); await h.destroy();
  });
});

describe("core optional backend keys", () => {
  it.each([false, true])("enumerates backend without keys async=%s", async (async) => {
    const data = new Memory(), memo = new Memory(); data.set("ns:a", '{"value":1}'); data.set("outside", '{"value":2}');
    const store = async ? fifo() : data;
    await store.set("ns:a", '{"value":1}'); await store.set("outside", '{"value":2}');
    const length = async ? (store as AsyncStorage).length.bind(store) : undefined;
    const custom = async ? { ...(store as AsyncStorage), keys: undefined, length: async () => (await length!()) + 1 } : { get: data.get.bind(data), set: data.set.bind(data), remove: data.remove.bind(data), clear: data.clear.bind(data), key: data.key.bind(data), get length() { return data.length + 1; } };
    const h = proxy(custom as SyncStore | AsyncStorage, memo, { namespace: "ns", memoized: true });
    expect(await h.keys()).toEqual(["a"]); expect(await h.length).toBe(1); expect(await h.key(0)).toBe("a"); expect(await h.key(-1)).toBeNull(); expect(await h.key(9)).toBeNull(); expect(await h.key(NaN)).toBe("a");
    await h.clear(); expect(await store.get("ns:a")).toBeNull(); expect(memo.get("ns:a")).toBeNull(); expect(await store.get("outside")).toBe('{"value":2}'); await h.destroy();
  });
  it("sync serializer and corrupt callback errors propagate without retry", () => {
    const store = new Memory(), memo = new Memory(), error = new Error("callback"), callback = vi.fn((_info: StorageErrorInfo) => { throw error; });
    const h = proxy(store, memo, { memoized: true, onError: callback }); store.set("k", "{}");
    expect(() => h.get("k")).toThrow(error); expect(callback).toHaveBeenCalledTimes(1); expect(store.get("k")).toBe("{}"); expect(memo.get("k")).toBeNull(); h.destroy();
    const s = proxy(store, memo, { serialize: () => { throw error; } }); expect(() => s.set("v", 1)).toThrow(error); expect(store.get("v")).toBeNull(); expect(memo.get("v")).toBeNull(); s.destroy();
  });
});

describe("core force retry errors", () => {
  it("cleanup failure reports once and preserves callback thrown identity", () => {
    const store = new Memory(), memo = new Memory(), original = new Error("remove"), callbackError = new Error("callback"); store.set("dead", '{"value":1,"createdAt":0,"expireAt":1}');
    store.set = () => { throw new Error("quota"); }; store.remove = () => { throw original; };
    const onError = vi.fn((_info: StorageErrorInfo) => { throw callbackError; }), h = proxy(store, memo, { onError, force: true, memoized: true });
    expect(() => h.set("k", 1)).toThrow(callbackError); expect(onError).toHaveBeenCalledTimes(1); expect(onError.mock.calls[0][0].error).toBe(original); expect(store.get("k")).toBeNull(); expect(store.get("dead")).not.toBeNull(); expect(memo.length).toBe(0); h.destroy();
  });
});

describe("core quota recovery on the current key", () => {
  it("force cleanup may reclaim the expired value being replaced", () => {
    const store = new Memory(), memo = new Memory(); store.set("k", '{"value":"old","createdAt":0,"expireAt":1}');
    const original = store.set.bind(store); let calls = 0;
    store.set = (key, value) => { if (++calls === 1) throw new DOMException("quota", "QuotaExceededError"); original(key, value); };
    const onError = vi.fn(), h = proxy(store, memo, { force: true, memoized: true, onError }); h.set("k", "new");
    expect(calls).toBe(2); expect(onError).not.toHaveBeenCalled(); expect(JSON.parse(store.get("k")).value).toBe("new"); expect(memo.get("k").value).toBe("new"); h.destroy();
  });
});

describe.each(Object.entries(backends))("core enumeration lifecycle %s", (_name, create) => {
  it("destroy waits for a pending clear enumeration before closing backend", async () => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { memoized: true, namespace: "scope" });
    await h.set("k", "value"); await Promise.all([h.clear(), h.destroy()]); expect(await store.get("scope:k")).toBeNull(); expect(memo.length).toBe(0);
  });
});

describe("core debug legacy compatibility", () => {
  it.each([false, true])("debug skips legacy _$debug without deleting it async=%s", async (async) => {
    const store = async ? fifo() : new Memory(), memo = new Memory(), h = proxy(store, memo, { memoized: true });
    await h.set("_$debug", "legacy"); await h.set("k", "value"); expect(await debug(h)).toEqual({ k: "value" });
    expect(JSON.parse((await store.get("_$debug"))!).value).toBe("legacy"); expect(memo.get("_$debug").value).toBe("legacy"); expect(JSON.parse((await store.get("k"))!).value).toBe("value"); expect(memo.get("k").value).toBe("value"); await h.destroy();
  });
});
