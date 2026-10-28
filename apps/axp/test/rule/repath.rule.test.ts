/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import { expect, it } from "vitest";
import axpRepath from "../../src/plugins/repath";
import { preparedClient } from "../helpers/prepare";

/** 优先使用的查询参数值。 */
const PARAMS_VALUE = "from params";
/** 花括号变量值。 */
const X_VALUE = "X";
/** 方括号变量值。 */
const Y_VALUE = "Y";
/** 内置路径插件名。 */
const NAME = "axp:repath";
/** 未消费的请求体字段。 */
const UNUSED_VALUE = "unused";
/** 查询参数为空时的请求体回退值。 */
const DATA_VALUE = "data";
/** 仅在请求体中存在的末段值。 */
const LAST_VALUE = "last";
/** 插件关闭时保留的模板。 */
const VARIABLE_PATH = "/:id";
/** 自定义匹配模式的模板。 */
const CUSTOM_PATH = "/$id";

/** 路径测试的变量字典。 */
const PARAMS = Object.freeze({ id: PARAMS_VALUE, x: X_VALUE, y: Y_VALUE, pid: 2 });
it.each(["/u/{id}", "/u/[id]", "/u/:id", "/users/:id/posts/:pid", "/mix/:id/{x}/[y]"])(
  "[repath.fn.axpRepath] 三种占位符和多段路径 %s",
  /** 各种路径风格。 */ async (url) => {
    const plugin = axpRepath();
    const { api } = preparedClient([plugin]);
    const r = await api.request({ url, params: PARAMS, throws: false });
    expect(r.request.url).toBe(
      url
        .replace(/{id}|\[id\]|:id/g, "from%20params")
        .replace(":pid", "2")
        .replace("{x}", X_VALUE)
        .replace("[y]", Y_VALUE),
    );
    expect(r.request.params.id).toBeUndefined();
    expect(PARAMS.id).toBe(PARAMS_VALUE);
    expect(plugin.name).toBe(NAME);
    api.dispose();
  },
);
it("[repath.opt.removeKey][repath.req.repath] params 优先、空值回退 data、请求关闭和保留来源字段", /** 替换来源与消费规则。 */ async () => {
  const { api } = preparedClient([axpRepath()]);
  const params = Object.freeze({ id: 0, x: undefined, y: null });
  const data = Object.freeze({ id: UNUSED_VALUE, x: false, y: DATA_VALUE, z: LAST_VALUE });
  const url = "/:id/{x}/[y]/:z";
  for (const repath of [undefined, false, { removeKey: false }]) {
    const r = await api.request({ url, params, data, repath, throws: false });
    expect(r.request.url).toBe(repath === false ? url : "/0/false/data/last");
    expect(r.request.params).toEqual(repath !== undefined ? params : {});
    expect(r.request.data).toEqual(repath !== undefined ? data : { id: UNUSED_VALUE });
  }
  expect(params).toEqual({ id: 0, x: undefined, y: null });
  expect(data).toEqual({ id: UNUSED_VALUE, x: false, y: DATA_VALUE, z: LAST_VALUE });
  api.dispose();
});
it("[repath.opt.pattern][repath.method.lifecycle] 自定义模式、插件关闭、卸载重装", /** 新安装契约。 */ async () => {
  const { api } = preparedClient([axpRepath({ enable: false })]);
  expect(api.inspect()).toEqual([]);
  expect((await api.request({ url: VARIABLE_PATH, params: { id: 1 }, repath: true, throws: false })).request.url).toBe(VARIABLE_PATH);
  api.eject(NAME);
  const plugin = axpRepath({ pattern: /\$([a-z]+)/g });
  api.use(plugin);
  expect(/** 重名安装。 */ () => api.use(plugin)).toThrow("Duplicate plugin");
  const r = await api.request({ url: "/$id/$id", params: { id: 1 }, throws: false });
  expect(r.request.url).toBe("/1/1");
  api.eject(plugin.name);
  expect((await api.request({ url: CUSTOM_PATH, throws: false })).request.url).toBe(CUSTOM_PATH);
  expect(api.eject(plugin.name)).toBe(false);
  api.use(plugin);
  expect((await api.request({ url: CUSTOM_PATH, params: { id: 2 }, throws: false })).request.url).toBe("/2");
  api.dispose();
});
