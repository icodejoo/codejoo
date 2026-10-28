/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import { expect, it, vi } from "vitest";
import axpFilter, { type TPredicate } from "../../src/plugins/filter";
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
