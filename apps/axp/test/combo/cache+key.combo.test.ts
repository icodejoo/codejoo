import { beforeEach, expect, it, vi } from "vitest";
import type { IKeyOptions } from "../../src/key";
import axpCache from "../../src/plugins/cache";
import { envelope, sourceClient } from "../helpers/source";

/** 有效期与时序统一用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 被缓存的接口。 */
const URL = "/pets";

/** 装好 cache（GET 与 POST 都缓存），可传 key 服务配置。 */
function client(key?: IKeyOptions) {
  const h = sourceClient([axpCache({ methods: ["get", "post"] })], { key });
  h.net.on("get", URL, (_config, hit) => envelope(`get-${hit}`));
  h.net.on("post", URL, (_config, hit) => envelope(`post-${hit}`));
  return h;
}
/** 发出一个请求并推进假时钟直到落定。 */
async function call(h: ReturnType<typeof client>, config: Record<string, unknown>) {
  const pending = h.send({ url: URL, cache: true, ...config });
  await vi.runAllTimersAsync();
  return pending;
}

it("[core.req.key × cache.req.cache] 不写 key 也自动计算：相同 method、url、params 命中，参数顺序无关，参数不同不串缓存", async () => {
  const h = client();
  const first = await call(h, { params: { a: 1, b: 2 } });
  const reordered = await call(h, { params: { b: 2, a: 1 } });
  const different = await call(h, { params: { a: 1, b: 3 } });
  expect(reordered).toBe(first);
  expect(different).not.toBe(first);
  expect(h.net.calls("get", URL)).toBe(2);
});

it("[core.req.key × cache.opt.methods] 有请求体的方法把 data 并入 key：对象与字符串请求体各自分区，键序无关", async () => {
  const h = client();
  const a = await call(h, { method: "post", data: { x: 1, y: 2 } });
  const reordered = await call(h, { method: "post", data: { y: 2, x: 1 } });
  const other = await call(h, { method: "post", data: { x: 1, y: 3 } });
  const textA = await call(h, { method: "post", data: "alpha" });
  const textB = await call(h, { method: "post", data: "beta" });
  const textAgain = await call(h, { method: "post", data: "alpha" });
  expect(reordered).toBe(a);
  expect(other).not.toBe(a);
  expect(textB).not.toBe(textA);
  expect(textAgain).toBe(textA);
  expect(h.net.calls("post", URL)).toBe(4);
});

it("[core.req.key × cache.req.cache] 不可哈希的请求体（无自有可枚举属性的类实例）得不到 key：绕过缓存，宁可不命中也不误命中", async () => {
  class Opaque {
    /** 只有原型方法，实例没有任何自有可枚举属性。 */
    describe() {
      return "opaque";
    }
  }
  const h = client();
  await call(h, { method: "post", data: new Opaque() });
  await call(h, { method: "post", data: new Opaque() });
  expect(h.net.calls("post", URL)).toBe(2);
});

it("[core.opt.key × cache.req.cache] key 服务的 scope 并入每个缓存键：切换账号后不会读到上一个账号的缓存", async () => {
  let account = "alice";
  const h = client({ scope: () => account });
  const alice = await call(h, {});
  expect(await call(h, {})).toBe(alice);
  account = "bob";
  const bob = await call(h, {});
  expect(bob).not.toBe(alice);
  account = "alice";
  expect(await call(h, {})).toBe(alice);
  expect(h.net.calls("get", URL)).toBe(2);
});
