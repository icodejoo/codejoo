/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import type { AxpResponse } from "../../src/response";
import { expect, it, vi } from "vitest";
import axpFilter from "../../src/plugins/filter";
import type { AxpRequestConfig } from "../../src/types";
import { preparedClient } from "../helpers/prepare";

/** 可保留的非空文本。 */
const NONEMPTY_TEXT = "x";

it("[filter.req.invalid] 非法请求选项按省略，函数绝不求值", /** 删除旧 MaybeFun 解析。 */ async () => {
  const callback = vi.fn(
    /** 旧式动态选项不得调用。 */ () => {
      throw new Error("not called");
    },
  );
  const { api } = preparedClient([axpFilter<AxpResponse>()]);
  for (const filter of [callback, "", " ", NONEMPTY_TEXT, 0, [], { enable: undefined }]) {
    const r = await api.request({
      params: { nil: null },
      filter,
      throws: false,
    } as AxpRequestConfig & { throws: false });
    expect(r.request.params).toEqual({});
  }
  expect(callback).not.toHaveBeenCalled();
  api.dispose();
});
it("[filter.req.body] 非纯对象 params/data 保持身份，无原型字典生成新对象", /** 只处理纯对象。 */ async () => {
  const { api } = preparedClient([axpFilter<AxpResponse>()], {
    transformRequest: /** 不让 axios 序列化特殊数据。 */ (value) => value,
  });
  for (const value of [undefined, null, [], NONEMPTY_TEXT, 0, new FormData(), new Blob([NONEMPTY_TEXT]), new Date(), new URLSearchParams("a=1")]) {
    const r = await api.request({ params: value, data: value, throws: false });
    if (Array.isArray(value)) expect(r.request.params).toEqual(value);
    else expect(r.request.params).toBe(value);
    if (Array.isArray(value)) expect(r.request.data).toEqual(value);
    else expect(r.request.data).toBe(value);
  }
  const source = Object.assign(Object.create(null), { nil: null, n: 0 });
  const r = await api.request({ data: source, throws: false });
  expect(r.request.data).toEqual({ n: 0 });
  expect(source).toEqual({ nil: null, n: 0 });
  api.dispose();
});
it("[filter.cb.error][filter.method.lifecycle][filter.opt.enable] 总开关、重名拒绝、重装、判定异常不触网", /** 判定异常保留原始身份。 */ async () => {
  const bug = new Error("predicate bug");
  const { api, net } = preparedClient([axpFilter<AxpResponse>({ enable: false })]);
  expect(api.inspect()).toEqual([]);
  expect((await api.request({ filter: true, params: { nil: null }, throws: false })).request.params).toEqual({ nil: null });
  api.eject("axp:filter");
  const plugin = axpFilter<AxpResponse>({
    predicate: /** 判定故障。 */ () => {
      throw bug;
    },
  });
  api.use(plugin);
  expect(/** 同名安装。 */ () => api.use(plugin)).toThrow("Duplicate plugin");
  const before = net.totalStarted;
  await expect(api.request({ params: { n: 1 } })).rejects.toBe(bug);
  expect(net.totalStarted).toBe(before);
  expect(api.eject(plugin.name)).toBe(true);
  expect(api.eject(plugin.name)).toBe(false);
  api.use(axpFilter<AxpResponse>());
  expect((await api.request({ params: { nil: null }, throws: false })).request.params).toEqual({});
  api.dispose();
});
