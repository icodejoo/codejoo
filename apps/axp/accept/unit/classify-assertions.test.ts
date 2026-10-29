import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios, { AxiosError } from "axios";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkResults, evaluateLocal, checkServer, checkClient, checkGeneric } from "../lib/assertions.ts";
import type { Observed, RequestRecord } from "../lib/assertions.ts";
import { AxpResponse, AXP_RESPONSE as RESPONSE_BRAND } from "../../src/response.ts";
import { AXP_RESPONSE, AXP_FAILURE } from "../../src/brand.ts";
import type { AxpFailureType } from "../../src/response.ts";
import { classifyError, classifyResponse, errorMatches, errorMatchesAny } from "../lib/classify.ts";
import type { Expectation } from "../lib/types.ts";

/** 被测产物是否已打包；没有就跳过依赖它的测试（accept 脚本会先 vp pack） */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const hasDist = fs.existsSync(path.resolve(HERE, "..", "..", "dist", "esm", "index.mjs"));
/** 旧 axp 的 auth 越权错误消息：新架构里它不再起任何作用 */
const OLD_DENIED_MESSAGE = "[axp:auth] access denied";
/** 旧 axp 的 auth 刷新失败错误消息：新架构里它不再起任何作用 */
const OLD_REFRESH_FAILED_MESSAGE = "[axp:auth] refresh failed";

/** 造一个真实的归一化响应（src 的默认实现），与 axp 实际抛出的对象同形 */
function axpResp(init: ConstructorParameters<typeof AxpResponse>[0]): AxpResponse<unknown, string | number> {
  return new AxpResponse(init);
}

/** 模拟内核挂隐藏失败事实；默认类本身不接受使用者提供的失败类别。 */
function failure(type: AxpFailureType, extra: Record<string, unknown> = {}): AxpResponse<unknown, string | number> {
  return Object.defineProperties(axpResp(extra), { [AXP_FAILURE]: { value: { type, reason: extra.reason } }, ok: { value: false } });
}

describe("classifyError：IAxpResponse（隐藏失败标记与 HTTP status）", () => {
  it("[accept.classify] cancel / timeout / network / parse 各自对应同名类别", () => {
    expect(classifyError(failure("cancel"))).toBe("canceled");
    expect(classifyError(failure("timeout"))).toBe("timeout");
    expect(classifyError(failure("network"))).toBe("network");
    expect(classifyError(failure("parse"))).toBe("parse");
  });

  it("[accept.classify] auth 按 reason：expired / denied / unauthenticated", () => {
    expect(classifyError(failure("auth", { reason: "expired", status: 401 }))).toBe("expired");
    expect(classifyError(failure("auth", { reason: "denied", status: 403 }))).toBe("denied");
    expect(classifyError(failure("auth", { reason: "unauthenticated" }))).toBe("unauthenticated");
  });

  it("[accept.classify] auth 的 reason 缺失或不认识 → unknown:（axp 有 bug 的信号），不会被猜成已知类别", () => {
    expect(classifyError(failure("auth"))).toMatch(/^unknown:auth:/);
    expect(classifyError(failure("auth", { reason: "weird" }))).toBe("unknown:auth:weird");
  });

  it("[accept.classify] 无标记的非 2xx 失败 → http:<status>", () => {
    expect(classifyError(axpResp({ status: 500 }))).toBe("http:500");
    expect(classifyError(axpResp({ status: 404, code: 404 }))).toBe("http:404");
    expect(classifyError(axpResp({ status: 500, code: 5001 }))).toBe("http:500");
  });

  it("[accept.classify] 无标记的 2xx 失败 → business:<code>（HTTP 200 + 非 0 业务码，含 401，HTTP 状态仍为 200）", () => {
    expect(classifyError(axpResp({ status: 200, code: 1001 }))).toBe("business:1001");
    expect(classifyError(axpResp({ status: 200, code: 401 }))).toBe("business:401");
    expect(classifyError(axpResp({ status: 200, code: "E_BAD" }))).toBe("business:E_BAD");
    expect(classifyError(axpResp({ status: 299, code: 1001 }))).toBe("business:1001");
    expect(classifyError(axpResp({ status: 300, code: 1001 }))).toBe("http:300");
  });

  it("[accept.classify] 不该被抛出的 ok / internal → unknown:，意味着 axp 有 bug", () => {
    expect(classifyError(axpResp({ status: 200, code: 0 }))).toMatch(/^unknown:ok:/);
    expect(classifyError(failure("internal", { message: "boom", error: new Error("boom") }))).toBe("unknown:internal:boom");
  });

  it("[accept.classify] 类别只看字段，不看 message：旧 auth 错误消息不起作用", () => {
    expect(classifyError(failure("network", { message: OLD_DENIED_MESSAGE }))).toBe("network");
    expect(classifyError(failure("timeout", { message: OLD_REFRESH_FAILED_MESSAGE }))).toBe("timeout");
    expect(classifyError(failure("parse", { status: 200, code: 1001 }))).toBe("parse");
    expect(classifyError(failure("cancel", { status: 503, code: 503 }))).toBe("canceled");
  });

  it("[accept.classify] 按品牌识别，不依赖 instanceof：create 返回的普通对象补了品牌也算", () => {
    const plain = Object.defineProperties({ ok: false, status: 0, code: 0, data: null }, { [AXP_RESPONSE]: { value: true }, [AXP_FAILURE]: { value: { type: "timeout" } } });
    expect(classifyError(plain)).toBe("timeout");
  });

  it("[accept.classify] classifyResponse 直接按字段归类，不经过品牌检查", () => {
    expect(classifyResponse(failure("timeout"))).toBe("timeout");
    expect(classifyResponse(axpResp({ status: 503 }))).toBe("http:503");
    expect(classifyResponse(axpResp({ status: 200, code: 7 }))).toBe("business:7");
  });

  it("[accept.classify] 非 IAxpResponse 的异常：形状像也不认（没有品牌），走 unknown: 兜底", () => {
    expect(classifyError({ [AXP_FAILURE]: { type: "timeout" }, status: 0 })).toMatch(/^unknown:/);
    expect(classifyError(new TypeError("weird"))).toBe("unknown:TypeError:weird");
    expect(classifyError(null)).toMatch(/^unknown:/);
    expect(classifyError(undefined)).toMatch(/^unknown:/);
  });

  it("[accept.classify] 无失败标记且 status 为 0 → unknown，不能伪装成 HTTP 失败", () => {
    expect(classifyError(axpResp({ message: null }))).toBe("unknown:response:");
  });

  it("[accept.classify] 响应模块重新导出同一个叶子模块品牌", () => {
    expect(RESPONSE_BRAND).toBe(AXP_RESPONSE);
  });
});

/** 造一个带响应的 axios 错误 */
function respErr(status: number, data: unknown = {}): AxiosError {
  const e = new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_RESPONSE", undefined, undefined, { status, data, statusText: "", headers: {}, config: {} as never });
  return e;
}

describe("classifyError：非 IAxpResponse 一律 unknown:（意味着 axp 有 bug）", () => {
  it("不再识别 axios 错误、ApiError、取消、解析、auth 消息等旧形态", () => {
    expect(classifyError(respErr(500))).toMatch(/^unknown:AxiosError:/);
    expect(classifyError(respErr(401))).toMatch(/^unknown:AxiosError:/);
    expect(classifyError(new axios.CanceledError("canceled"))).toBe("unknown:CanceledError:canceled");
    expect(classifyError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("unknown:AbortError:x");
    expect(classifyError(new AxiosError("timeout of 800ms exceeded", "ETIMEDOUT"))).toMatch(/^unknown:AxiosError:/);
    expect(classifyError(new AxiosError("Network Error", "ERR_NETWORK"))).toMatch(/^unknown:AxiosError:/);
    expect(classifyError(Object.assign(new Error("x"), { name: "ApiError", response: { status: 200, code: 1001 } }))).toBe("unknown:ApiError:x");
    expect(classifyError(new Error(OLD_DENIED_MESSAGE))).toBe(`unknown:Error:${OLD_DENIED_MESSAGE}`);
    expect(classifyError(new Error(`${OLD_REFRESH_FAILED_MESSAGE}; aborting request`))).toBe(`unknown:Error:${OLD_REFRESH_FAILED_MESSAGE}; aborting request`);
    expect(classifyError(new SyntaxError("Unexpected token"))).toMatch(/^unknown:SyntaxError:/);
    expect(classifyError("string error")).toMatch(/^unknown:/);
  });

  it("消息只保留前 80 个字符", () => {
    const text = classifyError(new Error("x".repeat(200)));
    expect(text).toBe(`unknown:Error:${"x".repeat(80)}`);
  });
});

describe("错误类别匹配：status:<n> 随风格", () => {
  it("http 风格匹配 http:n，business 风格匹配 business:n", () => {
    expect(errorMatches("status:500", "http:500", "http")).toBe(true);
    expect(errorMatches("status:500", "business:500", "http")).toBe(false);
    expect(errorMatches("status:500", "business:500", "business")).toBe(true);
    expect(errorMatches("status:500", "http:500", "business")).toBe(false);
  });

  it("http:/business: 只匹配自己；any 匹配任何失败；数组任一即可", () => {
    expect(errorMatches("http:404", "http:404", "http")).toBe(true);
    expect(errorMatches("business:1001", "business:1001", "business")).toBe(true);
    expect(errorMatches("business:1001", "http:1001", "http")).toBe(false);
    expect(errorMatches("any", "timeout", "http")).toBe(true);
    expect(errorMatchesAny(["network", "parse"], "parse", "http")).toBe(true);
    expect(errorMatchesAny(["network", "parse"], "timeout", "http")).toBe(false);
  });
});

describe.skipIf(!hasDist)("classifyError：axp 真实抛出的失败（http 与 fetch 两种 adapter）", () => {
  let server: http.Server;
  let port: number;
  const sockets = new Set<net.Socket>();
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/hang") return; // 永不响应
      if (req.url === "/close") return void req.socket.destroy();
      if (req.url === "/500") {
        res.writeHead(500, { "content-type": "application/json" });
        return void res.end('{"code":500}');
      }
      if (req.url === "/bad_json") {
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end("{oops");
      }
      if (req.url === "/html") {
        res.writeHead(200, { "content-type": "text/html" });
        return void res.end("<html>gateway</html>");
      }
      if (req.url === "/biz") {
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end('{"code":1001,"message":"stock","data":null}');
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"code":0,"data":{}}');
    });
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  /** 得到一个只在 closed 端口上的地址（连接被拒） */
  async function closedPort(): Promise<number> {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const p = (s.address() as AddressInfo).port;
    await new Promise<void>((r) => s.close(() => r()));
    return p;
  }

  for (const adapter of ["http", "fetch"] as const) {
    describe(`adapter=${adapter}`, () => {
      /** 经真实的 createAxp（打包产物）发请求，返回抛出的东西；成功返回 null */
      const call = async (url: string, extra: Record<string, unknown> = {}): Promise<unknown> => {
        const { createAxp, axpResponse } = await import("@codejoo/axp");
        const api = createAxp({ axios: axios.create({ adapter }), response: axpResponse({ expectJson: true }) });
        return api.request({ url, ...extra }).then(
          () => null,
          (e: unknown) => e,
        );
      };

      it("HTTP 500 → http:500", async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/500`))).toBe("http:500");
      });

      it("HTTP 200 + 非 0 业务码 → business:<code>", async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/biz`))).toBe("business:1001");
      });

      it("声明 JSON 却没解析成功、或网关 HTML 拦截页 → parse", async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/bad_json`))).toBe("parse");
        expect(classifyError(await call(`http://127.0.0.1:${port}/html`))).toBe("parse");
      });

      it("连接被拒 → network", async () => {
        expect(classifyError(await call(`http://127.0.0.1:${await closedPort()}/x`))).toBe("network");
      });

      it("DNS 失败（.invalid）→ network", async () => {
        expect(classifyError(await call("http://nonexistent.invalid:8080/x", { timeout: 5000 }))).toBe("network");
      });

      it("服务端直接断开连接 → network", async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/close`))).toBe("network");
      });

      it("超时 → timeout", async () => {
        expect(classifyError(await call(`http://127.0.0.1:${port}/hang`, { timeout: 150 }))).toBe("timeout");
      });

      it("主动取消 → canceled", async () => {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 100);
        expect(classifyError(await call(`http://127.0.0.1:${port}/hang`, { signal: ctrl.signal }))).toBe("canceled");
      });
    });
  }
});

/** 构造运行事实 */
function observed(records: RequestRecord[], over: Partial<Observed> = {}): Observed {
  return {
    records: new Map(records.map((r) => [r.id, r])),
    order: records.map((r) => r.id),
    events: { loading: [], notify: [], refresh: 0, expired: 0, denied: 0, unauthenticated: 0 },
    pendingAfter: 0,
    durationMs: 100,
    ...over,
  };
}
const ok = (id: string, data?: unknown, extra: Partial<RequestRecord> = {}): RequestRecord => ({ id, style: "http", ok: true, data, ...extra });
const bad = (id: string, kind: string, style: "http" | "business" = "http"): RequestRecord => ({ id, style, ok: false, kind });

describe("断言引擎", () => {
  it("results：成败、错误类别（含 status:<n> 随风格）、data 子集、hit", () => {
    const exp: Expectation = {
      results: { a: { ok: true, data: { meta: { auth: "u1" } }, hit: 2 }, b: { ok: false, error: "status:401" }, c: { ok: false, error: ["network", "parse"] } },
    };
    const obs = observed([ok("a", { meta: { auth: "u1", hit: 2 } }), bad("b", "business:401", "business"), bad("c", "parse")]);
    expect(checkResults(exp, obs)).toEqual([]);
    const wrong = observed([ok("a", { meta: { auth: "u2", hit: 1 } }), bad("b", "http:401", "business"), ok("c")]);
    const fails = checkResults(exp, wrong);
    expect(fails.some((f) => f.startsWith("a.data.meta.auth"))).toBe(true);
    expect(fails.some((f) => f.startsWith("a.hit"))).toBe(true);
    expect(fails.some((f) => f.startsWith("b: 期望错误"))).toBe(true);
    expect(fails.some((f) => f.startsWith("c: 期望错误") || f.startsWith("c: 期望失败"))).toBe(true);
  });

  it("请求没发出、ok 与实际相反都会报", () => {
    expect(checkResults({ results: { z: { ok: true } } }, observed([]))[0]).toMatch(/z: 请求没有发出/);
    expect(checkResults({ results: { a: { ok: true } } }, observed([bad("a", "timeout")]))[0]).toMatch(/期望成功/);
    expect(checkResults({ results: { a: { ok: false } } }, observed([ok("a")]))[0]).toMatch(/期望失败/);
  });

  it("from_cache 由服务端观测推断：true 要求没到达服务器", () => {
    const exp: Expectation = { results: { r1: { from_cache: false }, r2: { from_cache: true } } };
    expect(checkResults(exp, observed([ok("r1", {}, { reached: true }), ok("r2", {}, { reached: false })]))).toEqual([]);
    expect(checkResults(exp, observed([ok("r1", {}, { reached: true }), ok("r2", {}, { reached: true })]))[0]).toMatch(/r2\.from_cache/);
    expect(checkResults(exp, observed([ok("r1"), ok("r2")]))[0]).toMatch(/无法推断/);
  });

  it("order：只看列出的 id 的相对顺序", () => {
    const obs = observed([ok("a"), ok("x"), ok("b")]);
    expect(evaluateLocal({ order: ["a", "b"] }, obs)).toEqual([]);
    expect(evaluateLocal({ order: ["b", "a"] }, obs)[0]).toMatch(/order/);
  });

  it("client：loading 精确序列、各事件区间", () => {
    const obs = observed([], { events: { loading: [true, false], notify: ["m"], refresh: 1, expired: 0, denied: 0, unauthenticated: 0 } });
    expect(checkClient({ client: { loading: [true, false], notify: { eq: 1 }, refresh: { max: 1 }, expired: { eq: 0 } } }, obs)).toEqual([]);
    expect(checkClient({ client: { loading: [true] } }, obs)[0]).toMatch(/client\.loading/);
    expect(checkClient({ client: { notify: { eq: 2 } } }, obs)[0]).toMatch(/client\.notify/);
  });

  it("通用断言：pending_after=0、loading 成对，无论是否声明", () => {
    expect(checkGeneric(observed([], { pendingAfter: 1 }))[0]).toMatch(/pending_after=1/);
    expect(checkGeneric(observed([], { events: { loading: [true], notify: [], refresh: 0, expired: 0, denied: 0, unauthenticated: 0 } }))[0]).toMatch(/loading/);
    expect(evaluateLocal({}, observed([]))).toEqual([]);
  });

  it("server：total / by_key / by_path / peak_inflight / aborted", () => {
    const obs = { total: 3, inflight: 0, peak_inflight: 2, by_key: { "GET /a": 2 }, by_path: { "/a": 2 }, log: [{ aborted: true }] };
    expect(checkServer({ total: { eq: 3 }, by_key: { "GET /a": { eq: 2 } }, by_path: { "/missing": { eq: 0 } }, peak_inflight: { min: 2 }, aborted: { min: 1 } }, obs)).toEqual([]);
    expect(checkServer({ by_path: { "/a": { eq: 1 } }, aborted: { eq: 0 } }, obs)).toHaveLength(2);
  });
});
