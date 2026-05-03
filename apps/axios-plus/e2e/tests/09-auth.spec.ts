// auth 插件的浏览器端 e2e —— token 重拿（refresh）的各种成功 / 失败 / 并发场景。
//
// main.ts 把 authPlugin 装在 normalize 后、retry 前；plugin-level 配置：
//   - urlPattern: ['/auth/*']                仅 /auth/* 路径走 auth 流程
//   - tokenManager: 闭包式 ITokenManager 桩  spec 可直接 set / clear
//   - ready: 把 tm.accessToken 写入 Authorization 头
//   - onRefresh: 行为由 window.__http.auth.state.refreshBehavior 切换
//   - onAccessDenied / onAccessExpired: 累计计数到 window.__http.auth.counters
//
// 服务端固定路径：
//   GET /auth/whoami?expect=<tok>   头不匹配 → 401，匹配 → 200
//   GET /auth/expire-once           按 X-Test-Key 隔离；第一次 401，之后 200 + 回显头
//   GET /auth/always-401            永远 401
//   GET /auth/forbidden             永远 403

import { test, expect } from './_fixture';


// ────────────────────────────────────────────────────────────────────────────
//  ① 请求阶段拦截：受保护 + 无 accessToken
// ────────────────────────────────────────────────────────────────────────────

test('未登录访问 /auth/* → 请求阶段被拦，onAccessDenied 调用 + 归一化为失败响应', async ({ page }) => {
    const r = await page.evaluate(async () => {
        // tm 已被 reset，accessToken 为 undefined
        const r = await window.__http.ax.get('/auth/whoami');
        const apiResp = r.data as any;
        return {
            success: apiResp.success,
            status: apiResp.status,
            denied: window.__http.auth.counters.denied,
            expired: window.__http.auth.counters.expired,
            refresh: window.__http.auth.counters.refresh,
        };
    });
    // 关键：onAccessDenied 被调，且由于 auth 在请求阶段就 throw，请求未发到 server。
    // normalize.onRejected 会合成一个 status=0 的 ApiResponse(success=false)。
    expect(r.success).toBe(false);
    expect(r.status).toBe(0);
    expect(r.denied).toBe(1);
    expect(r.expired).toBe(0);
    expect(r.refresh).toBe(0);
});


// ────────────────────────────────────────────────────────────────────────────
//  ② ready hook 注入 Authorization
// ────────────────────────────────────────────────────────────────────────────

test('受保护 + 已登录 → ready hook 把 accessToken 写入 Authorization 头', async ({ page }) => {
    const r = await page.evaluate(async () => {
        window.__http.auth.tm.set('good-token-1', 'r-1');
        const r = await window.__http.ax.get('/auth/whoami?expect=good-token-1');
        const apiResp = r.data as any;
        return {
            success: apiResp.success,
            seenToken: apiResp.data?.token,
            readyValues: window.__http.auth.counters.readyAuthValues.slice(),
        };
    });
    expect(r.success).toBe(true);
    expect(r.seenToken).toBe('good-token-1');
    expect(r.readyValues).toEqual(['good-token-1']);
});


// ────────────────────────────────────────────────────────────────────────────
//  ③ refresh 成功 → 自动用新 token 重放
// ────────────────────────────────────────────────────────────────────────────

test('onFailure → Refresh + onRefresh 成功 → 同 config 自动重放，最终拿到 200', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        // 初始 token 是过期的；server 第一次回 401 → onRefresh → POST /auth/refresh → tm.set(new) → 重放
        window.__http.auth.tm.set('expired-tok', 'r-old');
        const k = 'e2e-auth-refresh-' + Date.now();
        const r = await window.__http.ax.get('/auth/expire-once', {
            headers: { 'X-Test-Key': k },
        } as any);
        const apiResp = r.data as any;
        return {
            success: apiResp.success,
            seenAuth: apiResp.data?.auth,
            attempt: apiResp.data?.attempt,
            refresh: window.__http.auth.counters.refresh,
            expired: window.__http.auth.counters.expired,
            readyValues: window.__http.auth.counters.readyAuthValues.slice(),
            currentToken: window.__http.auth.tm.accessToken,
        };
    });
    expect(r.success).toBe(true);
    expect(r.attempt).toBe(2);
    // 新版：onRefresh 真发 POST /auth/refresh 拿回来的随机 token (`access-N-xxxx`)
    expect(r.seenAuth).toMatch(/^access-/);
    expect(r.refresh).toBe(1);
    expect(r.expired).toBe(0);
    // ready 第一次写旧 token，重放时写从 server 拿的新 token
    expect(r.readyValues[0]).toBe('expired-tok');
    expect(r.readyValues[1]).toMatch(/^access-/);
    expect(r.currentToken).toMatch(/^access-/);
});


// ────────────────────────────────────────────────────────────────────────────
//  ④ refresh 失败（返回 false）→ onAccessExpired + tm.clear
// ────────────────────────────────────────────────────────────────────────────

test('onRefresh 返回 false → onAccessExpired + tokenManager.clear()', async ({ page }) => {
    const r = await page.evaluate(async () => {
        window.__http.auth.tm.set('whatever', 'r');
        window.__http.auth.setBehavior('fail');
        const r = await window.__http.ax.get('/auth/always-401');
        const apiResp = r.data as any;
        return {
            success: apiResp.success,
            status: apiResp.status,
            refresh: window.__http.auth.counters.refresh,
            expired: window.__http.auth.counters.expired,
            denied: window.__http.auth.counters.denied,
            // 关键：refresh 失败后插件自动 clear token
            currentToken: window.__http.auth.tm.accessToken,
        };
    });
    expect(r.success).toBe(false);
    expect(r.status).toBe(401);
    expect(r.refresh).toBe(1);
    expect(r.expired).toBe(1);
    expect(r.denied).toBe(0);
    expect(r.currentToken).toBeUndefined();
});


// ────────────────────────────────────────────────────────────────────────────
//  ⑤ refresh 抛异常 → 同样走 expired
// ────────────────────────────────────────────────────────────────────────────

test('onRefresh 抛异常 → 视同失败：onAccessExpired + tm.clear', async ({ page }) => {
    const r = await page.evaluate(async () => {
        window.__http.auth.tm.set('whatever', 'r');
        window.__http.auth.setBehavior('throw');
        const r = await window.__http.ax.get('/auth/always-401');
        const apiResp = r.data as any;
        return {
            status: apiResp.status,
            refresh: window.__http.auth.counters.refresh,
            expired: window.__http.auth.counters.expired,
            currentToken: window.__http.auth.tm.accessToken,
        };
    });
    expect(r.status).toBe(401);
    expect(r.refresh).toBe(1);
    expect(r.expired).toBe(1);
    expect(r.currentToken).toBeUndefined();
});


// ────────────────────────────────────────────────────────────────────────────
//  ⑥ 并发刷新去重：3 个 401 同时触发 → onRefresh 只跑 1 次
// ────────────────────────────────────────────────────────────────────────────

test('并发受保护请求都触发 401 → onRefresh 仅 1 次（同一 promise 共享）', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        window.__http.auth.tm.set('expired-tok', 'r');
        // 给 onRefresh 留 30ms 窗口让 3 个请求都进入"等 refreshing"分支
        window.__http.auth.setRefreshDelay(30);
        const k = 'e2e-auth-concurrent-' + Date.now();
        const cfg = { headers: { 'X-Test-Key': k } } as any;
        // 3 个并发的 expire-once（共享同一 X-Test-Key → server 第一次才 401，后续 200）
        const responses = await Promise.all([
            window.__http.ax.get('/auth/expire-once', cfg),
            window.__http.ax.get('/auth/expire-once', cfg),
            window.__http.ax.get('/auth/expire-once', cfg),
        ]);
        return {
            successes: responses.map((r) => (r.data as any).success),
            refresh: window.__http.auth.counters.refresh,
            currentToken: window.__http.auth.tm.accessToken,
        };
    });
    // 关键：3 个都最终成功，但 onRefresh 只跑了 1 次
    expect(r.successes).toEqual([true, true, true]);
    expect(r.refresh).toBe(1);
    expect(r.currentToken).toMatch(/^access-/);
});


// ────────────────────────────────────────────────────────────────────────────
//  ⑦ 403 + 已带 token → 默认路由 Refresh → 重放仍 403 → 兜底 expired
// ────────────────────────────────────────────────────────────────────────────

test('403 + 已带 Authorization → 走 refresh，重放仍 403 → 兜底 expired', async ({ page }) => {
    // main.ts 未覆盖 onFailure：默认 DEFAULT_ON_AUTH_FAILURE 路由表中
    // "401/403 + 当时带过 token + 与当前一致 → Refresh"，因此 /auth/forbidden 的 403 走 refresh 流程而非 Deny。
    // 流程：
    //   1. 第一次请求带 'valid-tok' → 403 → onFailure → Refresh → onRefresh OK → tm.set('refreshed-1')
    //   2. 重放 + Authorization='refreshed-1' → 还是 403 → 命中 AUTH_REFRESHED_KEY 兜底分支 → 走 expired
    const r = await page.evaluate(async () => {
        window.__http.auth.tm.set('valid-tok', 'r');
        const r = await window.__http.ax.get('/auth/forbidden');
        const apiResp = r.data as any;
        return {
            status: apiResp.status,
            code: apiResp.code,
            refresh: window.__http.auth.counters.refresh,
            expired: window.__http.auth.counters.expired,
            denied: window.__http.auth.counters.denied,
            currentToken: window.__http.auth.tm.accessToken,
        };
    });
    expect(r.status).toBe(403);
    expect(r.code).toBe('FORBIDDEN');
    expect(r.refresh).toBe(1);
    expect(r.expired).toBe(1);
    expect(r.denied).toBe(0);
    // expired 路径会自动 tm.clear()
    expect(r.currentToken).toBeUndefined();
});




// ────────────────────────────────────────────────────────────────────────────
//  ⑧ 非 /auth/* 路径不走 auth 流程：URLPattern 排除生效
// ────────────────────────────────────────────────────────────────────────────

test('protected:[/auth/*] —— 访问 /ok 时不走 auth 流程，无 Authorization 头', async ({ page }) => {
    const r = await page.evaluate(async () => {
        window.__http.auth.tm.set('should-not-leak', 'r');
        const r = await window.__http.ax.get('/echo');
        const apiResp = r.data as any;
        return {
            success: apiResp.success,
            authHeader: apiResp.data?.headers?.authorization,
            readyValues: window.__http.auth.counters.readyAuthValues.slice(),
        };
    });
    expect(r.success).toBe(true);
    expect(r.authHeader).toBeUndefined();
    // ready hook 完全未触发
    expect(r.readyValues).toEqual([]);
});


// ────────────────────────────────────────────────────────────────────────────
//  ⑨ 请求级 protected:true 覆盖：让本来不在 URL 模式内的路径也走 auth 流程
// ────────────────────────────────────────────────────────────────────────────

test('per-request protected:true 让非 /auth/* 路径也走 auth 流程（无 token → denied）', async ({ page }) => {
    const r = await page.evaluate(async () => {
        // tm 无 token 且 /echo 不在 protected 列表 —— 但请求级覆盖 protected:true
        const r = await window.__http.ax.get('/echo', { protected: true } as any);
        const apiResp = r.data as any;
        return {
            success: apiResp.success,
            status: apiResp.status,
            denied: window.__http.auth.counters.denied,
        };
    });
    expect(r.success).toBe(false);
    expect(r.status).toBe(0);
    expect(r.denied).toBe(1);
});


// ────────────────────────────────────────────────────────────────────────────
//  ⑩ refresh 失败后，并发请求都被中断（不再回退到原响应）
// ────────────────────────────────────────────────────────────────────────────

test('refresh 失败时，等 refreshing 的并发请求一并中断 → 都归一化为 ApiResponse(success=false)', async ({ page, resetServer }) => {
    await resetServer();
    const r = await page.evaluate(async () => {
        window.__http.auth.tm.set('stale', 'r');
        window.__http.auth.setBehavior('fail');
        window.__http.auth.setRefreshDelay(30);
        const responses = await Promise.all([
            window.__http.ax.get('/auth/always-401'),
            window.__http.ax.get('/auth/always-401'),
            window.__http.ax.get('/auth/always-401'),
        ]);
        return {
            successes: responses.map((r) => (r.data as any).success),
            refresh: window.__http.auth.counters.refresh,
            // 三个请求都失败 + refresh 仅 1 次
        };
    });
    expect(r.successes).toEqual([false, false, false]);
    expect(r.refresh).toBe(1);
});
