import { AxiosHeaders } from "axios";
import { expect, it } from "vitest";
import { cloneAxiosDefaults, cloneAxiosHeaders } from "../../src/utils";

/** 原样透传数据的转换器。 */
const transform = (data: unknown) => data;
it("[core.fn.cloneAxiosDefaults] 复制方法头、参数与转换器数组，函数保持引用", /** 复制方法头、参数与转换器数组，函数保持引用。 */ () => {
  const headers = new AxiosHeaders({ Authorization: "old" });
  expect(cloneAxiosHeaders(undefined)).toBeUndefined();
  const copy = cloneAxiosHeaders(headers) as AxiosHeaders;
  copy.set("Authorization", "new");
  expect(headers.get("Authorization")).toBe("old");
  const defaults = {
    headers: { common: new AxiosHeaders({ Accept: "application/json" }) },
    params: { p: 1 },
    transformRequest: transform,
    transformResponse: [transform],
    transitional: { clarifyTimeoutError: false },
  };
  const cloned = cloneAxiosDefaults(defaults);
  expect(cloned.headers).not.toBe(defaults.headers);
  expect(cloned.params).not.toBe(defaults.params);
  expect(cloned.transformRequest).toEqual([transform]);
  expect(cloned.transformResponse).not.toBe(defaults.transformResponse);
  expect(cloned.transitional).not.toBe(defaults.transitional);
  expect(cloneAxiosDefaults({ transformResponse: transform }).transformResponse).toEqual([transform]);
});
