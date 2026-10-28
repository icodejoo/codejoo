import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { b64urlEncode } from "../../lib/tokens.ts";

/**
 * 单测用的最小假服务器：只实现执行器流水线要用到的那一小部分 `/t/*` 行为
 * （echo、private、auth、runs 观测、mock），外加一个假 netem 控制面（永远直通，代理端口就是本服务端口）。
 * 它不是契约的完整实现，只用来在没有真实服务器时验证执行器的接线是否正确。
 */

/** 某一轮的状态 */
interface RunState {
  by_key: Record<string, number>;
  by_path: Record<string, number>;
  log: Array<Record<string, unknown>>;
  inflight: number;
  peak: number;
  /** 每个 key 的命中次数 */
  hits: Record<string, number>;
  users: Map<string, { refresh?: string }>;
  /** 已知 access → 用户、过期时刻、是否吊销 */
  access: Map<string, { user: string; exp: number; revoked: boolean }>;
  /** refresh → 用户、是否已用过 */
  refresh: Map<string, { user: string; used: boolean }>;
}

/** 假服务器句柄 */
export interface StubServer {
  url: string;
  netemUrl: string;
  /** 假 netem 收到的 profile 切换记录 */
  netemCalls: string[];
  close(): Promise<void>;
}

const SECRET = "stub-secret";

/** 读取请求体 */
async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** 签发形如 JWT 的令牌（HMAC 签名） */
function sign(sub: string, expMs: number, jti: string): string {
  const h = b64urlEncode(JSON.stringify({ alg: "HS256" }));
  const p = b64urlEncode(JSON.stringify({ sub, exp: expMs, jti }));
  const sig = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

/** 校验签名 */
function verifySig(token: string): boolean {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  return crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") === s;
}

/**
 * 启动假服务器与假 netem。
 * @returns 句柄；用完调用 close()
 */
export async function startStub(): Promise<StubServer> {
  const runs = new Map<string, RunState>();
  const netemCalls: string[] = [];
  let counter = 0;
  const state = (id: string): RunState => {
    let s = runs.get(id);
    if (!s) {
      s = { by_key: {}, by_path: {}, log: [], inflight: 0, peak: 0, hits: {}, users: new Map(), access: new Map(), refresh: new Map() };
      runs.set(id, s);
    }
    return s;
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    const run = String(req.headers["x-test-run"] ?? "default");
    const style = u.searchParams.get("style") ?? String(req.headers["x-test-style"] ?? "http");
    const st = state(run);
    const send = (httpStatus: number, body: unknown): void => {
      res.writeHead(httpStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    // 失败按风格输出：http 用真实状态码，business 一律 200
    const fail = (code: number, reason: string, message = "fail"): void => send(style === "business" ? 200 : code, { code, message, data: { reason } });
    const body = await readBody(req);
    const path = u.pathname;

    if (path === "/t/ping") return send(200, { code: 0, data: { pong: true }, message: "ok" });
    if (path.startsWith("/t/runs/")) {
      const id = decodeURIComponent(path.slice("/t/runs/".length));
      if (req.method === "DELETE") {
        runs.delete(id);
        return send(200, { code: 0, data: { cleared: true }, message: "ok" });
      }
      const s = state(id);
      return send(200, { code: 0, message: "ok", data: { total: s.log.length, inflight: s.inflight, peak_inflight: s.peak, by_key: s.by_key, by_path: s.by_path, log: s.log } });
    }
    if (path === "/t/auth/login") {
      const b = JSON.parse(body || "{}") as { username: string; password?: string; access_ttl_ms?: number };
      if (b.password === "wrong") return fail(401, "bad_credentials");
      const access = sign(b.username, Date.now() + (b.access_ttl_ms ?? 60000), String(++counter));
      st.access.set(access, { user: b.username, exp: Date.now() + (b.access_ttl_ms ?? 60000), revoked: false });
      const data: Record<string, unknown> = { access_token: access, token_type: "Bearer", expires_in_ms: b.access_ttl_ms ?? 60000 };
      if (!b.username.startsWith("no_refresh_")) {
        const r = `r-${++counter}`;
        st.refresh.set(r, { user: b.username, used: false });
        data.refresh_token = r;
      }
      return send(200, { code: 0, message: "ok", data });
    }
    if (path === "/t/auth/refresh") {
      const b = JSON.parse(body || "{}") as { refresh_token?: string };
      st.by_path[path] = (st.by_path[path] ?? 0) + 1;
      st.log.push({ path, status: 200 });
      const r = st.refresh.get(b.refresh_token ?? "");
      if (!r) return fail(401, "invalid", "invalid refresh token");
      if (r.used) return fail(401, "reused", "refresh token reused");
      r.used = true;
      const access = sign(r.user, Date.now() + 60000, String(++counter));
      st.access.set(access, { user: r.user, exp: Date.now() + 60000, revoked: false });
      const nr = `r-${++counter}`;
      st.refresh.set(nr, { user: r.user, used: false });
      return send(200, { code: 0, message: "ok", data: { access_token: access, refresh_token: nr, token_type: "Bearer" } });
    }
    if (path === "/t/auth/logout" || path === "/t/auth/revoke") return send(200, { code: 0, message: "ok", data: { ok: true } });

    // 业务接口：echo / public / mock / private
    const isPrivate = path.startsWith("/t/private");
    const isMock = path.startsWith("/t/mock");
    let auth: string | null = null;
    if (isPrivate) {
      const h = String(req.headers.authorization ?? "");
      const token = h.startsWith("Bearer ") ? h.slice(7) : "";
      if (!token) return fail(401, "missing", "missing token");
      const rec = st.access.get(token);
      if (!verifySig(token) || !rec) return fail(401, "invalid", "invalid token");
      if (rec.exp < Date.now()) return fail(401, "expired", "token expired");
      auth = rec.user;
      if (u.searchParams.get("deny")) return fail(403, "forbidden", "forbidden");
    }
    const key = u.searchParams.get("key") ?? `${req.method} ${path}`;
    st.hits[key] = (st.hits[key] ?? 0) + 1;
    st.by_key[key] = st.hits[key] as number;
    st.by_path[path] = (st.by_path[path] ?? 0) + 1;
    st.inflight++;
    st.peak = Math.max(st.peak, st.inflight);
    const entry: Record<string, unknown> = { path, key, status: 200, aborted: false };
    st.log.push(entry);
    let finished = false;
    const done = (): void => {
      if (!finished) {
        finished = true;
        st.inflight--;
      }
    };
    res.on("close", () => {
      if (!res.writableFinished) entry.aborted = true;
      done();
    });
    const delay = Number(u.searchParams.get("delay_ms") ?? 0);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (res.destroyed) return done();
    const failTimes = Number(u.searchParams.get("fail_times") ?? 0);
    const status = Number(u.searchParams.get("status") ?? 200);
    const fault = u.searchParams.get("fault");
    if (fault === "close") return void res.destroy();
    if (fault === "bad_json") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end("{oops");
    }
    if (fault === "html") {
      res.writeHead(200, { "content-type": "text/html" });
      return void res.end("<html>gateway</html>");
    }
    if ((st.hits[key] as number) <= failTimes) {
      entry.status = 500;
      return fail(500, "injected", "injected failure");
    }
    if (status !== 200) {
      entry.status = status;
      return fail(status, "injected");
    }
    send(200, {
      code: 0,
      message: "ok",
      data: { meta: { run, key, hit: st.hits[key], path, method: req.method, auth }, mock: isMock || undefined, request: { path, query: Object.fromEntries(u.searchParams), body: body ? safeJson(body) : null } },
    });
  });

  const netem = http.createServer(async (req, res) => {
    const text = await readBody(req);
    netemCalls.push(`${req.method} ${req.url} ${text}`);
    res.writeHead(200, { "content-type": "application/json" });
    if (req.method === "POST" && req.url === "/proxies") {
      res.end(JSON.stringify({ id: `p${++counter}`, port: (server.address() as AddressInfo).port }));
    } else if (req.method === "GET" && req.url?.endsWith("/stats")) {
      res.end(JSON.stringify({ connections: 0, active: 0, bytes_up: 0, bytes_down: 0, resets: 0, refused: 0 }));
    } else res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => netem.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const netemUrl = `http://127.0.0.1:${(netem.address() as AddressInfo).port}`;
  return {
    url,
    netemUrl,
    netemCalls,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => netem.close(() => r()));
      }),
  };
}

/** 安全解析 JSON，失败返回原文 */
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
