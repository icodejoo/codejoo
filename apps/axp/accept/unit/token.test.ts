import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../lib/client-factory.ts";
import { parseConfig } from "../lib/config.ts";
import { ENV_TOKEN, HEADER_TOKEN } from "../lib/constants.ts";
import { tokenHeaders } from "../lib/http.ts";
import { ServerClient } from "../lib/server-client.ts";
import { TokenStore } from "../lib/tokens.ts";

/** 测试用令牌值 */
const TOKEN = "local-secret";
/** 一次请求被记录下来的信息 */
interface Seen {
  path: string;
  token: string | undefined;
}

/** 起一个记录请求头的本地服务器：旧 access 一律 401，刷新接口发新 access，其余返回信封 */
async function recorder(): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? "", token: req.headers[HEADER_TOKEN] as string | undefined });
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/t/auth/refresh")) {
      res.end(JSON.stringify({ code: 0, data: { access_token: "new", refresh_token: "r2" } }));
    } else if (req.url?.startsWith("/private") && req.headers.authorization !== "Bearer new") {
      res.statusCode = 401;
      res.end(JSON.stringify({ code: 401, data: null }));
    } else {
      res.end(JSON.stringify({ code: 0, data: { ok: true } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen, close: () => new Promise((r) => server.close(() => r())) };
}

/** 每个用例结束后关闭起过的服务器 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

describe("tokenHeaders", () => {
  it("非空时给出 x-testkit-token，空或缺省为空对象", () => {
    expect(tokenHeaders("abc")).toEqual({ [HEADER_TOKEN]: "abc" });
    expect(tokenHeaders("")).toEqual({});
    expect(tokenHeaders(undefined)).toEqual({});
  });
});

describe("config：TESTKIT_TOKEN", () => {
  const acceptDir = path.resolve("accept");
  it("读取并去空白，未设为空串", () => {
    expect(parseConfig([], { [ENV_TOKEN]: ` ${TOKEN}\n` }, "/w", acceptDir).token).toBe(TOKEN);
    expect(parseConfig([], {}, "/w", acceptDir).token).toBe("");
  });
});

describe("ServerClient 的 /t 控制请求", () => {
  it("带 token 时每个请求都带头，不带时没有这个头", async () => {
    const rec = await recorder();
    closers.push(rec.close);
    await new ServerClient(rec.url, "r1", "http", TOKEN).observe();
    await new ServerClient(rec.url, "r2", "http").observe();
    expect(rec.seen.map((s) => s.token)).toEqual([TOKEN, undefined]);
  });
});

describe("被测客户端", () => {
  /** 构造连到记录服务器的客户端，装 auth 以便走刷新 */
  function client(url: string, token: string | undefined, tokens: TokenStore) {
    return createClient({
      adapter: "http",
      baseURL: url,
      plugins: { auth: { url_pattern: "/private" } },
      tokens,
      hooks: { loading: vi.fn(), notify: vi.fn(), refresh: vi.fn(), expired: vi.fn(), denied: vi.fn(), unauthenticated: vi.fn() },
      getStyle: () => "http",
      runId: "tok",
      token,
    });
  }

  it("普通请求与 auth 刷新用的裸 axios 都带 token", async () => {
    const rec = await recorder();
    closers.push(rec.close);
    const tokens = new TokenStore();
    tokens.set("old", "r1");
    const c = client(rec.url, TOKEN, tokens);
    await c.send({ id: "t", path: "/plain" }, {});
    await c.send({ id: "t", path: "/private/x" }, {});
    c.dispose();
    expect(rec.seen.some((s) => s.path.startsWith("/t/auth/refresh"))).toBe(true);
    expect(rec.seen.length).toBeGreaterThanOrEqual(4);
    expect(rec.seen.every((s) => s.token === TOKEN)).toBe(true);
  });

  it("未提供 token 时不带头", async () => {
    const rec = await recorder();
    closers.push(rec.close);
    const c = client(rec.url, undefined, new TokenStore());
    await c.send({ id: "t", path: "/plain" }, {});
    c.dispose();
    expect(rec.seen.every((s) => s.token === undefined)).toBe(true);
  });
});
