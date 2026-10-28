/* eslint-disable no-await-in-loop -- 同一客户端依次核对请求选项和生命周期，避免引入额外并发语义。 */
import type { AxpResponse } from "../../src/response";
import { expect, it } from "vitest";
import axpRepath from "../../src/plugins/repath";
import { preparedClient } from "../helpers/prepare";

/** 查询参数字段名。 */
const PARAMS_FIELD = "params";
/** 请求体字段名。 */
const DATA_FIELD = "data";
/** 可参与路径替换的空文本。 */
const EMPTY_TEXT = "";
/** 缺值边界使用的路径模板。 */
const VARIABLE_PATH = "/:id";

/** 需要单段编码的特殊字符。 */
const VALUE = "a/b?c#汉 字";
/** 编码后的单段路径。 */
const ENCODED = encodeURIComponent(VALUE);
it.each(["/:id/{id}/[id]", "https://host:8080/:id/{id}/[id]?q=:id#hash={id}", "//host:8080/:id/{id}/[id]?q=:id#hash={id}"])(
  "[repath.fn.pathname] 只替换 pathname，重复变量编码且保留 host/query/hash：%s",
  /** 重复变量从未修改来源取值。 */ async (url) => {
    for (const source of [PARAMS_FIELD, DATA_FIELD]) {
      const { api } = preparedClient([axpRepath<AxpResponse>()]);
      const original = Object.freeze({ id: VALUE });
      const r = await api.request({ url, [source]: original, throws: false });
      const end = url.indexOf("?");
      const path = end < 0 ? url : url.slice(0, end);
      const suffix = end < 0 ? EMPTY_TEXT : url.slice(end);
      expect(r.request.url).toBe(path.replace(/:id|{id}|\[id\]/g, ENCODED) + suffix);
      expect(r.request[source as typeof PARAMS_FIELD | typeof DATA_FIELD]).toEqual({});
      expect(original.id).toBe(VALUE);
      api.dispose();
    }
  },
);
it.each([0, false, EMPTY_TEXT, 1n, Symbol("id")])(
  "[repath.req.primitive] 原始 data %s 可替换重复变量，删除只影响内层",
  /** 原始值来源。 */ async (data) => {
    for (const removeKey of [true, false]) {
      const { api } = preparedClient([axpRepath<AxpResponse>({ removeKey })], {
        transformRequest: /** 保留原始请求体。 */ (value) => value,
      });
      const config = Object.freeze({ url: "/:id/{id}", data });
      const r = await api.request({ ...config, throws: false });
      const encoded = encodeURIComponent(String(data));
      expect(r.request.url).toBe(`/${encoded}/${encoded}`);
      expect(r.request.data).toBe(removeKey ? undefined : data);
      expect(config.data).toBe(data);
      api.dispose();
    }
  },
);
it("[repath.req.missing][repath.opt.pattern] 缺 URL、缺值、空值和无捕获组均安全透传", /** 不误读 replace 的尾部参数。 */ async () => {
  const { api } = preparedClient([axpRepath<AxpResponse>()]);
  for (const params of [undefined, null, {}, { id: null }]) {
    for (const data of [undefined, null, {}, { id: null }, [], new Date(), new FormData(), /** 函数不是原始值来源。 */ () => 1]) {
      const r = await api.request({
        url: VARIABLE_PATH,
        params,
        data,
        throws: false,
        transformRequest: /** 保留函数身份。 */ (value) => value,
      });
      expect(r.request.url).toBe(VARIABLE_PATH);
    }
  }
  expect((await api.request({ throws: false })).request.url).toBeUndefined();
  api.eject("axp:repath");
  api.use(axpRepath<AxpResponse>({ pattern: /:id/g }));
  expect((await api.request({ url: VARIABLE_PATH, params: { id: 1 }, throws: false })).request.url).toBe(VARIABLE_PATH);
  api.dispose();
});
