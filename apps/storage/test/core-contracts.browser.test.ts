import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy, STORE, APPLY, COMMIT, SNAPSHOT } from "../src/proxy";
import { Memory } from "../src/memory";
import { memoHub, register } from "../src/hub";
import type { AsyncStorage } from "../src/interface";

afterEach(() => vi.restoreAllMocks());

/** 提供最小异步后端，便于精确控制在途操作。 */
function backend(): AsyncStorage {
  const data = new Memory();
  return { get: async k => data.get(k), set: async (k, v) => { data.set(k, v); }, remove: async k => { data.remove(k); }, clear: async () => data.clear(), key: async i => data.key(i), keys: async () => data.keys(), length: async () => data.length };
}

describe("core internal contracts", () => {
  it("STORE exposes identity and APPLY preserves payload, expiry and commit silence", () => {
    const store = new Memory(), memo = new Memory(), peerMemo = new Memory();
    const h = proxy(store, memo, { namespace: "a:b", memoized: true }), peer = proxy(store, peerMemo, { namespace: "a:b", memoized: true });
    const listener = vi.fn(); h[COMMIT](listener);
    expect(h[STORE]).toBe(store); h.set("k", "old"); peer.get("k"); listener.mockClear();
    const text = '{ "value": "new", "createdAt": 1 }'; h[APPLY]("k", text);
    expect(store.get("a%3Ab:k")).toBe(text); expect(memo.get("a%3Ab:k")).toBeNull(); expect(peerMemo.get("a%3Ab:k")).toBeNull(); expect(h.get("k")).toBe("new");
    h[APPLY]("k", "expired", Date.now()); expect(store.get("a%3Ab:k")).toBe(text);
    h[APPLY]("k", text, Date.now() + 10000); h[APPLY]("k", null); expect(store.get("a%3Ab:k")).toBeNull(); expect(listener).not.toHaveBeenCalled();
    h.clear(); expect(listener.mock.lastCall![0]).toMatchObject({ op: "clear", key: "", payload: null }); h.destroy(); peer.destroy();
  });
  it("APPLY always invalidates memo after the backend write completes", async () => {
    const store = backend(), memo = new Memory(), h = proxy(store, memo, { memoized: true });
    await h.set("k", "old"); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const set = store.set;
    store.set = async (k, v) => { await gate; await set(k, v); };
    const apply = h[APPLY]("k", '{"value":"remote"}'); store.set = set; await h.set("k", "new"); release(); await apply;
    expect(memo.get("k")).toBeNull(); expect(await h.get("k")).toBe("remote"); await h.destroy();
  });
  it("APPLY uses encrypted keys while bypassing serialization and value encoding", () => {
    const store = new Memory(), memo = new Memory(), serialize = vi.fn(() => { throw new Error("must bypass serialization"); });
    const encode = vi.fn((value: string) => "@" + value), decode = (value: string) => value.slice(1);
    const h = proxy(store, memo, { namespace: "scope", enckey: true, codeable: true, codec: { encode, decode }, readonly: true, serialize });
    const text = '@{ "value": 42 }'; h[APPLY]("key", text);
    expect(store.get("@scope:key")).toBe(text); expect(encode.mock.calls).toEqual([["scope:key"]]); expect(serialize).not.toHaveBeenCalled(); expect(h.get("key")).toBe(42);
    h[APPLY]("key", null); expect(store.get("@scope:key")).toBeNull(); h.destroy();
  });
  it("snapshot reads retain their namespace", () => {
    const h = proxy(new Memory(), new Memory(), { namespace: "a" }); h.set("k", 1); const snapshot = h[SNAPSHOT](); h.setNamespace("b");
    expect(snapshot.keys()).toEqual(["k"]); expect(snapshot.get("k")).toBe(1); h.destroy();
  });
  it("Hub handles absent areas, repeated teardown and malformed broadcasts", () => {
    const receive = vi.fn(), area = {}, off = register(area, receive); window.dispatchEvent(new StorageEvent("storage")); off(); off();
    const channels: { onmessage?: (event: { data: unknown }) => void; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal("BroadcastChannel", class {
      /** 捕获测试通道。 */
      constructor() { channels.push(this); }
      /** 消息处理器。 */
      onmessage?: (event: { data: unknown }) => void;
      /** 记录发送。 */
      postMessage = vi.fn();
      /** 记录关闭。 */
      close = vi.fn();
    });
    try {
      const hub = memoHub(area, receive, "test"); hub.connect(); hub.connect();
      for (const data of [{}, 1, undefined, false]) channels[0].onmessage!({ data }); expect(receive).not.toHaveBeenCalled();
      channels[0].onmessage!({ data: null }); channels[0].onmessage!({ data: "" }); expect(receive.mock.calls).toEqual([[null], [""]]); hub.publish(""); hub.destroy(); hub.destroy();
      hub.publish(null); expect(channels[1].close).not.toHaveBeenCalled(); hub.destroy(); expect(channels[1].close).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("core option combinations", () => {
  it("raw memo, readonly, batch omissions and codec warnings remain consistent", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new Memory(), memo = new Memory(), h = proxy(store, memo, { raw: true, readonly: true, memoized: true });
    h.set("k", "first"); h.set("k", "second"); expect(h.get("k")).toBe("first"); h.purge(); expect(store.get("k")).toBe("first");
    h.set(["a", "b"], undefined as never); expect(h.keys()).toEqual(["k"]); h.destroy();
    vi.mocked(console.warn).mockClear(); const warned = proxy(new Memory(), new Memory(), { enckey: true, codeable: true }); expect(console.warn).toHaveBeenCalledOnce(); expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("codec required")); warned.destroy();
  });
  it("serialization callbacks skip initial writes and failed renewals", () => {
    const store = new Memory(), memo = new Memory(), onError = vi.fn(), error = new Error("serialize");
    let fail = false; const h = proxy(store, memo, { memoized: true, sliding: true, onError, serialize: e => { if (fail) throw error; return JSON.stringify(e); } });
    h.set("k", 1, 10000); const before = store.get("k"); fail = true; h.set("skip", 2);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 2000); expect(h.get("k")).toBe(1); expect(store.get("k")).toBe(before); expect(store.get("skip")).toBeNull(); expect(onError).toHaveBeenCalledTimes(2); h.destroy();
  });
  it("readonly replaces corrupt values and memo accepts externally supplied entities", () => {
    const store = new Memory(), memo = new Memory(), h = proxy(store, memo, { readonly: true, sliding: true });
    store.set("k", "{}"); h.set("k", 1); expect(h.get("k")).toBe(1);
    memo.set("k", { value: 2 }); expect(h.get("k")).toBe(2); h.destroy();
  });
  it("purge tolerates vanished keys and clear enumeration failures release state", () => {
    const store = new Memory(), memo = new Memory(), h = proxy(store, memo, { namespace: "ns" }); store.set("foreign", "keep"); store.keys = () => ["ns:missing"]; const remove = vi.spyOn(store, "remove"); h.purge(); expect(remove).not.toHaveBeenCalled(); expect(store.get("foreign")).toBe("keep");
    const error = new Error("keys"); store.keys = () => { throw error; }; expect(() => h.clear()).toThrow(error); h.destroy();
  });
  it("pending sets reach the backend in invocation order", async () => {
    const store = backend(), write = vi.spyOn(store, "set"), h = proxy(store, new Memory(), { memoized: true });
    const first = h.set("k", 1), second = h.set("k", 2); await Promise.all([first, second]); expect(await h.get("k")).toBe(2); expect(write).toHaveBeenCalledTimes(2); expect(write.mock.calls.map(([, text]) => JSON.parse(text).value)).toEqual([1, 2]);
    await h.destroy();
  });
  it("broadcast custom async backends use the default channel name", async () => {
    const Native = BroadcastChannel, names: string[] = [];
    vi.stubGlobal("BroadcastChannel", class extends Native {
      /** 记录后端缺省通道名。 */
      constructor(name: string) { super(name); names.push(name); }
    });
    try { const h = proxy(backend(), new Memory(), { broadcast: true }); await h.set("k", 1); await h.destroy(); expect(names).toEqual(["@codejoo/storage:memo:default"]); }
    finally { vi.unstubAllGlobals(); }
  });
  it("failed backend deletions preserve corrupt and expired data", () => {
    const store = new Memory(), memo = new Memory(), onError = vi.fn(), h = proxy(store, memo, { onError });
    store.set("bad", "{}"); store.set("old", '{"value":1,"createdAt":0,"expireAt":1}'); store.remove = () => { throw new Error("remove"); };
    expect(h.get("bad")).toBeNull(); expect(h.get("old")).toBeNull(); h.purge(); expect(store.get("bad")).toBe("{}"); expect(store.get("old")).not.toBeNull(); expect(onError).toHaveBeenCalledTimes(4); h.destroy();
  });
});
