import { expect, it } from "vitest";
import axpCache from "../../src/plugins/cache";
import axpFilter from "../../src/plugins/filter";
import axpRepath from "../../src/plugins/repath";
import type { AxpResponse } from "../../src/response";
import { envelope, sourceClient } from "../helpers/source";

/** 带路径变量的接口。 */
const URL = "/pet/{id}";

/** 按 repath → filter → cache 装配；路由按路径返回命中序号。 */
function client() {
  const h = sourceClient([axpCache<AxpResponse>(), axpFilter<AxpResponse>(), axpRepath<AxpResponse>()]);
  h.net.on("get", "/pet/1", (_config, hit) => envelope(`one-${hit}`));
  h.net.on("get", "/pet/2", (_config, hit) => envelope(`two-${hit}`));
  return h;
}

it("[repath.fn.axpRepath × filter.fn.axpFilter × cache.req.cache] prepare 先整形再算 key：空字段被剥离后 key 相同，路径变量不同则不串缓存", async () => {
  const h = client();
  const plain = await h.send({ url: URL, params: { id: 1 }, cache: true });
  const withEmpty = await h.send({ url: URL, params: { id: 1, q: "", tag: null }, cache: true });
  const other = await h.send({ url: URL, params: { id: 2 }, cache: true });
  expect(withEmpty).toBe(plain);
  expect(other.data).toBe("two-1");
  expect(h.net.calls("get", "/pet/1")).toBe(1);
  expect(h.net.calls("get", "/pet/2")).toBe(1);
});
