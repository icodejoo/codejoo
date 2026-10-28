import { describe, expect, it } from "vitest";
import { cancelIfAborted, requestContext } from "../../src/context";
import { AXP_KINDS } from "../../src/response";
import type { AxpRequestConfig } from "../../src/types";
import { testContext } from "../helpers/context";

/** 带读取计数的请求体：每次计算指纹都会读到 n，据此数出实际计算次数。 */
function countingData(reads: { /** 累计读取次数。 */ count: number }): Record<string, unknown> {
  return {
    get n() {
      reads.count++;
      return 1;
    },
  };
}
/** 带读取计数请求体的 post 请求。 */
function countingRequest(data: Record<string, unknown>): AxpRequestConfig {
  return { url: "/counted", method: "post", data };
}

describe("cancelIfAborted", /** 取消检查的用例集合。 */ () => {
  it("[core.fn.cancelIfAborted] 未中止返回 undefined，已中止返回 cancel 响应，且只看本层的信号", () => {
    const ctx = testContext();
    expect(cancelIfAborted(ctx)).toBeUndefined();
    const controller = new AbortController();
    const aborted = requestContext(ctx, ctx.request, { signal: controller.signal });
    expect(cancelIfAborted(aborted)).toBeUndefined();
    controller.abort();
    expect(cancelIfAborted(aborted)).toMatchObject({ kind: AXP_KINDS.CANCEL, ok: false });
    expect(cancelIfAborted(ctx)).toBeUndefined();
  });
});

describe("派生上下文的取消信号", /** 补丁换了 signal 时内层以补丁为准。 */ () => {
  it("[core.prop.signal] 补丁带 signal 则内层以它为准，不带或显式 undefined 则沿用外层，根层不受影响", () => {
    const root = testContext({ url: "/a" });
    const own = new AbortController();
    const replaced = requestContext(root, { ...root.request, signal: own.signal }, { signal: own.signal });
    expect(replaced.signal).toBe(own.signal);
    expect(root.signal).not.toBe(own.signal);
    expect(requestContext(root, { ...root.request, url: "/b" }, { url: "/b" }).signal).toBe(root.signal);
    expect(requestContext(root, { ...root.request }, { signal: undefined }).signal).toBe(root.signal);
    // 内层的内层继续沿用已换掉的信号
    expect(requestContext(replaced, { ...replaced.request, url: "/c" }, { url: "/c" }).signal).toBe(own.signal);
  });

  it("[core.prop.signal] 直接替换整个请求视图时，以新视图里的 signal 为准", () => {
    const root = testContext({ url: "/a" });
    const own = new AbortController();
    expect(requestContext(root, { url: "/replaced", signal: own.signal }).signal).toBe(own.signal);
    expect(requestContext(root, { url: "/replaced" }).signal).toBe(root.signal);
  });
});

describe("指纹缓存", /** 指纹随本层请求视图缓存。 */ () => {
  it("[core.method.key] 同一层只算一次；有补丁派生的新层重新计算，旧层缓存不受影响", () => {
    const reads = { count: 0 };
    const root = testContext(countingRequest(countingData(reads)));
    const first = root.key();
    expect(first).not.toBeNull();
    const afterFirst = reads.count;
    expect(afterFirst).toBeGreaterThan(0);
    expect(root.key()).toBe(first);
    expect(reads.count).toBe(afterFirst);
    const derived = requestContext(root, { ...root.request, url: "/other" }, { url: "/other" });
    expect(derived.key()).not.toBe(first);
    expect(reads.count).toBeGreaterThan(afterFirst);
    const afterDerived = reads.count;
    expect(root.key()).toBe(first);
    expect(reads.count).toBe(afterDerived);
  });

  it("[core.method.key] 不可哈希的 null 同样被缓存，不会因为值是 null 而每次重算", () => {
    const reads = { count: 0 };
    const data = countingData(reads);
    data.self = data;
    const ctx = testContext(countingRequest(data));
    expect(ctx.key()).toBeNull();
    const afterFirst = reads.count;
    expect(afterFirst).toBeGreaterThan(0);
    expect(ctx.key()).toBeNull();
    expect(ctx.key()).toBeNull();
    expect(reads.count).toBe(afterFirst);
  });
});
