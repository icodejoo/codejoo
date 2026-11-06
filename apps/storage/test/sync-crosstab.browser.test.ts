import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crossTab } from "../src/sync";
import { COMMIT, proxy, STORE } from "../src/proxy";
import { codec } from "../src/codec";
import { Memory } from "../src/memory";
import { factory } from "../src/core";
import { supported } from "../src/helper";
import type { BaseStorageOptions } from "../src/interface";

/** 独立通道端点；同步投递以确定性验证乱序和广播回环。 */
class Channel {
  /** 当前打开的端点。 */
  static all: Channel[] = [];
  /** 注入广播异常。 */
  static fail = false;
  /** 接收回调。 */
  onmessage: ((event: { data: unknown }) => void) | null = null;
  /** 最后一次广播。 */
  last: any;
  /** 通道名称。 */
  readonly name: string;
  /** 打开命名通道。 */
  constructor(name: string) {
    this.name = name;
    Channel.all.push(this);
  }
  /** 模拟结构化克隆与跨端点投递。 */
  postMessage(data: unknown): void {
    if (Channel.fail) throw new DOMException("not cloneable", "DataCloneError");
    this.last = structuredClone(data);
    for (const peer of Channel.all) if (peer !== this && peer.name === this.name) peer.onmessage?.({ data: structuredClone(data) });
  }
  /** 关闭端点。 */
  close(): void {
    Channel.all = Channel.all.filter((peer) => peer !== this);
  }
}
/** 所有挂载均在用例结束时停止。 */
const stops: (() => void)[] = [];
/** 建立两个独立内存后端，等价于两个标签。 */
function tab(opts?: BaseStorageOptions, name = "sync-v2") {
  const store = new Memory("local"),
    memo = new Memory(),
    h = proxy(store, memo, opts);
  stops.push(crossTab(h, name));
  return { h, store, memo, bc: Channel.all.at(-1)! };
}
/** 构造外部 v2 提交。 */
const message = (patch: object = {}) => ({ v: 2, op: "set", ns: "", key: "k", payload: JSON.stringify({ value: "remote", createdAt: 1 }), ts: Date.now() + 10000, from: "remote", ...patch });
/** 投递任意消息，包括不可克隆的恶意对象。 */
const receive = (bc: Channel, data: unknown) => bc.onmessage!({ data });
beforeEach(() => {
  Channel.all = [];
  Channel.fail = false;
  vi.stubGlobal("BroadcastChannel", Channel);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("crossTab v2", () => {
  it("按实际后端启用，原生 local、idb、无 BroadcastChannel 均 no-op", () => {
    const { ls } = factory();
    crossTab(ls)();
    crossTab(proxy(new Memory(), new Memory()))();
    vi.stubGlobal("BroadcastChannel", undefined);
    crossTab(proxy(new Memory("local"), new Memory()))();
    expect(Channel.all).toHaveLength(0);
  });
  it("session 原生与内存均拒绝同步，每个 handler 只警告一次", () => {
    const { ss } = factory();
    crossTab(ss)();
    crossTab(ss)();
    const memory = proxy(new Memory("session"), new Memory());
    crossTab(memory)();
    crossTab(memory)();
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(Channel.all).toHaveLength(0);
  });
  it("set/batch/remove/clear 同步落盘串并清除接收端旧 memo", () => {
    const a = tab(),
      b = tab({ memoized: true });
    b.h.set("k", "cached");
    a.h.set("k", "new", { ttl: 10000 });
    expect(b.h.get("k")).toBe("new");
    expect(b.store.get("k")).toBe(a.store.get("k"));
    expect(a.bc.last).toMatchObject({ v: 2, op: "set", key: "k", ns: "", expireAt: expect.any(Number), from: expect.any(String), ts: expect.any(Number) });
    a.h.set(["a", "b"], [1, 2]);
    expect(b.h.get(["a", "b"])).toEqual([1, 2]);
    a.h.remove(["a", "b"]);
    expect(b.h.get(["a", "b"])).toEqual([null, null]);
    a.h.clear();
    expect(b.h.keys()).toEqual([]);
  });
  it("加密键和自定义 codec 直写，raw 空串有效且不二次提交", () => {
    const opts = { codeable: true, enckey: true, codec: codec("pw"), memoized: true, namespace: "encrypted" };
    const a = tab(opts),
      b = tab(opts);
    let commits = 0;
    b.h[COMMIT](() => {
      commits++;
    });
    a.h.set("k", { n: 1 });
    expect(b.h.get("k")).toEqual({ n: 1 });
    expect(b.store.keys()).toEqual(a.store.keys());
    expect(commits).toBe(0);
    a.h.remove("k");
    expect(b.h.get("k")).toBeNull();
    const c = tab({ raw: true }, "raw"),
      d = tab({ raw: true }, "raw");
    c.h.set("", "");
    expect(d.h.get("")).toBe("");
    receive(d.bc, message({ op: "clear", payload: "must not set" }));
    expect(d.h.keys()).toEqual([]);
  });
  it("sliding 真实续期也广播，绝对到期时间保持不变", () => {
    vi.spyOn(Date, "now").mockReturnValue(10000);
    const a = tab({ sliding: true }),
      b = tab();
    a.h.set("k", "v", 1000);
    vi.mocked(Date.now).mockReturnValue(10200);
    a.h.get("k");
    expect(a.bc.last.expireAt).toBe(11200);
    expect(b.store.get("k")).toBe(a.store.get("k"));
  });
  it("LWW 拒绝乱序和重复消息，相同 ts 按 from 排序", () => {
    const { h, bc } = tab();
    const ts = Date.now() + 100;
    receive(bc, message({ ts, from: "b" }));
    receive(bc, message({ ts, from: "a", op: "remove" }));
    receive(bc, message({ ts: ts - 1, op: "remove" }));
    expect(h.get("k")).toBe("remote");
    receive(bc, message({ ts, from: "c", op: "remove", payload: undefined }));
    expect(h.get("k")).toBeNull();
    receive(bc, message({ ts, from: "b" }));
    expect(h.get("k")).toBeNull();
  });
  it("clear 屏障防复活并保留较新的键，空 clear 也建立屏障", () => {
    const { h, bc } = tab();
    const ts = Date.now() + 100;
    receive(bc, message({ ts: ts + 2, key: "new" }));
    receive(bc, message({ ts, key: "old" }));
    receive(bc, message({ ts: ts + 1, op: "clear", key: undefined, payload: undefined }));
    expect(h.keys()).toEqual(["new"]);
    receive(bc, message({ ts, key: "revived" }));
    receive(bc, message({ ts, op: "clear" }));
    expect(h.keys()).toEqual(["new"]);
    receive(bc, message({ ts: ts + 3, op: "clear" }));
    receive(bc, message({ ts: ts + 2, key: "new" }));
    expect(h.keys()).toEqual([]);
  });
  it("过期 SET 按带戳 REMOVE 回放，永不重建 TTL", () => {
    const { h, bc, store } = tab();
    receive(bc, message({ expireAt: Date.now() }));
    expect(store.length).toBe(0);
    expect(h.get("k")).toBeNull();
    receive(bc, message({ expireAt: Date.now() - 1 }));
    expect(store.length).toBe(0);
  });
  it("畸形、v1、未知操作和回声消息全部忽略", () => {
    const { h, bc } = tab();
    h.set("own", 1);
    const invalid = [
      null,
      [],
      ["clear", ""],
      {},
      message({ v: 1 }),
      message({ op: "oops" }),
      message({ ns: "foreign:" }),
      message({ from: 1 }),
      message({ from: "" }),
      message({ from: bc.last.from }),
      message({ ts: NaN }),
      message({ key: [] }),
      message({ key: undefined }),
      message({ payload: {} }),
      message({ payload: undefined }),
      message({ expireAt: "no" }),
      {
        get v() {
          throw new Error("bad getter");
        },
      },
    ];
    invalid.forEach((data) => receive(bc, data));
    expect(h.keys()).toEqual(["own"]);
  });
  it("clear 忽略无关 key 与 payload 字段", () => {
    const { h, bc } = tab(); h.set("own", 1);
    receive(bc, message({ op: "clear", key: 1, payload: {} })); expect(h.keys()).toEqual([]);
  });
  it("接收端后端异常被捕获，后续消息仍可处理", () => {
    const { store, bc, h } = tab();
    vi.spyOn(store, "set").mockImplementationOnce(() => {
      throw new Error("backend");
    });
    receive(bc, message());
    receive(bc, message({ ts: Date.now() + 20000 }));
    expect(h.get("k")).toBe("remote");
  });
  it("namespace 隔离，切换后独立维护版本", () => {
    const a = tab({ namespace: "a:%" }),
      b = tab({ namespace: "b" });
    a.h.set("k", 1);
    expect(b.h.get("k")).toBeNull();
    b.h.setNamespace("a:%");
    a.h.set("k", 2);
    expect(b.h.get("k")).toBe(2);
    a.h.clear();
    expect(b.h.get("k")).toBeNull();
    b.h.setNamespace("b");
    b.h.set("keep", 1);
    a.h.clear();
    expect(b.h.get("keep")).toBe(1);
  });
  it("重复挂载 no-op，stop 幂等，方法引用不变且可重新挂载", () => {
    const a = tab();
    const set = a.h.set,
      remove = a.h.remove,
      clear = a.h.clear;
    const duplicate = crossTab(a.h);
    duplicate();
    expect(Channel.all).toHaveLength(1);
    stops[0]();
    stops[0]();
    a.h.set("stopped", 1);
    expect(Channel.all).toHaveLength(0);
    const again = crossTab(a.h);
    stops.push(again);
    stops[0]();
    a.h.set("k", 2);
    expect(Channel.all[0].last.key).toBe("k");
    expect([a.h.set, a.h.remove, a.h.clear]).toEqual([set, remove, clear]);
  });
  it("冲突告警保留所有 owners，最后停止后释放通道", () => {
    tab();
    tab();
    stops[1]();
    tab();
    expect(console.warn).toHaveBeenCalledTimes(2);
    stops.splice(0).forEach((stop) => stop());
    tab();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
  it("广播克隆失败只警告，本地提交保持成功", () => {
    const { h } = tab();
    Channel.fail = true;
    expect(() => h.set("k", 1)).not.toThrow();
    expect(h.get("k")).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
  it("未提交的写入不会广播，订阅停止后不再广播", () => {
    const { h, store, bc } = tab({ force: false, onError: () => {} });
    vi.spyOn(store, "set").mockImplementationOnce(() => {
      throw new Error("write");
    });
    h.set("k", 1);
    expect(bc.last).toBeUndefined();
    stops[0]();
    h.set("k", 2);
    expect(bc.last).toBeUndefined();
    expect(h[STORE]).toBe(store);
    expect(h[COMMIT]).toBeTypeOf("function");
  });
  it("不依赖全局 supported.storage 开关", () => {
    const original = supported.storage;
    supported.storage = true;
    try {
      const a = tab(),
        b = tab();
      a.h.set("k", 1);
      expect(b.h.get("k")).toBe(1);
    } finally {
      supported.storage = original;
    }
  });
});
