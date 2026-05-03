/* eslint-disable */
// Bun-based mock HTTP server for integration tests.
//
// Loads test/mock.json (Petstore OpenAPI 3.0) and exposes:
//   1. All Petstore paths (GET/POST/PUT/DELETE) wrapped in
//      { code: '0000', message: 'ok', data: <example> }
//   2. Test fixture endpoints under /flaky/* + /counter/* + /echo + /slow
//      that drive the plugin integration tests.
//
// All state is in-memory + per-server-instance. `startServer()` spins up a
// fresh listener on an OS-assigned port; `close()` tears it down so each
// integration test file gets total isolation.

declare const Bun: any;

// ───────────────────────────────────────────────────────────────────────────
//  Types
// ───────────────────────────────────────────────────────────────────────────

interface MatchedRoute {
    handler: (req: Request, params: Record<string, string>, ctx: Ctx) => Promise<Response> | Response;
    params: Record<string, string>;
}

interface RouteEntry {
    method: string;
    pattern: RegExp;
    keys: string[];
    handler: (req: Request, params: Record<string, string>, ctx: Ctx) => Promise<Response> | Response;
}

interface Ctx {
    /** Counter map keyed by `${endpoint}:${X-Test-Key|'default'}`. */
    counters: Map<string, number>;
}

// ───────────────────────────────────────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────────────────────────────────────

const ENVELOPE_OK = (data: any, message = 'ok') =>
    JSON.stringify({ code: '0000', message, data });

function ok(data: any, init?: ResponseInit, message?: string): Response {
    return new Response(ENVELOPE_OK(data, message), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
    });
}

function plain(status: number, body: any, headers: Record<string, string> = {}): Response {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

function compilePath(path: string): { pattern: RegExp; keys: string[] } {
    const keys: string[] = [];
    const re = path.replace(/[.+*?^$()|]/g, '\\$&').replace(/\{([^}]+)\}/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
    });
    return { pattern: new RegExp('^' + re + '/?$'), keys };
}

async function readJson(req: Request): Promise<any> {
    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('json')) {
        const text = await req.text();
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
    }
    try { return await req.json(); } catch { return null; }
}

function counterKey(endpoint: string, req: Request): string {
    return `${endpoint}:${req.headers.get('x-test-key') || 'default'}`;
}

// ───────────────────────────────────────────────────────────────────────────
//  Petstore stub data builders
// ───────────────────────────────────────────────────────────────────────────

function buildPet(petId: number | string, overrides: any = {}): any {
    return {
        id: typeof petId === 'string' && /^\d+$/.test(petId) ? parseInt(petId, 10) : petId,
        name: 'doggie',
        category: { id: 1, name: 'Dogs' },
        photoUrls: ['https://example.com/photo.jpg'],
        tags: [{ id: 1, name: 'tag1' }],
        status: 'available',
        ...overrides,
    };
}

function buildOrder(orderId: number | string, overrides: any = {}): any {
    return {
        id: typeof orderId === 'string' && /^\d+$/.test(orderId) ? parseInt(orderId, 10) : orderId,
        petId: 198772,
        quantity: 7,
        shipDate: '2024-01-01T00:00:00.000Z',
        status: 'approved',
        complete: true,
        ...overrides,
    };
}

function buildUser(username: string, overrides: any = {}): any {
    return {
        id: 10,
        username,
        firstName: 'John',
        lastName: 'James',
        email: 'john@email.com',
        password: '12345',
        phone: '12345',
        userStatus: 1,
        ...overrides,
    };
}

// ───────────────────────────────────────────────────────────────────────────
//  Route builder
// ───────────────────────────────────────────────────────────────────────────

export function buildRoutes(): RouteEntry[] {
    const r: RouteEntry[] = [];

    function add(
        method: string,
        path: string,
        handler: (req: Request, params: Record<string, string>, ctx: Ctx) => Promise<Response> | Response,
    ) {
        const { pattern, keys } = compilePath(path);
        r.push({ method: method.toUpperCase(), pattern, keys, handler });
    }

    // ─── Petstore — /pet ───────────────────────────────────────────────────
    add('PUT', '/pet', async (req) => {
        const body = await readJson(req);
        const pet = buildPet(body?.id ?? 10, body || {});
        return ok(pet, undefined, 'pet updated');
    });
    add('POST', '/pet', async (req) => {
        const body = await readJson(req);
        const pet = buildPet(body?.id ?? 10, body || {});
        return ok(pet, undefined, 'pet created');
    });

    add('GET', '/pet/findByStatus', (req) => {
        const url = new URL(req.url);
        const status = url.searchParams.get('status') || 'available';
        return ok([
            buildPet(10, { status }),
            buildPet(11, { status, name: 'kitten' }),
        ]);
    });
    add('GET', '/pet/findByTags', (req) => {
        const url = new URL(req.url);
        const tags = url.searchParams.getAll('tags');
        return ok([
            buildPet(20, { tags: tags.map((name, i) => ({ id: i + 1, name })) }),
        ]);
    });

    add('GET', '/pet/{petId}', (_req, params) => {
        return ok(buildPet(params.petId));
    });
    add('POST', '/pet/{petId}', (req, params) => {
        const url = new URL(req.url);
        const name = url.searchParams.get('name') ?? 'doggie';
        const status = url.searchParams.get('status') ?? 'available';
        return ok(buildPet(params.petId, { name, status }));
    });
    add('DELETE', '/pet/{petId}', (_req, params) => {
        return ok({ deleted: true, petId: params.petId });
    });
    add('POST', '/pet/{petId}/uploadImage', (_req, params) => {
        return ok({
            code: 200,
            type: 'unknown',
            message: `image uploaded for pet ${params.petId}`,
        });
    });

    // ─── Petstore — /store ─────────────────────────────────────────────────
    add('GET', '/store/inventory', () => {
        return ok({ available: 100, pending: 5, sold: 50 });
    });
    add('POST', '/store/order', async (req) => {
        const body = await readJson(req);
        return ok(buildOrder(body?.id ?? 10, body || {}));
    });
    add('GET', '/store/order/{orderId}', (_req, params) => {
        return ok(buildOrder(params.orderId));
    });
    add('DELETE', '/store/order/{orderId}', (_req, params) => {
        return ok({ deleted: true, orderId: params.orderId });
    });

    // ─── Petstore — /user ──────────────────────────────────────────────────
    add('POST', '/user', async (req) => {
        const body = await readJson(req);
        return ok(buildUser(body?.username ?? 'theUser', body || {}));
    });
    add('POST', '/user/createWithList', async (req) => {
        const body = await readJson(req);
        const list = Array.isArray(body) ? body : [];
        return ok(list.length ? list[0] : buildUser('theUser'));
    });
    add('GET', '/user/login', (req) => {
        const url = new URL(req.url);
        const username = url.searchParams.get('username') || 'guest';
        return ok(`session-token-for-${username}`);
    });
    add('GET', '/user/logout', () => ok({ loggedOut: true }));
    add('GET', '/user/{username}', (_req, params) => ok(buildUser(params.username)));
    add('PUT', '/user/{username}', async (req, params) => {
        const body = await readJson(req);
        return ok(buildUser(params.username, body || {}));
    });
    add('DELETE', '/user/{username}', (_req, params) =>
        ok({ deleted: true, username: params.username }),
    );

    // ─── Test fixtures — /flaky/* ──────────────────────────────────────────

    // GET /flaky/network — fails X-Fail-Times then succeeds.
    add('GET', '/flaky/network', (req, _p, ctx) => {
        const fail = parseInt(req.headers.get('x-fail-times') || '1', 10);
        const k = counterKey('network', req);
        const n = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, n);
        if (n <= fail) {
            // Drop the connection by returning a stream we never write to;
            // simulates a network failure for the axios client.
            // Bun closes the socket when the response stream errors.
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error(new Error('network reset'));
                    },
                }),
                { status: 200 },
            );
        }
        return ok({ ok: true, attempts: n }, { headers: { 'x-hit-count': String(n) } });
    });

    // POST /flaky/status?n=N&code=C — same semantics as GET, but for POST tests.
    const flakyStatusHandler = (req: Request, _p: Record<string, string>, ctx: Ctx) => {
        const url = new URL(req.url);
        const n = parseInt(url.searchParams.get('n') || '1', 10);
        const code = parseInt(url.searchParams.get('code') || '500', 10);
        const k = counterKey('status', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        if (c <= n) {
            return new Response(
                JSON.stringify({ code: 'SERVER_ERR', message: `simulated ${code}`, data: null }),
                {
                    status: code,
                    headers: { 'content-type': 'application/json', 'x-hit-count': String(c) },
                },
            );
        }
        return ok(
            { ok: true, attempts: c },
            { headers: { 'x-hit-count': String(c) } },
        );
    };
    add('POST', '/flaky/status', flakyStatusHandler);

    // GET /flaky/status?n=N&code=C — fails first N requests with code C.
    add('GET', '/flaky/status', (req, _p, ctx) => {
        const url = new URL(req.url);
        const n = parseInt(url.searchParams.get('n') || '1', 10);
        const code = parseInt(url.searchParams.get('code') || '500', 10);
        const k = counterKey('status', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        if (c <= n) {
            return new Response(
                JSON.stringify({ code: 'SERVER_ERR', message: `simulated ${code}`, data: null }),
                {
                    status: code,
                    headers: { 'content-type': 'application/json', 'x-hit-count': String(c) },
                },
            );
        }
        return ok(
            { ok: true, attempts: c },
            { headers: { 'x-hit-count': String(c) } },
        );
    });

    // GET /flaky/timeout?ms=N — sleeps ms before responding.
    add('GET', '/flaky/timeout', async (req) => {
        const url = new URL(req.url);
        const ms = parseInt(url.searchParams.get('ms') || '1000', 10);
        await sleep(ms);
        return ok({ slept: ms });
    });

    // GET /flaky/biz-error — 200 status, business-error envelope.
    add('GET', '/flaky/biz-error', (req, _p, ctx) => {
        const k = counterKey('biz', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        return new Response(
            JSON.stringify({ code: 'BIZ_ERR', message: 'business failure', data: null }),
            {
                status: 200,
                headers: { 'content-type': 'application/json', 'x-hit-count': String(c) },
            },
        );
    });

    // GET /flaky/biz-flaky?n=N — fails first N with biz-error envelope, then OK.
    add('GET', '/flaky/biz-flaky', (req, _p, ctx) => {
        const url = new URL(req.url);
        const n = parseInt(url.searchParams.get('n') || '1', 10);
        const k = counterKey('biz-flaky', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        if (c <= n) {
            return new Response(
                JSON.stringify({ code: 'BIZ_ERR', message: 'biz failure', data: null }),
                { status: 200, headers: { 'content-type': 'application/json', 'x-hit-count': String(c) } },
            );
        }
        return ok({ ok: true, attempts: c }, { headers: { 'x-hit-count': String(c) } });
    });

    // GET /flaky/retry-after?seconds=N — first 503 with Retry-After, then 200.
    add('GET', '/flaky/retry-after', (req, _p, ctx) => {
        const url = new URL(req.url);
        const seconds = url.searchParams.get('seconds') || '1';
        const k = counterKey('retry-after', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        if (c === 1) {
            return new Response(
                JSON.stringify({ code: 'THROTTLED', message: 'wait', data: null }),
                {
                    status: 503,
                    headers: {
                        'content-type': 'application/json',
                        'retry-after': seconds,
                        'x-hit-count': '1',
                    },
                },
            );
        }
        return ok({ ok: true, attempts: c }, { headers: { 'x-hit-count': String(c) } });
    });

    // GET /flaky/rate-limit — first 429 with X-RateLimit-Reset, then 200.
    add('GET', '/flaky/rate-limit', (req, _p, ctx) => {
        const k = counterKey('rate-limit', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        if (c === 1) {
            return new Response(
                JSON.stringify({ code: 'RATE_LIMITED', message: 'slow down', data: null }),
                {
                    status: 429,
                    headers: {
                        'content-type': 'application/json',
                        'x-ratelimit-reset': '1',
                        'x-hit-count': '1',
                    },
                },
            );
        }
        return ok({ ok: true, attempts: c }, { headers: { 'x-hit-count': String(c) } });
    });

    // POST /flaky/reset — clear all counters (or one key).
    add('POST', '/flaky/reset', async (req, _p, ctx) => {
        const url = new URL(req.url);
        const key = url.searchParams.get('key');
        if (key) {
            for (const k of [...ctx.counters.keys()]) {
                if (k.endsWith(`:${key}`)) ctx.counters.delete(k);
            }
        } else {
            ctx.counters.clear();
        }
        return ok({ reset: true, key });
    });

    // GET /counter/:name — peek count for a specific endpoint+key.
    add('GET', '/counter/{name}', (req, params, ctx) => {
        const k = counterKey(params.name, req);
        return ok({ count: ctx.counters.get(k) || 0 });
    });
    add('POST', '/counter/{name}/reset', (req, params, ctx) => {
        const k = counterKey(params.name, req);
        ctx.counters.delete(k);
        return ok({ reset: true });
    });

    // ─── Generic fixtures ─────────────────────────────────────────────────

    // POST /echo — echoes back what the client sent (post-plugin).
    add('POST', '/echo', async (req) => {
        const url = new URL(req.url);
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
        const query: Record<string, string | string[]> = {};
        url.searchParams.forEach((v, k) => {
            const ex = query[k];
            if (ex === undefined) query[k] = v;
            else if (Array.isArray(ex)) ex.push(v);
            else query[k] = [ex, v];
        });
        const body = await readJson(req);
        return ok({ method: req.method, url: url.pathname + url.search, headers, query, body });
    });

    // GET /echo — same shape, query only.
    add('GET', '/echo', (req) => {
        const url = new URL(req.url);
        const headers: Record<string, string> = {};
        req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
        const query: Record<string, string | string[]> = {};
        url.searchParams.forEach((v, k) => {
            const ex = query[k];
            if (ex === undefined) query[k] = v;
            else if (Array.isArray(ex)) ex.push(v);
            else query[k] = [ex, v];
        });
        return ok({ method: req.method, url: url.pathname + url.search, headers, query, body: null });
    });

    // GET /slow?ms=N — sleep + 200.
    add('GET', '/slow', async (req) => {
        const url = new URL(req.url);
        const ms = parseInt(url.searchParams.get('ms') || '0', 10);
        await sleep(ms);
        return ok({ slept: ms });
    });

    // GET /ok — boring success, useful for shape assertions.
    add('GET', '/ok', () => ok({ hello: 'world' }));

    // GET /seq — increments a per-key counter and returns it; useful for
    // verifying retry/cache "did the server see another hit" without 500s.
    add('GET', '/seq', (req, _p, ctx) => {
        const k = counterKey('seq', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        return ok({ n: c }, { headers: { 'x-hit-count': String(c) } });
    });

    // ─── Auth fixtures ────────────────────────────────────────────────────
    // 给 e2e/spec 测 auth plugin 用。统一规则：
    //   - Authorization 头匹配 query.expect → 200 envelope
    //   - 其他行为通过路径区分（whoami / expire-once / always-401 / forbidden）

    // GET /auth/whoami?expect=<token>
    //   - 缺 Authorization                       → 401 + envelope
    //   - Authorization 不等于 expect            → 401 + envelope
    //   - Authorization 等于 expect              → 200 + envelope
    add('GET', '/auth/whoami', (req) => {
        const url = new URL(req.url);
        const expect = url.searchParams.get('expect') || '';
        const auth = req.headers.get('authorization') || '';
        if (!auth || (expect && auth !== expect)) {
            return new Response(
                JSON.stringify({ code: 'UNAUTHORIZED', message: 'no/bad token', data: null }),
                { status: 401, headers: { 'content-type': 'application/json' } },
            );
        }
        return ok({ token: auth });
    });

    // GET /auth/expire-once
    //   - 第 1 次（按 X-Test-Key 分组）           → 401，强制触发 refresh
    //   - 之后 + Authorization 头存在            → 200 + 回显当前 Authorization
    add('GET', '/auth/expire-once', (req, _p, ctx) => {
        const k = counterKey('auth-expire-once', req);
        const c = (ctx.counters.get(k) || 0) + 1;
        ctx.counters.set(k, c);
        const auth = req.headers.get('authorization') || '';
        if (c === 1) {
            return new Response(
                JSON.stringify({ code: 'EXPIRED', message: 'token expired', data: null }),
                {
                    status: 401,
                    headers: { 'content-type': 'application/json', 'x-hit-count': String(c) },
                },
            );
        }
        return ok({ auth, attempt: c }, { headers: { 'x-hit-count': String(c) } });
    });

    // GET /auth/always-401 — 永远 401（用于测 refresh 失败 → expired 路径）
    add('GET', '/auth/always-401', () =>
        new Response(
            JSON.stringify({ code: 'UNAUTHORIZED', message: 'always 401', data: null }),
            { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    );

    // GET /auth/forbidden — 永远 403（用于测 isDeny → onAccessDenied）
    add('GET', '/auth/forbidden', () =>
        new Response(
            JSON.stringify({ code: 'FORBIDDEN', message: 'no permission', data: null }),
            { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    );

    // ─── Realistic auth fixtures（带网络延迟模拟，能制造乱序返回）─────────────
    //
    // 模拟一个真实的鉴权后端：
    //   - 维护一份"当前有效的 access tokens"集合（开始为空）
    //   - GET /auth/check 按 Authorization 头判断，命中即 200，不在集合 → 401
    //   - POST /auth/refresh 真实"换新 token"：拿一个随机字符串塞进集合，发回去
    //   - POST /auth/revoke 把指定 token 从集合里去掉（模拟 server 主动失效）
    //   - 所有端点支持 ?delay=ms 强制延迟 + ?jitter=ms 随机抖动 → 并发请求乱序到达

    /** 当前有效的 access tokens —— 共享状态横跨所有 /auth/* 演示 */
    const validTokens = new Set<string>();
    let tokenSeq = 0;

    function gateBy(req: Request): { ok: boolean; auth: string } {
        const auth = req.headers.get('authorization') || '';
        return { ok: !!auth && validTokens.has(auth), auth };
    }

    async function applyNetworkSim(req: Request): Promise<void> {
        const url = new URL(req.url);
        const delay = parseInt(url.searchParams.get('delay') || '0', 10);
        const jitter = parseInt(url.searchParams.get('jitter') || '0', 10);
        // jitter:N 让实际等待 = delay + Math.random() * N → 多个并发请求会乱序返回
        const total = delay + (jitter > 0 ? Math.floor(Math.random() * jitter) : 0);
        if (total > 0) await sleep(total);
    }

    // GET /auth/check?delay=ms&jitter=ms
    //   - Authorization 不在 validTokens 集合 → 401（强制触发 refresh）
    //   - 命中 → 200 + 回显当前 Authorization
    //   - 多个并发：每个请求独立判断（不靠计数器），所以**全都会被 reject** —— 真并发场景
    add('GET', '/auth/check', async (req) => {
        await applyNetworkSim(req);
        const { ok: pass, auth } = gateBy(req);
        if (!pass) {
            return new Response(
                JSON.stringify({ code: 'EXPIRED', message: 'token not in valid set', data: null }),
                { status: 401, headers: { 'content-type': 'application/json' } },
            );
        }
        return ok({ token: auth, ts: Date.now() });
    });

    // POST /auth/refresh?delay=ms&jitter=ms
    //   - body { refresh_token } 任意值都接受（demo 用，不做严格校验）
    //   - 生成一个新的 access token，加入 validTokens 集合，返回给 caller
    //   - 用 query.fail=1 模拟 refresh 失败 → 返回 401
    add('POST', '/auth/refresh', async (req) => {
        await applyNetworkSim(req);
        const url = new URL(req.url);
        if (url.searchParams.get('fail') === '1') {
            return new Response(
                JSON.stringify({ code: 'REFRESH_FAILED', message: 'refresh denied', data: null }),
                { status: 401, headers: { 'content-type': 'application/json' } },
            );
        }
        const newAccess = `access-${++tokenSeq}-${Math.random().toString(36).slice(2, 8)}`;
        const newRefresh = `refresh-${tokenSeq}-${Math.random().toString(36).slice(2, 8)}`;
        validTokens.add(newAccess);
        return ok({ access_token: newAccess, refresh_token: newRefresh, expires_in: 3600 });
    });

    // POST /auth/revoke —— body { token } 把它从 validTokens 集合移除
    add('POST', '/auth/revoke', async (req) => {
        const body = await readJson(req);
        const t = (body as { token?: string })?.token;
        if (typeof t === 'string' && t) validTokens.delete(t);
        return ok({ revoked: t });
    });

    // POST /auth/revoke-all —— 清空整个 validTokens 集合（模拟 server 全员退登）
    add('POST', '/auth/revoke-all', () => {
        validTokens.clear();
        return ok({ revoked: 'all' });
    });

    return r;
}

// ───────────────────────────────────────────────────────────────────────────
//  Server bootstrap
// ───────────────────────────────────────────────────────────────────────────

export function startServerImpl(port = 0): { port: number; close: () => Promise<void> } {
    if (typeof Bun === 'undefined' || !Bun.serve) {
        throw new Error(
            'startServer requires Bun runtime. Run integration tests with: bun --bun npx vitest run',
        );
    }

    const routes = buildRoutes();
    const ctx: Ctx = { counters: new Map() };

    const server = Bun.serve({
        port,
        development: false,
        async fetch(req: Request) {
            const url = new URL(req.url);
            const method = req.method.toUpperCase();

            // CORS preflight (some axios envs send it).
            if (method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: {
                        'access-control-allow-origin': '*',
                        'access-control-allow-methods': '*',
                        'access-control-allow-headers': '*',
                    },
                });
            }

            const m = matchRoute(routes, method, url.pathname);
            if (!m) {
                return plain(404, { code: 'NOT_FOUND', message: `No route: ${method} ${url.pathname}`, data: null });
            }
            try {
                return await m.handler(req, m.params, ctx);
            } catch (err: any) {
                return plain(500, {
                    code: 'INTERNAL',
                    message: err?.message || String(err),
                    data: null,
                });
            }
        },
        error(err: Error) {
            return plain(500, { code: 'BOOT_ERR', message: err.message, data: null });
        },
    });

    return {
        port: server.port,
        close: async () => {
            await server.stop(true);
        },
    };
}

function matchRoute(routes: RouteEntry[], method: string, pathname: string): MatchedRoute | null {
    for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.pattern.exec(pathname);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { handler: r.handler, params };
    }
    return null;
}
