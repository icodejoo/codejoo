import { expect, it } from "vitest";
import { requestKey } from "../../src/key";

/** 默认请求地址。 */
const URL = "/me";
/** 第一套服务地址。 */
const BASE_URL = "https://v1.example";
/** 第二套服务地址。 */
const OTHER_BASE_URL = "https://v2.example";
/** 基准请求。 */
const REQUEST = { method: "get", url: URL };

it("[core.method.key] baseURL 与相对地址按 axios 规则拼接，不同服务的 key 不同", /** 完整地址进入摘要。 */ () => {
  const first = requestKey({ ...REQUEST, baseURL: BASE_URL });
  expect(first).not.toBe(requestKey({ ...REQUEST, baseURL: OTHER_BASE_URL }));
  expect(first).toBe(requestKey({ ...REQUEST, url: BASE_URL + URL }));
  expect(requestKey({ ...REQUEST, baseURL: BASE_URL + "/", url: "///me", allowAbsoluteUrls: false })).toBe(first);
  expect(requestKey({ ...REQUEST, baseURL: BASE_URL + "//" })).toBe(requestKey({ ...REQUEST, url: BASE_URL + URL }));
  expect(requestKey({ ...REQUEST, baseURL: BASE_URL, url: "me" })).toBe(first);
});

it.each([undefined, ""])(
  "[core.method.key] 空相对地址 %s 保留 baseURL 原文",
  /** 空地址不补斜线。 */ (url) => {
    const baseURL = BASE_URL + "/";
    expect(requestKey({ ...REQUEST, baseURL, url })).toBe(requestKey({ ...REQUEST, url: baseURL }));
  },
);

it.each([BASE_URL + URL, "//cdn.example/me", "Custom+v1.2-x://host/me"])(
  "[core.method.key] 绝对地址 %s 默认忽略 baseURL，allowAbsoluteUrls=false 则拼接",
  /** 与 axios 的协议及协议相对地址识别一致。 */ (url) => {
    const original = requestKey({ ...REQUEST, url });
    expect(requestKey({ ...REQUEST, url, baseURL: BASE_URL })).toBe(original);
    expect(requestKey({ ...REQUEST, url, baseURL: OTHER_BASE_URL, allowAbsoluteUrls: true })).toBe(original);
    expect(requestKey({ ...REQUEST, url, baseURL: BASE_URL, allowAbsoluteUrls: false })).toBe(requestKey({ ...REQUEST, url: BASE_URL + "/" + url.replace(/^\/+/, "") }));
  },
);

it.each([undefined, "", 42])(
  "[core.method.key] 没有非空字符串 baseURL（%s）时与省略等价",
  /** 非字符串也不引入地址变化。 */ (baseURL) => {
    const request = { ...REQUEST, baseURL } as never;
    expect(requestKey(request)).toBe(requestKey(REQUEST));
    expect(requestKey({ ...REQUEST, allowAbsoluteUrls: false })).toBe(requestKey(REQUEST));
  },
);

it("[core.req.key][core.opt.key.scope] 完整地址仍追加 scope，显式字符串 key 不受地址影响", /** 显式 key 和分区规则保持原样。 */ () => {
  const request = { ...REQUEST, baseURL: BASE_URL };
  const options = { scope: "account" };
  expect(requestKey(request, options)).toBe(requestKey(request) + "#account");
  expect(requestKey({ ...request, key: " x " }, options)).toBe(" x #account");
  expect(requestKey({ ...request, baseURL: OTHER_BASE_URL, key: "x" }, options)).toBe("x#account");
});
