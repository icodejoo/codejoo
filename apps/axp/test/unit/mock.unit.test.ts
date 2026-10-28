import { expect, it } from "vitest";
import { $rewriteUrl, $shouldFallback } from "../../src/plugins/mock";
import { AxpResponse } from "../../src/response";

/** mock 服务器基址。 */
const MOCK = "http://mock";
/** 带 query 与 hash 的接口路径。 */
const PATH_WITH_QUERY = "/pet?id=1#top";

// 标题含 $ 的 API id 不能走 it.each（会被当成占位符），用循环生成用例。
for (const [url, patch] of [
  ["/pet", { url: `${MOCK}/pet` }],
  ["pet", { url: `${MOCK}/pet` }],
  [PATH_WITH_QUERY, { url: `${MOCK}${PATH_WITH_QUERY}` }],
  ["http://real.example/pet?id=1#top", { url: `${MOCK}${PATH_WITH_QUERY}` }],
  ["https://real.example", { url: `${MOCK}/` }],
] as const) {
  it(`[mock.fn.$rewriteUrl][mock.opt.mockUrl] ${url} 改写到 mock 基址并保留 query 与 hash`, () => {
    expect($rewriteUrl(url, MOCK)).toEqual(patch);
  });
}

for (const base of [`${MOCK}/`, `${MOCK}//`]) {
  it(`[mock.fn.$rewriteUrl][mock.opt.mockUrl] 基址 ${base} 结尾斜杠与路径开头斜杠不会重复`, () => {
    expect($rewriteUrl("/pet", base)).toEqual({ url: `${MOCK}/pet` });
  });
}

for (const url of [undefined, ""]) {
  it(`[mock.fn.$rewriteUrl][mock.opt.mockUrl] 地址为 ${JSON.stringify(url)} 时改写 baseURL`, () => {
    expect($rewriteUrl(url, MOCK)).toEqual({ baseURL: MOCK });
  });
}

for (const url of ["http://", "//real.example/pet"]) {
  it(`[mock.fn.$rewriteUrl] 无法解析的绝对地址 ${url} 退化为简单拼接`, () => {
    const patch = $rewriteUrl(url, MOCK);
    expect(patch.url).toMatch(/^http:\/\/mock\/[^/]/);
    expect(patch.url).toContain(url.replace(/^\/+/, ""));
  });
}

for (const [label, response, expected] of [
  ["404", new AxpResponse({ httpStatus: 404, data: null }), true],
  ["网络不可达", new AxpResponse({ kind: "network" }), true],
  ["取消", new AxpResponse({ kind: "cancel" }), false],
  ["超时", new AxpResponse({ kind: "timeout" }), false],
  ["403", new AxpResponse({ httpStatus: 403, data: null }), false],
  ["500", new AxpResponse({ httpStatus: 500, data: null }), false],
  ["HTTP 200 + 业务码 404", new AxpResponse({ httpStatus: 200, code: 404, data: null }), false],
  ["成功", new AxpResponse({ httpStatus: 200, data: "ok" }), false],
] as const) {
  it(`[mock.fn.$shouldFallback][mock.cb.fallbackWhen] 默认只在 404 或网络不可达时回落：${label}`, () => {
    expect($shouldFallback(response)).toBe(expected);
  });
}
