// @ts-nocheck
/**
 * 独立 mock 服务（零依赖，Node 原生 http）—— 为 e2e 演练场与 Playwright 提供
 * 可控的真实异步 HTTP。手动启动：`node e2e/server/mock-server.mjs`（或 `npm run e2e:server`）。
 *
 * 所有响应默认是后端信封 `{ code, message, data }`，便于演示三种返回形态。
 *
 * 通用查询控制（任意端点可叠加）：
 *   ?delay=ms       延迟响应（演示 loading / cancel / 慢请求）
 *   ?status=NNN     强制 HTTP 状态码
 *   ?code=XXXX      覆盖业务 code（如 5001 → normalize-response 判失败）
 *   ?fail=N         前 N 次（按 id 计数）返回 500，第 N+1 次起成功（演示 retry / share-retry）
 *   ?id=KEY         命中计数 / fail 计数的分组键（默认 'default'）
 *
 * 关键端点：
 *   GET  /api/hit      命中即对 id 计数 +1，返回 { id, hits } —— 用 hits 证明 cache/share 是否真的发了网络
 *   POST /api/echo     回显 body 到 data
 *   GET  /api/echo     回显 query / method / path 到 data
 *   GET  /mock/*       专供 mock 插件重写后的目标，data.mocked=true
 *   ANY  /users/*等    回显最终 path（演示 replace-path-vars 替换结果）
 *   POST /api/hits/reset  清空全部计数器
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 4570;

/** 按 id 记录“真实命中网络”的次数 —— cache 命中/ share 合并的请求不会增加它 */
const hits = Object.create(null);
/** 按 id 记录失败计数，用于 ?fail=N 的递减 */
const fails = Object.create(null);

/** 鉴权：当前服务端有效 token（演示 auth 刷新）。客户端持过期/空 token → 401 → 刷新换取它 */
const AUTH_TOKEN = 'srv-token';
let refreshCount = 0;

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': '*',
    'access-control-allow-headers': '*',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

const envelope = (data, code = '0000', message = 'ok') => ({ code, message, data });

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : undefined); }
      catch { resolve(raw); }
    });
  });

const server = http.createServer(async (req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') return json(res, 204, {});

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const q = url.searchParams;
  const id = q.get('id') || 'default';
  const delay = Number(q.get('delay')) || 0;
  const forcedStatus = q.get('status') ? Number(q.get('status')) : null;
  const forcedCode = q.get('code');
  const failN = Number(q.get('fail')) || 0;

  const finish = async (status, body) => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    json(res, forcedStatus ?? status, body);
  };

  // 计数清零
  if (path === '/api/hits/reset' && req.method === 'POST') {
    for (const k in hits) delete hits[k];
    for (const k in fails) delete fails[k];
    refreshCount = 0;
    return finish(200, envelope({ reset: true }));
  }

  // 受保护资源：Authorization 必须为 `Bearer ${AUTH_TOKEN}`，否则 401（演示 auth 刷新）
  if (path === '/api/secure') {
    hits[id] = (hits[id] || 0) + 1;
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${AUTH_TOKEN}`) {
      return finish(200, envelope({ user: 'u', token: AUTH_TOKEN, hits: hits[id] }));
    }
    return finish(401, envelope(null, '401', 'unauthorized'));
  }

  // 始终拒绝的受保护资源（演示"刷新后 token 仍被拒"的有界收敛：刷一次+重放后过期，不死循环）
  if (path === '/api/secure-dead') {
    hits[id] = (hits[id] || 0) + 1;
    return finish(401, envelope(null, '401', 'always unauthorized'));
  }

  // 刷新令牌：颁发当前有效 token（客户端据此恢复）
  if (path === '/api/refresh' && req.method === 'POST') {
    refreshCount++;
    return finish(200, envelope({ token: AUTH_TOKEN, refreshCount }));
  }

  // 只读当前计数（不增加），供断言
  if (path === '/api/hits' && req.method === 'GET') {
    return finish(200, envelope({ id, hits: hits[id] || 0 }));
  }

  // 命中计数端点：cache/share/retry/loading/cancel 的主力
  if (path === '/api/hit') {
    hits[id] = (hits[id] || 0) + 1;
    if (failN > 0) {
      fails[id] = (fails[id] || 0) + 1;
      if (fails[id] <= failN) {
        return finish(500, envelope(null, '5000', `forced fail ${fails[id]}/${failN}`));
      }
    }
    const body = forcedCode
      ? envelope({ id, hits: hits[id] }, forcedCode, `code=${forcedCode}`)
      : envelope({ id, hits: hits[id] });
    return finish(200, body);
  }

  // 不存在的 mock 路由（演示 mock.fallback：404 → 回落真实接口）。必须先于 /mock 判定。
  if (path.startsWith('/mock-404')) {
    return finish(404, envelope(null, '4040', 'mock route not found'));
  }

  // 网关：mock 未命中时由「服务端」转发到真实上游（mock-or-passthrough），
  // 区别于客户端(axios)回落 —— 更贴近真实 mock 服务的工作方式。
  // `/gw/<realpath>` → 服务端 loopback 转发到 `<realpath>`，并在 query 上打 `_gw=1` 作为转发标记。
  if (path.startsWith('/gw/')) {
    const realPath = path.slice(3); // 去掉 '/gw'
    const fwd = new URL(`http://127.0.0.1:${PORT}${realPath}`);
    for (const [k, v] of q) fwd.searchParams.set(k, v);
    fwd.searchParams.set('_gw', '1'); // 转发标记，证明经由 mock server 转发（非客户端回落）
    const init = { method: req.method, headers: { 'content-type': 'application/json' } };
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = JSON.stringify(await readBody(req));
    const upstream = await fetch(fwd, init);
    const text = await upstream.text();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    return json(res, upstream.status, text ? JSON.parse(text) : {});
  }

  // mock 插件重写后的目标
  if (path.startsWith('/mock')) {
    return finish(200, envelope({ mocked: true, path, query: Object.fromEntries(q) }));
  }

  // echo
  if (path === '/api/echo') {
    const data = {
      method: req.method,
      path,
      query: Object.fromEntries(q),
      body: req.method === 'GET' ? undefined : await readBody(req),
    };
    return finish(200, forcedCode ? envelope(data, forcedCode) : envelope(data));
  }

  // 兜底：回显最终 path（演示 replace-path-vars 的替换结果）
  const data = {
    method: req.method,
    path,
    query: Object.fromEntries(q),
    body: req.method === 'GET' ? undefined : await readBody(req),
  };
  return finish(200, forcedCode ? envelope(data, forcedCode) : envelope(data));
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[mock] listening on http://localhost:${PORT}`);
});
