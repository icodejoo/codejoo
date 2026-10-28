/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import { expect, it, vi } from "vitest";
import axpFilter, { type TPredicate } from "../../src/plugins/filter";
import type { AxpResponse } from "../../src/response";
import type { AxpPlugin } from "../../src/types";
import { preparedClient } from "../helpers/prepare";

/** 空字段来源，每个请求都应保持它不变。 */
const SOURCE = Object.freeze({
  empty: " ",
  nil: null,
  absent: undefined,
  nan: NaN,
  zero: 0,
  bool: false,
  nested: { empty: "" },
});
it("[filter.fn.axpFilter][filter.req.filter] 装上即生效，布尔和对象关闭，选项不删除且调用方不可变", /** 默认过滤与关闭。 */ async () => {
  const plugin = axpFilter();
  const { api } = preparedClient([plugin]);
  expect(plugin.name).toBe("axp:filter");
  for (const filter of [undefined, true, false, { enable: false }, null]) {
    const config = Object.freeze({ params: SOURCE, data: SOURCE, filter });
    const r = await api.request({ ...config, throws: false });
    expect(r.request.filter).toEqual(filter);
    expect(r.request.params).toEqual(filter === false || (typeof filter === "object" && filter?.enable === false) ? SOURCE : { zero: 0, bool: false, nested: SOURCE.nested });
    expect(r.request.data).toEqual(r.request.params);
    expect(config.params).toBe(SOURCE);
  }
  expect(api.eject(plugin.name)).toBe(true);
  expect((await api.request({ params: SOURCE, throws: false })).request.params).toEqual(SOURCE);
  api.dispose();
});
it("[filter.req.predicate][filter.req.ignoreKeys][filter.req.ignoreValues] 字段覆盖插件配置，空数组清空豁免", /** 请求覆盖和 nullish 继承。 */ async () => {
  const predicate = vi.fn<TPredicate>(/** 默认把全部字段视为可丢弃。 */ () => true);
  const { api } = preparedClient([axpFilter({ predicate, ignoreKeys: ["keep"], ignoreValues: [NaN] })]);
  const params = { keep: null, nan: NaN, zero: 0 };
  const configs = [
    { filter: {}, expected: { keep: null, nan: NaN } },
    { filter: { predicate: null }, expected: { keep: null, nan: NaN } },
    { filter: { predicate: undefined }, expected: { keep: null, nan: NaN } },
    { filter: { ignoreKeys: [], ignoreValues: [] }, expected: {} },
    {
      filter: {
        predicate: /** 请求级保留所有值。 */ () => false,
        ignoreKeys: [],
        ignoreValues: [],
      },
      expected: params,
    },
  ];
  for (const { filter, expected } of configs) {
    const r = await api.request({ params, filter, throws: false });
    expect(r.request.params).toEqual(expected);
  }
  api.dispose();
});

/** 放在 prepare 之后的观察插件：记录到达 attempt 阶段时是否有补丁被应用。 */
function patchObserver() {
  const seen: { /** 补丁触及的字段，没有补丁为 undefined。 */ touched: ReadonlySet<string> | undefined; /** 到达时的查询参数。 */ params: unknown; /** 到达时的请求体。 */ data: unknown }[] = [];
  const plugin: AxpPlugin<AxpResponse> = {
    name: "patch-observer",
    stage: "attempt",
    async handle(ctx, next) {
      seen.push({ touched: ctx.touchedFields, params: ctx.request.params, data: ctx.request.data });
      return next();
    },
  };
  return { plugin, seen };
}

it("[filter.fn.axpFilter] 没有字段要丢时不打补丁：请求视图原样透传；有字段要丢才重建；自定义谓词不预扫，仍按原路径重建", async () => {
  const { plugin, seen } = patchObserver();
  const { api } = preparedClient([axpFilter(), plugin]);
  const clean = { id: 0, ok: false, name: "x", nested: { empty: "" } };
  await api.request({ params: clean, data: clean, throws: false });
  expect(seen[0].touched).toBeUndefined();
  expect(seen[0].params).toEqual(clean);
  expect(seen[0].data).toEqual(clean);
  // 只有 data 有可丢字段：补丁生效，params 内容不变
  await api.request({ params: clean, data: { ...clean, empty: " " }, throws: false });
  expect(seen[1].touched?.has("data")).toBe(true);
  expect(seen[1].data).toEqual(clean);
  expect(seen[1].params).toEqual(clean);
  // 只有 params 有可丢字段
  await api.request({ params: { ...clean, nil: null }, data: clean, throws: false });
  expect(seen[2].touched?.has("params")).toBe(true);
  expect(seen[2].params).toEqual(clean);
  // 请求级关闭或没有可过滤的纯对象时同样不打补丁
  await api.request({ params: { empty: "" }, filter: false, throws: false });
  expect(seen[3].touched).toBeUndefined();
  await api.request({ params: new URLSearchParams("a="), throws: false });
  expect(seen[4].touched).toBeUndefined();
  api.dispose();
  // 豁免键与豁免值命中的空字段不算要丢
  const exempt = patchObserver();
  const exemptClient = preparedClient([axpFilter({ ignoreKeys: ["keep"], ignoreValues: [NaN] }), exempt.plugin]);
  await exemptClient.api.request({ params: { keep: null, nan: NaN, id: 0 }, throws: false });
  expect(exempt.seen[0].touched).toBeUndefined();
  exemptClient.api.dispose();
  // 自定义谓词可能有副作用，不预扫：即使什么都不丢也走原来的重建路径
  const custom = patchObserver();
  const customClient = preparedClient([axpFilter({ predicate: () => false }), custom.plugin]);
  await customClient.api.request({ params: clean, throws: false });
  expect(custom.seen[0].touched?.has("params")).toBe(true);
  customClient.api.dispose();
});

it("[filter.fn.axpFilter] 自定义谓词每个字段只被调用一次，预扫不会让它重复求值", async () => {
  const predicate = vi.fn<TPredicate>(([, value]) => value === "");
  const { api } = preparedClient([axpFilter({ predicate })]);
  const response = await api.request({ params: { a: 1, b: "", c: 2 }, throws: false });
  expect(response.request.params).toEqual({ a: 1, c: 2 });
  expect(predicate).toHaveBeenCalledTimes(3);
  api.dispose();
});
