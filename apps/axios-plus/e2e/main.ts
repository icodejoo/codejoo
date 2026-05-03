/**
 * http-plugins · 浏览器端 E2E 演示
 *
 *   - 全部插件按 use() 顺序装载
 *   - 卡片场景调 axios，请求经 vite dev server proxy 到 Bun mock（/api/* → http://localhost:3030/*）
 *   - 每个卡片 log 区显示请求 / 响应 / 副作用（loading / cancel / cache hit 等）
 */

import axios from 'axios';
import {
    create,
    keyPlugin,
    filterPlugin,
    cachePlugin,
    cancelPlugin,
    cancelAll,
    loadingPlugin,
    mockPlugin,
    normalizePlugin,
    reurlPlugin,
    retryPlugin,
    sharePlugin,
    notificationPlugin,
    rethrowPlugin,
    concurrencyPlugin,
    envsPlugin,
    authPlugin,
    clearCache,
    removeCache,
    ApiResponse,
} from '../src';
import type { ITokenManager } from '../src';


/* ── 全局 axios + Core 装载所有插件 ─────────────────────────────────────── */

const ax = axios.create({ baseURL: '/api' });
const api = create(ax, { debug: true });

/** spec-side buffer：所有 setLoading / notify 调用都顺带 push 一份，便于 page.evaluate 断言 */
const loadingLog: boolean[] = [];
const notifyLog: Array<{ msg: string; ok: boolean; code: string | number }> = [];

/** Loading 全局状态 */
const spinner = document.getElementById('global-spinner')!;
const loadingState = document.getElementById('loading-state')!;
const setLoading = (visible: boolean) => {
    loadingLog.push(visible);
    spinner.classList.toggle('active', visible);
    loadingState.textContent = visible ? '🔄 loading...' : 'idle';
    loadingState.className = visible ? '' : 'muted';
};

/* ── auth testkit ─────────────────────────────────────────────────────────
 *
 * 给 spec 提供一个**行为可控**的 auth 上下文：插件 install 时传入的钩子闭包
 * 都是查 module-level mutable state 决定如何响应。spec 通过 window.__http.auth
 * 切换 behavior / 重置计数器 / 直接读写 tokenManager。
 */
type AuthBehavior = 'ok' | 'fail' | 'throw';

const authState = {
    refreshBehavior: 'ok' as AuthBehavior,
    refreshDelay: 0,                 // 给"并发去重"测试留个 await 窗口
};

const authCounters = {
    refresh: 0,
    denied: 0,
    expired: 0,
    /** ready hook 每次看到的 Authorization 值 —— 验证 stale-token 替换 */
    readyAuthValues: [] as string[],
};

/** 闭包式 ITokenManager —— ITokenManager 把 access/refreshToken 声明为只读 getter，
 *  所以用 IIFE + 私有变量包出 getter/setter，可在内部 `set / clear` 时改写值。 */
const tm: ITokenManager = (() => {
    let access: string | undefined;
    let refresh: string | undefined;
    return {
        canRefresh: true,
        get accessToken() { return access; },
        get refreshToken() { return refresh; },
        set(a, r) { access = a; refresh = r; },
        clear() { access = undefined; refresh = undefined; },
        toHeaders() {
            return access ? { Authorization: access } : undefined;
        },
    };
})();


/** Notification 简易实现：往 hero 里弹一行 + 写 notifyLog（短 TTL 避免视觉残留误导后续 action） */
import type { INotifyHookCtx } from '../src';
const notify = (msg: string, ctx: INotifyHookCtx) => {
    const ok = ctx.apiResp.success;
    notifyLog.push({ msg, ok, code: ctx.apiResp.code });
    const div = document.createElement('div');
    div.dataset.notify = '1';
    div.textContent = `[${ok ? '✓' : '✗'}] ${msg}`;
    div.style.cssText = `position:fixed;top:24px;right:24px;padding:8px 14px;
        background:${ok ? '#21262d' : '#5d2929'};color:#fff;border-radius:5px;
        font-size:13px;z-index:100;animation:fadeOut 1.2s forwards`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1200);
};

api.use([
    // 请求侧
    envsPlugin({
        enable: true,
        default: 'browser',
        rules: [
            { rule: 'browser', config: { /* baseURL 已在 axios.create 中设置 */ } },
        ],
    }),
    filterPlugin({ enable: true }),
    keyPlugin({ enable: true, fastMode: true }),
    reurlPlugin(),
    mockPlugin({ enable: true }),

    // adapter 包装层（最外层 → 内层）
    // enable:false 让 cache 默认 opt-in —— `config.cache===undefined` 的请求不进 cache 路径，
    // 避免每次请求都打一条 "cache skipped: config.key missing" 的 warn 噪音
    // storage: 'localStorage' —— 让磁盘 entry 在 DevTools → Application → Local Storage
    // 直观可见（前缀 `http-plugins:cache:`）。'memeory' 是进程内 JS Map，DevTools 看不到。
    // 各卡片 demo 不显式覆盖 storage 时都走这条默认。
    cachePlugin({ enable: false, ttl: 30_000, storage: 'localStorage' }),
    sharePlugin({ enable: true, policy: 'start' }),
    cancelPlugin({ enable: true }),
    concurrencyPlugin({ enable: true, max: 4 }),
    loadingPlugin({
        enable: true,
        default: false,
        loading: setLoading,
        delay: 200,
        mdt: 500,
    }),

    // 响应侧
    normalizePlugin({
        // 必传：成功裁决函数。本 demo 用业务码 '0000' 命中视为成功
        success: (apiResp) => apiResp.code === '0000',
    }),
    // auth 必须在 normalize 之后（依赖 ApiResponse）；在 retry 之前装让 401/403
    // 自己的 refresh / deny / expired 流程优先于 retry 的指数退避
    authPlugin({
        // 用闭包式 ITokenManager 桩（含 toHeaders）
        tokenManager: tm,
        // 仅 /auth/* 走 auth 流程；其他卡片场景的请求完全不受影响
        // 注意 /auth/refresh 也会命中，所以 onRefresh 内调用时要传 protected:false 单次旁路
        urlPattern: ['/auth/*'],
        ready: (tm, config) => {
            const v = tm.accessToken!;
            authCounters.readyAuthValues.push(v);
            config.headers!.Authorization = v;
        },
        onRefresh: async () => {
            authCounters.refresh++;
            // 关键：所有路径（成功 / fail / throw）都先 sleep refreshDelay。这样 refreshing 字段
            // 在 startOrJoinRefresh 内非 null 的窗口长度 >= refreshDelay，让所有并发的 401 响应都
            // 来得及在 refreshing 还活着时进入 startOrJoinRefresh（共享同一 promise 而非新触发）。
            //
            // 否则 fail/throw 路径完成得太快，3 个 401 的 JS task 调度间隔 (~100ms) 让后续 chain
            // 看到 refreshing 已变 null（因为 finally 已经清掉）→ 重新触发 onRefresh，dedup 失效。
            if (authState.refreshDelay > 0) {
                await new Promise((r) => setTimeout(r, authState.refreshDelay));
            }
            if (authState.refreshBehavior === 'throw') {
                throw new Error('refresh threw (testkit)');
            }
            // 真实发一次 HTTP 到 /auth/refresh —— Network 面板可见这次"换新 token"调用
            // protected:false 让 auth 拦截器跳过本次（避免无限递归）
            try {
                const url = authState.refreshBehavior === 'fail'
                    ? '/auth/refresh?fail=1'   // server 强制 401
                    : '/auth/refresh';
                const resp = await ax.post(
                    url,
                    { refresh_token: tm.refreshToken },
                    { protected: false } as any,
                );
                const data = (resp.data as ApiResponse).data as { access_token?: string; refresh_token?: string } | null;
                if (!data?.access_token) return false;
                tm.set(data.access_token, data.refresh_token);
                return true;
            } catch (e) {
                return false;
            }
        },
        onAccessDenied: async () => { authCounters.denied++; },
        onAccessExpired: async () => { authCounters.expired++; },
    }),
    // max:0 默认关掉重试 —— retry 卡片用 `config.retry: 2` 单次启用。
    // 全局 max>0 会让 auth 的"throw → normalize 合成 status=0 / code=NETWORK_ERR"
    // 被 retry 误判为可重试，导致用空 config 重发。
    retryPlugin({ enable: true, max: 0 }),
    notificationPlugin({
        enable: true,
        notify,
        // messages 是 code/status → 消息 的查找表；default 是兜底
        messages: {
            BIZ_ERR: '业务错',
            HTTP_ERR: '服务异常',
            NETWORK_ERR: '网络异常',
            TIMEOUT_ERR: '超时',
            CANCEL: '已取消',
            default: '请求失败',
        },
    }),
    // demo 模式：默认让失败也 resolve（让所有卡片不需要 try/catch 也能展示响应数据）；
    // 14.x 卡片想演示 reject 时显式传 `rethrow: true` 触发"恢复默认 reject"路径
    rethrowPlugin({
        enable: true,
        shouldRethrow: (_apiResp, _resp, config) =>
            config.rethrow === true ? null /* 走默认 reject */ : false /* 豁免 */,
    }),
]);


/* ── 全局响应日志：所有 ax 走过的请求都打到 DevTools console ───────────────
 *
 * 在 plugin chain 注册之后挂一个最末位 response interceptor —— FIFO 顺序下它最后
 * 触发，因此能看到经 normalize / rethrow / cache / auth 等全部处理完的最终结果。
 * 命中缓存的响应会带 `_cache=true` 标，错误响应（rethrow:true 强制 reject）走 onRejected。
 *
 * **去重**：auth 重放时（如 13.4），外层 chain `return ctx.axios.request(config)` 让外层
 * interceptor 链等内部 chain 的最终 response —— 内部 chain 已经完整跑过这个 printer 一次，
 * 外层再拿到同一个 response 对象会重复打。用 WeakSet 标记已打过的 response，跳过外层重复。
 */
const _printedResponses = new WeakSet<object>();
const _printedRejects = new WeakSet<object>();

ax.interceptors.response.use(
    (response) => {
        if (response && typeof response === 'object') {
            if (_printedResponses.has(response)) return response;
            _printedResponses.add(response);
        }
        const cfg = response.config ?? {};
        const tag = `[ax] ${(cfg.method ?? 'GET').toUpperCase()} ${cfg.url ?? '<no-url>'}`;
        const cached = (response as any)._cache === true;
        console.groupCollapsed(
            `%c${tag}%c ${cached ? '· cache HIT' : `· ${response.status}`}`,
            'color:#22c55e;font-weight:600',
            cached ? 'color:#a78bfa' : 'color:#64748b',
        );
        console.log('config:', { method: cfg.method, url: cfg.url, params: cfg.params, headers: cfg.headers });
        console.log('response.data:', response.data);
        console.log('response.headers:', response.headers);
        if (cached) console.log('_cache: true (没发 HTTP，从共享池还原)');
        console.groupEnd();
        return response;
    },
    (error) => {
        if (error && typeof error === 'object') {
            if (_printedRejects.has(error)) return Promise.reject(error);
            _printedRejects.add(error);
        }
        const cfg = (error as any)?.config ?? {};
        const tag = `[ax] ${(cfg.method ?? 'GET').toUpperCase()} ${cfg.url ?? '<no-url>'}`;
        console.groupCollapsed(
            `%c${tag}%c · REJECTED`,
            'color:#ef4444;font-weight:600',
            'color:#ef4444',
        );
        if (error instanceof ApiResponse) {
            console.log('rejected ApiResponse:', {
                success: error.success,
                code: error.code,
                status: error.status,
                message: error.message,
                data: error.data,
            });
        } else {
            console.log('rejected with:', error);
        }
        console.groupEnd();
        return Promise.reject(error);
    },
);


/* ── 场景注册框架 ───────────────────────────────────────────────────── */

interface Scenario {
    title: string;
    desc: string;
    actions: Array<{ label: string; run: (log: Logger) => Promise<void> | void }>;
}

interface Logger {
    info(msg: string): void;
    ok(msg: string): void;
    warn(msg: string): void;
    err(msg: string): void;
    json(label: string, obj: unknown): void;
    clear(): void;
}

function createCard(scenario: Scenario, cardIdx: number): HTMLElement {
    const card = document.createElement('section');
    card.className = 'card';
    card.id = `card-${cardIdx + 1}`;

    const title = document.createElement('h2');
    // 卡片序号前缀 —— 反馈时可以说 "第 3 张卡片" 或直接 "3.2"
    title.textContent = `${cardIdx + 1}. ${scenario.title}`;
    card.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = scenario.desc;
    card.appendChild(desc);

    const actions = document.createElement('div');
    actions.className = 'actions';
    card.appendChild(actions);

    const logEl = document.createElement('pre');
    logEl.className = 'log';
    logEl.textContent = '(尚未运行)';
    card.appendChild(logEl);

    const log: Logger = {
        info: (m) => append('muted', m),
        ok: (m) => append('ok', `✓ ${m}`),
        warn: (m) => append('warn', `⚠ ${m}`),
        err: (m) => append('err', `✗ ${m}`),
        json: (label, obj) => append('muted', `${label}: ${JSON.stringify(obj, null, 2)}`),
        clear: () => { logEl.textContent = ''; },
    };
    function append(cls: string, text: string) {
        if (logEl.textContent === '(尚未运行)') logEl.textContent = '';
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text + '\n';
        logEl.appendChild(span);
        logEl.scrollTop = logEl.scrollHeight;
    }

    scenario.actions.forEach((action, actionIdx) => {
        const btn = document.createElement('button');
        // 「卡片号.action 号」前缀，反馈时直接说 "3.5 这条不对" 我能秒定位
        const numberTag = `${cardIdx + 1}.${actionIdx + 1}`;
        btn.textContent = `${numberTag} ${action.label}`;
        btn.dataset.cardIdx = String(cardIdx + 1);
        btn.dataset.actionIdx = String(actionIdx + 1);
        btn.onclick = async () => {
            btn.disabled = true;
            // 清屏：把上一次 action 残留的所有 notify toast 一次性移掉，
            // 避免"前一次失败弹窗还在屏幕，误以为本次 action 触发了通知"
            document.querySelectorAll('[data-notify="1"]').forEach((n) => n.remove());
            log.clear();
            log.info(`▶ [${numberTag}] ${action.label}`);
            try {
                await action.run(log);
            } catch (e: any) {
                log.err(`Unexpected: ${e?.message || String(e)}`);
            } finally {
                btn.disabled = false;
            }
        };
        actions.appendChild(btn);
    });

    return card;
}


/* ── 场景实现 ──────────────────────────────────────────────────────── */

const scenarios: Scenario[] = [
    {
        title: 'normalize · 全链路归一化',
        desc: '所有 settle 形态统一为 ApiResponse；下游插件读 response.data: ApiResponse',
        actions: [
            {
                label: '成功响应 (200 + envelope)',
                async run(log) {
                    const r = await ax.get('/pet/42');
                    log.json('response.data instanceof ApiResponse', r.data instanceof ApiResponse);
                    log.json('success', (r.data as ApiResponse).success);
                    log.json('code', (r.data as ApiResponse).code);
                    log.ok('归一化成功');
                },
            },
            {
                label: '业务失败 (code !== 0000)',
                async run(log) {
                    const r = await ax.get('/flaky/biz-error');
                    log.json('success', (r.data as ApiResponse).success);
                    log.json('code', (r.data as ApiResponse).code);
                    log.warn('业务码 BIZ_ERR');
                },
            },
            {
                label: 'HTTP 500',
                async run(log) {
                    const r = await ax.get('/flaky/status?n=99&code=500', {
                        headers: { 'X-Test-Key': 'norm-500-' + Date.now() },
                    } as any);
                    log.json('status', (r.data as ApiResponse).status);
                    log.json('code', (r.data as ApiResponse).code);
                    log.err('HTTP 失败被归一化为 resolve');
                },
            },
            {
                label: '客户端超时 ⇒ code=TIMEOUT_ERR',
                async run(log) {
                    const r = await ax.get('/slow?ms=300', { timeout: 50 } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        code: (r.data as ApiResponse).code,
                    });
                    log.ok('axios timeout 经 normalize 归一为 TIMEOUT_ERR');
                },
            },
            {
                label: '取消请求 ⇒ code=CANCEL',
                async run(log) {
                    const p = ax.get('/slow?ms=2000');
                    await new Promise((r) => setTimeout(r, 50));
                    cancelAll();
                    const r = await p;
                    log.json('apiResp.code', (r.data as ApiResponse).code);
                    log.ok('cancel 也归一化为 ApiResponse(success=false, code=CANCEL)');
                },
            },
            {
                label: '请求级 normalize:false ⇒ 拿原始 envelope',
                async run(log) {
                    const r = await ax.get('/ok', { normalize: false } as any);
                    log.json('isApiResponse', r.data instanceof ApiResponse);
                    log.json('raw envelope', r.data);
                    log.ok('单次旁路 —— response.data 是原始 envelope，不被 ApiResponse 替换');
                },
            },
            {
                label: '请求级 success 函数 ⇒ 完全裁决（其他配置不参与）',
                async run(log) {
                    // /ok 返回 { code:'0000', message:'ok', ... }
                    // 用请求级 success 函数把 message='ok' 视为成功
                    const r = await ax.get('/ok', {
                        normalize: {
                            codeKeyPath: 'message',
                            success: (a: ApiResponse) => a.code === 'ok',
                        },
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        code: (r.data as ApiResponse).code,
                    });
                    log.ok('请求级 success 函数完全裁决，nullable/emptyable 都不参与');
                },
            },
            {
                label: 'success 函数接收 ApiResponse —— .success 入口处为 false',
                async run(log) {
                    // 演示函数能从入参看到 ApiResponse，apiResp.success 在调用时是 false（先假定失败）
                    let seenSuccess: boolean | undefined;
                    const r = await ax.get('/ok', {
                        normalize: {
                            success: (a: ApiResponse) => {
                                seenSuccess = a.success;     // 此时是 false
                                return a.code === '0000';
                            },
                        },
                    } as any);
                    log.json('入参 apiResp.success', seenSuccess);
                    log.json('返回后 apiResp.success', (r.data as ApiResponse).success);
                    log.ok('函数入参时 success 为 false（"先假定失败"）；函数返回值写回');
                },
            },
            {
                label: '插件级 success 默认（code==="0000"）+ data=null ⇒ 仍 success',
                async run(log) {
                    // dataKeyPath 抽不到 → ApiResponse.data === null
                    // 但插件级 success 函数只看 code，不看 data → success=true
                    const r = await ax.get('/ok', {
                        normalize: { dataKeyPath: 'nope.also.missing' },
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        code: (r.data as ApiResponse).code,
                        data: (r.data as ApiResponse).data,
                    });
                    log.ok('插件级 success 函数说怎样就怎样；data=null 默认不影响');
                },
            },
            {
                label: '请求级 nullable:false ⇒ 把 null data 强制视为失败',
                async run(log) {
                    // 顶层 nullable:false 在请求级未传 success 时生效，覆盖插件级 success 的裁决
                    const r = await ax.get('/ok', {
                        normalize: { dataKeyPath: 'nope.also.missing' },
                        nullable: false,
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        data: (r.data as ApiResponse).data,
                    });
                    log.ok('请求级 nullable:false 把 success=true 翻成 false（仅在 data=null 时生效）');
                },
            },
            {
                label: '请求级 nullable:true ⇒ 把 null data 强制视为成功',
                async run(log) {
                    // 假设插件级 success 函数严格要求 data 非 null —— 这里用 normalize.success 模拟
                    const r = await ax.get('/ok', {
                        normalize: {
                            dataKeyPath: 'nope.also.missing',
                        },
                        nullable: true,
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        data: (r.data as ApiResponse).data,
                    });
                    log.ok('请求级 nullable:true 在 data=null 时直接视为成功（覆盖插件级裁决）');
                },
            },
            {
                label: '请求级 emptyable:false ⇒ 空容器视为失败',
                async run(log) {
                    const r = await ax.get('/ok', {
                        normalize: { dataKeyPath: () => ({}) },
                        emptyable: false,
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        data: (r.data as ApiResponse).data,
                    });
                    log.ok('emptyable:false：空对象/数组/串 视为失败');
                },
            },
            {
                label: '请求级 emptyable:true ⇒ 空容器视为成功',
                async run(log) {
                    const r = await ax.get('/ok', {
                        normalize: { dataKeyPath: () => [] },
                        emptyable: true,
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        data: (r.data as ApiResponse).data,
                    });
                    log.ok('emptyable:true：空数组也是成功');
                },
            },
            {
                label: '请求级 success 函数 + nullable:true ⇒ success 函数全权裁决，nullable 被忽略',
                async run(log) {
                    // 请求级 success 函数存在 → nullable/emptyable 都不参与
                    const r = await ax.get('/ok', {
                        normalize: {
                            dataKeyPath: 'nope.also.missing',
                            success: () => false,    // 函数说失败
                        },
                        nullable: true,             // 想覆盖也无效
                    } as any);
                    log.json('apiResp.success', (r.data as ApiResponse).success);
                    log.ok('请求级 success 优先级最高；nullable/emptyable 仅在请求级未传 success 时参与');
                },
            },
        ],
    },
    {
        title: 'cache · 写/读分按钮（直觉化：命中=0 HTTP，HTTP=miss）',
        desc: '默认 storage=localStorage（DevTools → Application → Local Storage 可看到 http-plugins:cache: 前缀 entry）；2.9-2.16 是 4 种 storage 切换演示；label 末尾的 [N HTTP] 是该次点击实测的业务 HTTP 数',
        actions: [
            // ── 基础命中 ──
            {
                label: '🔃 重置：clearCache + 重置 server counter [0 HTTP*]',
                async run(log) {
                    await clearCache();
                    // 这条 reset 是 POST，不是被演示的 GET /seq，不计入"该次点击发的业务 HTTP"
                    await ax.post('/flaky/reset?key=cache-demo');
                    log.ok('已清空：cache 共享池 + server counter（reset POST 不算业务 HTTP）');
                },
            },
            {
                label: '💾 写入 cache-demo [1 HTTP]',
                async run(log) {
                    const r = await ax.get('/seq', {
                        key: 'cache-demo', cache: true,
                        headers: { 'X-Test-Key': 'cache-demo' },
                    } as any);
                    log.json('apiResp', {
                        n: (r.data as any).data?.n,
                        _cache: (r as any)._cache ?? false,
                    });
                    log.ok('miss → 发 1 个 GET /api/seq → 写入 cache');
                },
            },
            {
                label: '📖 读取 cache-demo [0 HTTP]',
                async run(log) {
                    const r = await ax.get('/seq', {
                        key: 'cache-demo', cache: true,
                        headers: { 'X-Test-Key': 'cache-demo' },
                    } as any);
                    log.json('apiResp', {
                        n: (r.data as any).data?.n,
                        _cache: (r as any)._cache ?? false,
                    });
                    if ((r as any)._cache) log.ok('hit → Network 不动 → _cache=true');
                    else log.err('未命中 —— 先去点 💾 写入');
                },
            },
            {
                label: '🗑 移除 cache-demo [0 HTTP]',
                async run(log) {
                    const ok = await removeCache('cache-demo');
                    log.json('removeCache 返回', ok);
                    log.ok('cache-demo 已驱逐 —— 再点 📖 会变 miss + 发 HTTP');
                },
            },
            {
                label: '🧹 clearCache 清空整池 [0 HTTP]',
                async run(log) {
                    const ok = await clearCache();
                    log.json('clearCache 返回', ok);
                    log.ok('共享池已清空');
                },
            },

            // ── TTL ──
            {
                label: '💾 写入 short-ttl (ttl=2000ms) [1 HTTP]',
                async run(log) {
                    const r = await ax.get('/seq', {
                        key: 'cache-ttl', cache: { ttl: 2000 } as any,
                        headers: { 'X-Test-Key': 'cache-ttl' },
                    } as any);
                    log.json('r.n', (r.data as any).data?.n);
                    log.ok('已写入；TTL 100ms 内读取会命中');
                },
            },
            {
                label: '📖 立即读取 short-ttl（2s 内）[0 HTTP]',
                async run(log) {
                    const r = await ax.get('/seq', {
                        key: 'cache-ttl', cache: { ttl: 2000 } as any,
                        headers: { 'X-Test-Key': 'cache-ttl' },
                    } as any);
                    log.json('r._cache', (r as any)._cache);
                    if ((r as any)._cache) log.ok('TTL 内 → hit → 0 HTTP');
                    else log.err('miss —— 写入超过 2s 了或没先点 💾');
                },
            },
            {
                label: '⏰ 等 2.5s 后读 short-ttl [1 HTTP]',
                async run(log) {
                    log.info('等 2.5 秒（> ttl=2000ms）让缓存过期...');
                    await new Promise((r) => setTimeout(r, 2500));
                    const r = await ax.get('/seq', {
                        key: 'cache-ttl', cache: { ttl: 2000 } as any,
                        headers: { 'X-Test-Key': 'cache-ttl' },
                    } as any);
                    log.json('apiResp', {
                        n: (r.data as any).data?.n,
                        _cache: (r as any)._cache ?? false,
                    });
                    log.ok('TTL 已过 → miss → 重新打 server');
                },
            },

            // ── 4 种 storage：每个 storage 写/读分两按钮 ──
            ...(['memeory', 'localStorage', 'ssesionStorage', 'indexdb'] as const)
                .flatMap((kind) => ([
                    {
                        label: `💾 写入 storage=${kind} [1 HTTP]`,
                        async run(log: Logger) {
                            await removeCache(`cache-st-${kind}`);
                            const r = await ax.get('/seq', {
                                key: `cache-st-${kind}`,
                                cache: true,
                                storage: kind,
                                headers: { 'X-Test-Key': `cache-st-${kind}` },
                            } as any);
                            log.json('result', {
                                storage: kind,
                                n: (r.data as any).data?.n,
                                _cache: (r as any)._cache ?? false,
                            });
                            log.ok(`已写入到 ${kind}`);
                        },
                    },
                    {
                        label: `📖 读取 storage=${kind} [0 HTTP]`,
                        async run(log: Logger) {
                            const r = await ax.get('/seq', {
                                key: `cache-st-${kind}`,
                                cache: true,
                                storage: kind,
                                headers: { 'X-Test-Key': `cache-st-${kind}` },
                            } as any);
                            log.json('result', {
                                storage: kind,
                                n: (r.data as any).data?.n,
                                _cache: (r as any)._cache ?? false,
                            });
                            if ((r as any)._cache) log.ok(`hit ${kind} → 0 HTTP`);
                            else log.err(`miss ${kind} —— 先点 💾 写入；或浏览器不支持自动回退到 memory`);
                        },
                    },
                ])),

            // ── memory:true 双层 ──
            {
                label: '💾 写入 memory:true 双层 [1 HTTP]',
                async run(log) {
                    await removeCache('cache-mem');
                    const r = await ax.get('/seq', {
                        key: 'cache-mem',
                        cache: { memory: true } as any,
                        storage: 'localStorage',
                        headers: { 'X-Test-Key': 'cache-mem' },
                    } as any);
                    log.json('r.n', (r.data as any).data?.n);
                    log.ok('已同时写入 内存层 + localStorage 持久层');
                },
            },
            {
                label: '📖 读取 memory:true（命中内存层） [0 HTTP]',
                async run(log) {
                    const t0 = Date.now();
                    const r = await ax.get('/seq', {
                        key: 'cache-mem',
                        cache: { memory: true } as any,
                        storage: 'localStorage',
                        headers: { 'X-Test-Key': 'cache-mem' },
                    } as any);
                    const dt = Date.now() - t0;
                    log.json('result', {
                        n: (r.data as any).data?.n,
                        _cache: (r as any)._cache ?? false,
                        elapsed: dt + 'ms',
                    });
                    if ((r as any)._cache) log.ok(`内存层命中 (${dt}ms，比 storage 更快) → 0 HTTP`);
                    else log.err('miss —— 先点 💾 写入');
                },
            },

            // ── background:true (stale-while-revalidate) ──
            {
                label: '💾 写入 bg-demo [1 HTTP]',
                async run(log) {
                    await removeCache('cache-bg');
                    await ax.post('/flaky/reset?key=cache-bg');
                    const r = await ax.get('/seq', {
                        key: 'cache-bg',
                        cache: { background: true } as any,
                        headers: { 'X-Test-Key': 'cache-bg' },
                    } as any);
                    log.json('r.n', (r.data as any).data?.n);
                    log.ok('已写入；下一步 📖 命中会立即返回旧值，但触发 1 个后台 HTTP 刷新');
                },
            },
            {
                label: '📖 读取 bg-demo (background:true：命中 + 后台刷新) [1 HTTP]',
                async run(log) {
                    const r = await ax.get('/seq', {
                        key: 'cache-bg',
                        cache: { background: true } as any,
                        headers: { 'X-Test-Key': 'cache-bg' },
                    } as any);
                    log.json('apiResp', {
                        n: (r.data as any).data?.n + ' (旧值)',
                        _cache: (r as any)._cache ?? false,
                    });
                    log.info('Network 该看到 1 条 GET —— 那是后台并行刷新（fire-and-forget）');
                    log.ok('background = stale-while-revalidate：业务立即拿旧值，缓存被异步更新');
                },
            },

            // ── methods 白名单 ──
            {
                label: '🚫 POST 不在 methods 白名单 → 不缓存 [2 HTTP]',
                async run(log) {
                    const k = 'cache-post-' + Date.now();
                    const cfg = { key: k, cache: true, headers: { 'X-Test-Key': k } } as any;
                    await ax.post('/flaky/status?n=99&code=500', null, cfg);
                    const r2 = await ax.post('/flaky/status?n=99&code=500', null, cfg);
                    log.json('r2 x-hit-count', r2.headers['x-hit-count']);
                    log.ok('cache 默认 methods=[get,head]；POST 不入 cache → server 看到 2 次');
                },
            },

            // ── give 自定义提取 ──
            {
                label: '🎯 give 自定义投影 写+读 [1 HTTP]',
                async run(log) {
                    const k = 'cache-give-' + Date.now();
                    const cfg = {
                        key: k,
                        cache: {
                            // 注意：give 返回的对象会被还原为 response.data，再经过 normalize 提取 envelope。
                            // 因此返回的对象需要保留 envelope 形态（code/message/data），否则会被 normalize 当成失败。
                            give: (resp: any) => ({
                                code: '0000',
                                message: 'cached + projected',
                                data: { stripped: 'only the n', n: resp.data?.data?.n },
                            }),
                        } as any,
                        headers: { 'X-Test-Key': k },
                    } as any;
                    await ax.get('/seq', cfg);                  // 1 HTTP
                    const r2 = await ax.get('/seq', cfg);       // 0 HTTP（命中）
                    log.json('r2 (从 give 投影还原)', {
                        success: (r2.data as ApiResponse).success,
                        code: (r2.data as ApiResponse).code,
                        message: (r2.data as ApiResponse).message,
                        data: (r2.data as ApiResponse).data,
                    });
                    log.ok('give 自定义"存什么"，命中时直接还原同样的形态');
                },
            },

            // ── 失败响应不缓存 ──
            {
                label: '❌ 失败响应不缓存（连发 2 次都打 server） [2 HTTP]',
                async run(log) {
                    const k = 'cache-fail-' + Date.now();
                    const cfg = { key: k, cache: true, headers: { 'X-Test-Key': k } } as any;
                    await ax.get('/flaky/status?n=99&code=500', cfg);
                    const r2 = await ax.get('/flaky/status?n=99&code=500', cfg);
                    log.json('r2 x-hit-count', r2.headers['x-hit-count']);
                    log.ok('success=false → cache 跳过写入 → server 看到 2 次');
                },
            },
        ],
    },
    {
        title: 'share · 同 key 并发去重',
        desc: 'start 策略：同 key 的并发请求复用同一 promise，HTTP 只发一次',
        actions: [
            {
                label: '3 个 GET 同 key 并发',
                async run(log) {
                    const k = 'share-' + Date.now();
                    const ps = [1, 2, 3].map((i) =>
                        ax.get('/seq', { key: k, share: true, headers: { 'X-Test-Key': k } } as any)
                            .then((r) => log.info(`req#${i} n=${(r.data as any).data.n}`)),
                    );
                    await Promise.all(ps);
                    log.ok('看 n 是否都相同（如 1,1,1）= 共享同一发');
                },
            },
            {
                label: '失败响应也共享（3 个并发都拿同一份失败）',
                async run(log) {
                    const k = 'share-fail-' + Date.now();
                    const cfg = {
                        key: k, share: true,
                        headers: { 'X-Test-Key': k },
                    } as any;
                    const responses = await Promise.all([
                        ax.get('/flaky/status?n=99&code=500', cfg),
                        ax.get('/flaky/status?n=99&code=500', cfg),
                        ax.get('/flaky/status?n=99&code=500', cfg),
                    ]);
                    log.json('hit-counts', responses.map((r) => r.headers['x-hit-count']));
                    log.ok('三个 caller 的 hit-count 都是 1 → 失败也共享');
                },
            },
            {
                label: '不同 key ⇒ 不共享',
                async run(log) {
                    const a = await ax.get('/seq', {
                        key: 'share-diff-A-' + Date.now(),
                        share: true, headers: { 'X-Test-Key': 'share-diff' },
                    } as any);
                    const b = await ax.get('/seq', {
                        key: 'share-diff-B-' + Date.now(),
                        share: true, headers: { 'X-Test-Key': 'share-diff' },
                    } as any);
                    log.json('a.n / b.n', { a: (a.data as any).data.n, b: (b.data as any).data.n });
                    log.ok('key 不同 → 各发各的');
                },
            },
        ],
    },
    {
        title: 'retry · 失败重试 + Retry-After',
        desc: '默认重试网络 / 5xx；可指定 max；支持 Retry-After 头',
        actions: [
            {
                label: '失败 2 次后成功 (n=3 attempts) [3 HTTP]',
                async run(log) {
                    // /flaky/status 用 503（在 retry 默认 status 白名单），retry 才会真触发；
                    // 之前用 /flaky/network 的 stream-error 被 chrome 当成 status 200 + 空 body，
                    // retry 不识别为可重试 → 一次就 settle，看似"一次成功"
                    const key = 'retry-503-' + Date.now();
                    const r = await ax.get('/flaky/status?n=2&code=503', {
                        headers: { 'X-Test-Key': key },
                        retry: 2,
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        hitCount: r.headers['x-hit-count'],
                    });
                    log.ok('Network 应看到 3 个 GET /api/flaky/status：前 2 次 503，第 3 次 200');
                },
            },
            {
                label: '处理 Retry-After',
                async run(log) {
                    const key = 'ra-' + Date.now();
                    const t = Date.now();
                    const r = await ax.get('/flaky/retry-after?seconds=1', {
                        headers: { 'X-Test-Key': key },
                        retry: { max: 2, retryAfterMax: 1500 },
                    } as any);
                    log.json('attempts', (r.data as any).data?.attempts);
                    log.info(`总耗时 ~${Date.now() - t} ms（应 ≥ 1000ms）`);
                },
            },
            {
                label: '默认 max:0 ⇒ 不重试',
                async run(log) {
                    const key = 'no-retry-' + Date.now();
                    const r = await ax.get('/flaky/status?n=2&code=500', {
                        headers: { 'X-Test-Key': key },
                    } as any);
                    log.json('apiResp.success', (r.data as ApiResponse).success);
                    log.json('hit-count', r.headers['x-hit-count']);
                    log.ok('main.ts 改成 max:0 后没启 retry → 第一次失败就 settle');
                },
            },
            {
                label: 'shouldRetry 强制重试业务失败',
                async run(log) {
                    const key = 'biz-retry-' + Date.now();
                    const r = await ax.get('/flaky/biz-flaky?n=2', {
                        headers: { 'X-Test-Key': key },
                        retry: {
                            max: 3,
                            shouldRetry: (apiResp: ApiResponse) =>
                                !apiResp.success ? true : null,
                        },
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        attempts: (r.data as any).data?.attempts,
                    });
                    log.ok('shouldRetry 让业务失败也走重试 → 最终成功');
                },
            },
            {
                label: 'CANCEL 永不重试（即使 shouldRetry=true）',
                async run(log) {
                    const p = ax.get('/slow?ms=2000', {
                        retry: {
                            max: 5,
                            shouldRetry: () => true,
                        },
                    } as any);
                    await new Promise((r) => setTimeout(r, 50));
                    cancelAll();
                    const r = await p;
                    log.json('apiResp', {
                        code: (r.data as ApiResponse).code,
                    });
                    log.ok('cancel 触发 CANCEL → retry 短路（即使 shouldRetry 强制 true）');
                },
            },
            {
                label: 'methods:[post] ⇒ 让 POST 也参与重试',
                async run(log) {
                    const k = 'retry-post-' + Date.now();
                    const r = await ax.post('/flaky/status?n=2&code=500', null, {
                        headers: { 'X-Test-Key': k },
                        retry: { max: 3, methods: ['post'] },
                    } as any);
                    log.json('apiResp.success', (r.data as ApiResponse).success);
                    log.json('hit-count', r.headers['x-hit-count']);
                    log.ok('opt-in POST 重试 → 失败 2 次后第 3 次成功');
                },
            },
            {
                label: '默认 retryOnTimeout:false ⇒ 超时不重试',
                async run(log) {
                    const t = Date.now();
                    const r = await ax.get('/slow?ms=400', {
                        timeout: 50,
                        retry: { max: 3 },
                    } as any);
                    log.json('apiResp.code', (r.data as ApiResponse).code);
                    log.info(`耗时 ~${Date.now() - t}ms（应接近 50ms，未重试）`);
                    log.ok('TIMEOUT_ERR 默认不重试，避免雪崩；retryOnTimeout:true 才会重试');
                },
            },
            {
                label: 'beforeRetry 钩子可拦截',
                async run(log) {
                    const k = 'retry-before-' + Date.now();
                    let calls = 0;
                    const r = await ax.get('/flaky/status?n=5&code=500', {
                        headers: { 'X-Test-Key': k },
                        retry: {
                            max: 5,
                            beforeRetry: (ctx: any) => {
                                calls++;
                                log.info(`beforeRetry: attempt=${ctx.retryCount}`);
                                if (ctx.retryCount >= 2) return false;   // 第 2 次起拦截
                            },
                        },
                    } as any);
                    log.json('result', {
                        success: (r.data as ApiResponse).success,
                        beforeCalls: calls,
                        hitCount: r.headers['x-hit-count'],
                    });
                    log.ok('beforeRetry 返回 false → 取消后续重试，保留当前响应');
                },
            },
        ],
    },
    {
        title: 'cancel · 分组 + cancelAll',
        desc: 'aborter 字段：false / true / "groupName" / AbortController',
        actions: [
            {
                label: 'cancelAll() 清所有在飞',
                async run(log) {
                    const ps = [
                        ax.get('/slow?ms=2000'),
                        ax.get('/slow?ms=2000'),
                    ].map((p, i) =>
                        p.then((r) =>
                            log.info(`req#${i + 1} code=${(r.data as ApiResponse).code}`),
                        ),
                    );
                    await new Promise((r) => setTimeout(r, 50));
                    const n = cancelAll();
                    log.ok(`cancelAll 返回 ${n} 个被中止`);
                    await Promise.all(ps);
                },
            },
            {
                label: '命名分组 cancelAll("auth")',
                async run(log) {
                    const ps = [
                        ax.get('/slow?ms=1500', { aborter: 'auth' } as any),
                        ax.get('/slow?ms=1500', { aborter: 'other' } as any),
                    ].map((p, i) =>
                        p.then((r) =>
                            log.info(`req#${i + 1} code=${(r.data as ApiResponse).code}`),
                        ),
                    );
                    await new Promise((r) => setTimeout(r, 50));
                    const n = cancelAll('auth');
                    log.ok(`仅清 'auth' 组：${n} 个`);
                    await Promise.all(ps);
                },
            },
            {
                label: '自管 AbortController',
                async run(log) {
                    const ctrl = new AbortController();
                    const p = ax.get('/slow?ms=1500', { aborter: ctrl } as any)
                        .then((r) => log.info(`code=${(r.data as ApiResponse).code}`));
                    await new Promise((r) => setTimeout(r, 50));
                    ctrl.abort();
                    log.ok('用户自己持有 ctrl + 主动 abort');
                    await p;
                },
            },
            {
                label: 'aborter:false ⇒ 完全旁路',
                async run(log) {
                    const p = ax.get('/slow?ms=200', { aborter: false } as any);
                    await new Promise((r) => setTimeout(r, 50));
                    const n = cancelAll();
                    log.json('cancelAll 命中', n);
                    const r = await p;
                    log.json('code', (r.data as ApiResponse).code);
                    log.ok('aborter:false 不登记 → cancelAll 抓不到');
                },
            },
        ],
    },
    {
        title: 'loading · delay + mdt',
        desc: '快请求不闪 spinner；慢请求至少显示 500ms',
        actions: [
            {
                label: '快请求 50ms（< delay 200ms，不出现）',
                async run(log) {
                    log.info('观察右上角 spinner —— 应不出现');
                    await ax.get('/slow?ms=50', { loading: true } as any);
                    log.ok('完成');
                },
            },
            {
                label: '慢请求 800ms（出现，至少留 500ms）',
                async run(log) {
                    log.info('观察 spinner —— delay 200ms 后出现');
                    await ax.get('/slow?ms=800', { loading: true } as any);
                    log.ok('完成');
                },
            },
            {
                label: '私有 loading（每请求自管）',
                async run(log) {
                    let on = 0;
                    const fn = (v: boolean) => {
                        log.info(`私有 cb(${v})`);
                        if (v) on++;
                    };
                    await ax.get('/slow?ms=300', { loading: fn } as any);
                    log.ok(`私有触发次数 on=${on}`);
                },
            },
        ],
    },
    {
        title: 'concurrency · 限流 + priority',
        desc: 'max=4，超出排队；priority 跳队',
        actions: [
            {
                label: '6 个并发，max=4 ⇒ 后 2 个排队',
                async run(log) {
                    const t = Date.now();
                    const ps = Array.from({ length: 6 }, (_, i) =>
                        ax.get(`/slow?ms=400`, { headers: { 'X-Test-Key': `c${i}` } })
                            .then(() => log.info(`req#${i + 1} done @${Date.now() - t}ms`)),
                    );
                    await Promise.all(ps);
                    log.ok('观察 done 时序：前 4 个 ~400ms，后 2 个 ~800ms');
                },
            },
            {
                label: 'priority=10 跳队',
                async run(log) {
                    // 先打满槽位
                    const filler = Array.from({ length: 4 }, (_, i) =>
                        ax.get(`/slow?ms=600`, { headers: { 'X-Test-Key': `f${i}` } }),
                    );
                    await new Promise((r) => setTimeout(r, 50));
                    const t = Date.now();
                    const lo = ax.get('/slow?ms=200', { headers: { 'X-Test-Key': 'lo' }, priority: 1 } as any)
                        .then(() => log.info(`低优 done @${Date.now() - t}ms`));
                    const hi = ax.get('/slow?ms=200', { headers: { 'X-Test-Key': 'hi' }, priority: 10 } as any)
                        .then(() => log.info(`高优 done @${Date.now() - t}ms`));
                    await Promise.all([...filler, lo, hi]);
                    log.ok('高优先级应早于低优 ~200ms');
                },
            },
            {
                label: 'config.concurrency:false ⇒ 单次绕过队列',
                async run(log) {
                    const t = Date.now();
                    // 先打满 4 槽
                    const filler = Array.from({ length: 4 }, (_, i) =>
                        ax.get(`/slow?ms=500`, { headers: { 'X-Test-Key': `bp${i}` } }),
                    );
                    await new Promise((r) => setTimeout(r, 50));
                    const bypass = ax.get('/slow?ms=100', {
                        headers: { 'X-Test-Key': 'bypass' },
                        concurrency: false,
                    } as any).then(() => log.info(`bypass done @${Date.now() - t}ms`));
                    await Promise.all([...filler, bypass]);
                    log.ok('concurrency:false 不入队 → 即时发，约 ~150ms 内完成');
                },
            },
            {
                label: '失败/取消也释放槽位',
                async run(log) {
                    const filler = Array.from({ length: 3 }, (_, i) =>
                        ax.get('/slow?ms=600', { headers: { 'X-Test-Key': `rel${i}` } }),
                    );
                    // 第 4 个故意 cancel
                    const canceller = ax.get('/slow?ms=600', { headers: { 'X-Test-Key': 'cancel-me' } });
                    await new Promise((r) => setTimeout(r, 50));
                    cancelAll();   // 把所有都 cancel
                    log.info('已 cancelAll —— 验证后续请求仍能拿到槽');
                    const next = await ax.get('/slow?ms=50', { headers: { 'X-Test-Key': 'after' } });
                    log.json('after.success', (next.data as ApiResponse).success);
                    await Promise.all([...filler, canceller]);
                    log.ok('cancel 不会卡死队列（settle 都会释放槽）');
                },
            },
            {
                label: 'methods 白名单 ⇒ 不在白名单的方法不计入并发',
                async run(log) {
                    // main.ts 默认 methods=undefined（所有方法都计入）。
                    // 这里通过 per-request `concurrency: { methods: ['get'] }` 让本次 POST 不入队
                    const t = Date.now();
                    // 先打满 4 个 GET 槽
                    const filler = Array.from({ length: 4 }, (_, i) =>
                        ax.get('/slow?ms=400', { headers: { 'X-Test-Key': `mf${i}` } }),
                    );
                    await new Promise((r) => setTimeout(r, 30));
                    // POST 在白名单外 → 立即放行
                    const postR = ax.post('/echo', null, {
                        headers: { 'X-Test-Key': 'm-post' },
                        concurrency: { methods: ['get'] },
                    } as any).then(() => log.info(`POST done @${Date.now() - t}ms`));
                    await Promise.all([...filler, postR]);
                    log.ok('per-request methods=[get] 让 POST 不计入 → 不必等槽');
                },
            },
        ],
    },
    {
        title: 'reurl · 路径参数替换 + 分隔符规整',
        desc: '{var} / [var] / :var 三种语法；从 params/data 取值；removeKey 自动清字段',
        actions: [
            {
                label: '/pet/{petId} 从 params',
                async run(log) {
                    const r = await ax.get('/pet/{petId}', { params: { petId: 7 } });
                    log.json('url 实际命中 (server-side echo)', (r.data as any).data?.id);
                    log.ok('url 中 {petId} 被替换为 7');
                },
            },
            {
                label: '[id] 风格',
                async run(log) {
                    const r = await ax.get('/pet/[id]', { params: { id: 11 } } as any);
                    log.json('id', (r.data as any).data?.id);
                    log.ok('[id] 也被替换');
                },
            },
            {
                label: ':id 风格',
                async run(log) {
                    const r = await ax.get('/pet/:id', { params: { id: 22 } } as any);
                    log.json('id', (r.data as any).data?.id);
                    log.ok(':id 也被替换');
                },
            },
            {
                label: 'removeKey:true ⇒ params 中已替换字段被删除',
                async run(log) {
                    const params: any = { petId: 33, keepMe: 'yes' };
                    await ax.get('/pet/{petId}', { params, filter: false } as any);
                    log.json('params after request', params);
                    log.ok('petId 被删；keepMe 保留');
                },
            },
            {
                label: '从 data (POST body) 取变量',
                async run(log) {
                    const r = await ax.post('/pet/{petId}', { petId: 99, name: 'doge' } as any);
                    log.json('server saw id', (r.data as any).data?.id);
                    log.ok('params 没匹到 → 退回 data 取值');
                },
            },
        ],
    },
    {
        title: 'filter · 空字段过滤',
        desc: '默认丢弃 null / undefined / NaN / 空白字符串；ignoreKeys 豁免',
        actions: [
            {
                label: '过滤 params 后只剩有效字段',
                async run(log) {
                    const r = await ax.get('/echo', {
                        filter: true,
                        params: { a: 1, b: null, c: '', d: 'ok', e: undefined },
                    } as any);
                    log.json('server saw query', (r.data as any).data?.query);
                    log.ok('null / "" / undefined 已被过滤');
                },
            },
            {
                label: 'ignoreKeys 豁免某些字段',
                async run(log) {
                    const r = await ax.get('/echo', {
                        filter: { ignoreKeys: ['keepEmpty'] } as any,
                        params: { keepEmpty: '', drop: '', real: 'x' },
                    } as any);
                    log.json('server saw query', (r.data as any).data?.query);
                    log.ok('keepEmpty 即使是 "" 也保留；drop 被过滤');
                },
            },
            {
                label: 'filter:false ⇒ 不过滤（默认行为）',
                async run(log) {
                    const r = await ax.get('/echo', {
                        params: { keep: 'x', empty: '' },
                        // 不传 filter 字段 → 默认不过滤
                    });
                    log.json('server saw query', (r.data as any).data?.query);
                    log.ok('未 opt-in filter ⇒ 原样发送');
                },
            },
            {
                label: 'predicate 自定义"是否丢弃"',
                async run(log) {
                    // 把所有 value 长度 > 3 的字段丢掉
                    const r = await ax.get('/echo', {
                        filter: {
                            predicate: (_k: string, v: unknown) =>
                                typeof v === 'string' && v.length > 3,
                        } as any,
                        params: { ok: 'a', long: 'verylong', mid: 'ab' },
                    } as any);
                    log.json('server saw query', (r.data as any).data?.query);
                    log.ok('predicate 返回 true 的条目被丢弃');
                },
            },
            {
                label: 'ignoreValues 豁免特定值',
                async run(log) {
                    // 默认 filter 把 0 / NaN / "" 都丢；用 ignoreValues 让 0 保留
                    const r = await ax.get('/echo', {
                        filter: { ignoreValues: [0] } as any,
                        params: { keep0: 0, empty: '', alive: 'x' },
                    } as any);
                    log.json('server saw query', (r.data as any).data?.query);
                    log.ok('0 被 ignoreValues 豁免');
                },
            },
        ],
    },
    {
        title: 'mock · URL 重写 (dev only)',
        desc: 'config.mock=true → 把请求路径前缀重写到 mockUrl（不是合成响应）',
        actions: [
            {
                label: '插件级无 mockUrl ⇒ no-op + 控制台 warn',
                async run(log) {
                    log.info('当前 main.ts: mockPlugin({ enable: true })，没传 mockUrl');
                    const r = await ax.get('/pet/42', { mock: true } as any);
                    log.json('id', (r.data as any).data?.id);
                    log.ok('mock skip + 请求照常打到 /api/pet/42（看 console warn）');
                },
            },
            {
                label: '请求级 mock:{ mockUrl } ⇒ URL 改写',
                async run(log) {
                    // 把 /pet/42 重写到一个不可达的 mockUrl，预期网络失败
                    // 用 39998 端口（绕开 chromium 的 ERR_UNSAFE_PORT 黑名单 —— port 0 / 1 / 7 等被拦）
                    log.info('mockUrl 指向不可达地址，验证 URL 真的被改写');
                    const t = Date.now();
                    const r = await ax.get('/pet/42', {
                        mock: { mockUrl: 'http://127.0.0.1:39998' } as any,
                        timeout: 1000,                             // 不让 demo 卡很久
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        code: (r.data as ApiResponse).code,
                    });
                    log.info(`耗时 ~${Date.now() - t}ms`);
                    log.ok('URL 改写到 mockUrl，目标不可达 → NETWORK/TIMEOUT_ERR');
                },
            },
        ],
    },
    {
        title: 'key · key 计算',
        desc: 'key=true 自动生成；fastMode/ignoreKeys/ignoreValues/before/after 钩子',
        actions: [
            {
                label: 'key:true ⇒ 自动生成 + 同参 key 一致（驱动 cache）',
                async run(log) {
                    // 走 cache 路径才能可视化 —— 同参第二次应该 hit
                    await clearCache();
                    const cfg = { key: true, cache: true, params: { a: 1, b: 'x' } } as any;
                    const r1 = await ax.get('/seq', { ...cfg, headers: { 'X-Test-Key': 'k-auto' } });
                    const r2 = await ax.get('/seq', { ...cfg, headers: { 'X-Test-Key': 'k-auto' } });
                    log.json('result', {
                        r1n: (r1.data as any).data?.n,
                        r2n: (r2.data as any).data?.n,
                        r2Cache: (r2 as any)._cache,
                    });
                    log.ok('key:true 算同参 hash → 第 2 次 cache 命中');
                },
            },
            {
                label: 'key:"deep" ⇒ 深哈希（fastMode 关掉）',
                async run(log) {
                    await clearCache();
                    const cfg = { key: 'deep' as const, cache: true, params: { x: { y: 1 } } } as any;
                    const r1 = await ax.get('/seq', { ...cfg, headers: { 'X-Test-Key': 'k-deep' } });
                    const r2 = await ax.get('/seq', { ...cfg, headers: { 'X-Test-Key': 'k-deep' } });
                    log.json('r2._cache', (r2 as any)._cache);
                    log.ok('"deep" 强制完整对象哈希；params 内容相同 → 命中');
                    void r1;
                },
            },
            {
                label: 'key:对象 ignoreKeys ⇒ 字段被排除参与哈希',
                async run(log) {
                    await clearCache();
                    // 两次请求 timestamp 不同，但 key 哈希忽略 timestamp → key 一致 → cache 命中
                    const r1 = await ax.get('/seq', {
                        cache: true,
                        key: { ignoreKeys: ['ts'] } as any,
                        params: { a: 1, ts: Date.now() },
                        headers: { 'X-Test-Key': 'k-ig' },
                    } as any);
                    await new Promise((r) => setTimeout(r, 5));
                    const r2 = await ax.get('/seq', {
                        cache: true,
                        key: { ignoreKeys: ['ts'] } as any,
                        params: { a: 1, ts: Date.now() },
                        headers: { 'X-Test-Key': 'k-ig' },
                    } as any);
                    log.json('result', {
                        r1n: (r1.data as any).data?.n,
                        r2n: (r2.data as any).data?.n,
                        r2Cache: (r2 as any)._cache,
                    });
                    log.ok('ts 字段虽变但被 ignoreKeys 排除 → 同 key → 命中');
                },
            },
            {
                label: 'key:函数 ⇒ 自定义计算',
                async run(log) {
                    await clearCache();
                    const cfg = {
                        cache: true,
                        key: (c: any) => `manual::${c.method}::${c.url}`,
                        headers: { 'X-Test-Key': 'k-fn' },
                    } as any;
                    const r1 = await ax.get('/seq', cfg);
                    const r2 = await ax.get('/seq', cfg);
                    log.json('r2._cache', (r2 as any)._cache);
                    log.ok('函数返回自己的 key 字符串');
                    void r1;
                },
            },
        ],
    },
    {
        title: 'envs · 环境配置',
        desc: 'install 时按 default 选择器 → rules 查命中规则，浅合并到 axios.defaults',
        actions: [
            {
                label: '查看当前 axios.defaults.baseURL',
                async run(log) {
                    log.json('baseURL', ax.defaults.baseURL);
                    log.info('init 时 envs 已合并配置');
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────────────────
    //  auth · token 重拿全场景（行为由 testkit 切换，详见顶部 authState）
    // ───────────────────────────────────────────────────────────────────────

    {
        title: 'auth · token 重拿全场景（真实 refresh API + 并发 + 网络延迟）',
        desc: 'onRefresh 真发 POST /auth/refresh；GET /auth/check 按 Authorization 头判断（不靠计数器）；?delay/?jitter 模拟乱序；先点 13.1 重置',
        actions: [
            {
                label: '重置 auth 状态 + 清空 server 端 validTokens 集合 [1 HTTP]',
                async run(log) {
                    authState.refreshBehavior = 'ok';
                    authState.refreshDelay = 0;
                    authCounters.refresh = 0;
                    authCounters.denied = 0;
                    authCounters.expired = 0;
                    authCounters.readyAuthValues.length = 0;
                    tm.clear();
                    // 清掉 server 端"当前有效 token 集合"，让所有 /auth/check 都 401
                    await ax.post('/auth/revoke-all', null, { protected: false } as any);
                    log.ok('已重置 client + server；现在没有任何 token 是有效的');
                },
            },
            {
                label: '① 未登录访问 /auth/whoami → 请求阶段 onAccessDenied [0 HTTP]',
                async run(log) {
                    tm.clear();
                    const denied0 = authCounters.denied;
                    const r = await ax.get('/auth/whoami');
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        status: (r.data as ApiResponse).status,
                        code: (r.data as ApiResponse).code,
                    });
                    log.json('denied++', authCounters.denied - denied0);
                    log.ok('tm 无 token + protected → 请求阶段 throw → 不发 HTTP');
                },
            },
            {
                label: '② 有 token → ready 注入 Authorization [1 HTTP]',
                async run(log) {
                    tm.set('good-token-1', 'r-1');
                    const r = await ax.get('/auth/whoami?expect=good-token-1');
                    log.json('server saw token', (r.data as any).data?.token);
                    log.json('ready writes', authCounters.readyAuthValues);
                    log.ok('Network 看到 1 条 GET，请求头里有 Authorization=good-token-1');
                },
            },

            // ── ③④⑤ 并发场景：3 个同时 401 → 1 次 refresh → 全部重放 ──
            {
                label: '③ 3 并发 401 → 真 POST /auth/refresh 成功 → 全部重放成功 [4-7 HTTP]',
                async run(log) {
                    tm.set('expired-token-A', 'r-old-A');           // client 端塞个旧 token
                    authState.refreshBehavior = 'ok';
                    authState.refreshDelay = 100;                    // refresh API 也要 100ms
                    const refresh0 = authCounters.refresh;
                    const ready0 = authCounters.readyAuthValues.length;
                    log.info('Network 应依次看到：3×GET /auth/check 401 → 1×POST /auth/refresh 200 → 3×GET /auth/check 200');
                    const t0 = Date.now();
                    // 加 ?delay=200&jitter=150 让 3 个请求分散到 200-350ms 之间，乱序到达
                    const responses = await Promise.all([
                        ax.get('/auth/check?delay=200&jitter=150'),
                        ax.get('/auth/check?delay=200&jitter=150'),
                        ax.get('/auth/check?delay=200&jitter=150'),
                    ]);
                    log.json('result', {
                        elapsed: (Date.now() - t0) + 'ms',
                        successes: responses.map((r) => (r.data as ApiResponse).success),
                        seenTokens: responses.map((r) => (r.data as any).data?.token),
                        refreshCalls: authCounters.refresh - refresh0,
                        readyCalls: authCounters.readyAuthValues.length - ready0,
                        currentToken: tm.accessToken,
                    });
                    log.ok('refresh 仅 1 次（共享 promise）；ready 触发 6 次（3 旧 + 3 新）；3 个 caller 都成功');
                    authState.refreshDelay = 0;
                },
            },

            {
                label: '④ 3 并发 401 → POST /auth/refresh 返回 401 → 全部 expired [4 HTTP]',
                async run(log) {
                    await ax.post('/auth/revoke-all', null, { protected: false } as any);
                    tm.set('expired-B', 'r-fail-B');
                    authState.refreshBehavior = 'fail';
                    authState.refreshDelay = 400;          // refreshing 窗口 ≥ 400ms，足够 3 个 401 都进
                    const expired0 = authCounters.expired;
                    log.info('Network 应看到：3×GET /auth/check 401 → 仅 1×POST /auth/refresh?fail=1 401（dedup）');
                    const responses = await Promise.all([
                        ax.get('/auth/check?delay=80'),
                        ax.get('/auth/check?delay=80'),
                        ax.get('/auth/check?delay=80'),
                    ]);
                    log.json('result', {
                        successes: responses.map((r) => (r.data as ApiResponse).success),
                        codes: responses.map((r) => (r.data as ApiResponse).code),
                        expiredDelta: authCounters.expired - expired0,
                        currentToken: tm.accessToken ?? 'undefined (cleared)',
                    });
                    log.ok('refresh 失败 → 3 个并发请求都中断；tm.clear() + onAccessExpired 触发');
                    authState.refreshBehavior = 'ok';
                    authState.refreshDelay = 0;
                },
            },

            {
                label: '⑤ 3 并发 401 → onRefresh 钩子抛错 → 全部 expired [3 HTTP]',
                async run(log) {
                    await ax.post('/auth/revoke-all', null, { protected: false } as any);
                    tm.set('expired-C', 'r-throw-C');
                    authState.refreshBehavior = 'throw';
                    authState.refreshDelay = 400;          // refreshing 窗口 ≥ 400ms 让 dedup 工作
                    const expired0 = authCounters.expired;
                    log.info('onRefresh 钩子抛错（不发 refresh HTTP）→ Network 只看到 3×GET /auth/check 401');
                    const responses = await Promise.all([
                        ax.get('/auth/check?delay=80'),
                        ax.get('/auth/check?delay=80'),
                        ax.get('/auth/check?delay=80'),
                    ]);
                    log.json('result', {
                        successes: responses.map((r) => (r.data as ApiResponse).success),
                        expiredDelta: authCounters.expired - expired0,
                        currentToken: tm.accessToken ?? 'undefined',
                    });
                    log.ok('钩子抛错 → 视同失败 → 3 个 caller 都 expired');
                    authState.refreshBehavior = 'ok';
                    authState.refreshDelay = 0;
                },
            },

            // ── 并发去重断言（核心场景）──
            {
                label: '⑥ 5 并发 401 + jitter 乱序 → onRefresh 仅 1 次（共享同一 promise） [6 HTTP]',
                async run(log) {
                    await ax.post('/auth/revoke-all', null, { protected: false } as any);
                    tm.set('expired-D', 'r-dedup-D');
                    authState.refreshBehavior = 'ok';
                    authState.refreshDelay = 500;            // refreshing 窗口 ≥ 500ms，让 5 个并发都能 join
                    const refresh0 = authCounters.refresh;
                    log.info('5 并发 + delay=100ms&jitter=200ms 乱序到达 + refresh 500ms 窗口');
                    const t0 = Date.now();
                    const responses = await Promise.all([1, 2, 3, 4, 5].map(() =>
                        ax.get('/auth/check?delay=100&jitter=200'),
                    ));
                    log.json('result', {
                        elapsed: (Date.now() - t0) + 'ms',
                        successes: responses.map((r) => (r.data as ApiResponse).success),
                        refreshCalls: authCounters.refresh - refresh0,    // **必须是 1**
                    });
                    if (authCounters.refresh - refresh0 === 1) log.ok('5 个并发只触发 1 次 refresh —— 完美去重');
                    else log.err(`refresh 触发了 ${authCounters.refresh - refresh0} 次（应该是 1）`);
                    authState.refreshDelay = 0;
                },
            },

            // ── 403 路径 ──
            {
                label: '⑦ 403 + 已带 Auth → 走 refresh → 重放仍 403 → 兜底 expired [3 HTTP]',
                async run(log) {
                    // /auth/forbidden 永远 403，无论 token 如何
                    tm.set('any-valid', 'r-fb');
                    authState.refreshBehavior = 'ok';
                    const refresh0 = authCounters.refresh;
                    const expired0 = authCounters.expired;
                    log.info('Network: 1×GET /auth/forbidden 403 → 1×POST /auth/refresh 200 → 1×重放 GET 403');
                    const r = await ax.get('/auth/forbidden');
                    log.json('result', {
                        status: (r.data as ApiResponse).status,
                        code: (r.data as ApiResponse).code,
                        refreshDelta: authCounters.refresh - refresh0,
                        expiredDelta: authCounters.expired - expired0,
                        currentToken: tm.accessToken ?? 'undefined',
                    });
                    log.ok('AUTH_REFRESHED_KEY 防回环 → 二次 403 走 expired 路径');
                },
            },

            // ── URLPattern 排除 + per-request 覆盖 ──
            {
                label: '⑧ /echo 不在 protected ⇒ 不走 auth、不带 Authorization [1 HTTP]',
                async run(log) {
                    tm.set('should-not-leak', 'r');
                    const ready0 = authCounters.readyAuthValues.length;
                    const r = await ax.get('/echo');
                    log.json('server saw authorization', (r.data as any).data?.headers?.authorization ?? '<none>');
                    log.json('ready 触发次数', authCounters.readyAuthValues.length - ready0);
                    log.ok('URLPattern 排除生效；token 没泄漏到非 /auth/* 路径');
                },
            },
            {
                label: '⑨ per-request protected:true 强制走 auth（无 token → denied） [0 HTTP]',
                async run(log) {
                    tm.clear();
                    const denied0 = authCounters.denied;
                    const r = await ax.get('/echo', { protected: true } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        status: (r.data as ApiResponse).status,
                    });
                    log.json('denied++', authCounters.denied - denied0);
                    log.ok('请求级 protected:true 覆盖插件级 → 请求阶段 throw');
                },
            },

            // ── stale-token 替换（场景 6）──
            {
                label: '⑩ refresh 完成后才返回的"旧 token 响应" → stale 重放（不再触发 refresh） [5 HTTP, 慢请求 3s 后 settle]',
                async run(log) {
                    await ax.post('/auth/revoke-all', null, { protected: false } as any);
                    tm.set('outdated-1', 'r-stale-1');
                    authState.refreshBehavior = 'ok';
                    authState.refreshDelay = 50;
                    const refresh0 = authCounters.refresh;
                    log.info('快慢两个请求并发：');
                    log.info('  快(100ms): 401 → 触发 refresh(~50ms) → 用新 token 重放 → 200');
                    log.info('  慢(3000ms): 3s 后 server 才返回 401，那时 tm 已是新 token →');
                    log.info('             reqToken("outdated-1") ≠ curToken(新 access-X) → STALE 路径 → 直接重放，不再 refresh');
                    log.info('需要等 ~3.x 秒看到全部结果...');
                    const t0 = Date.now();
                    await Promise.all([
                        ax.get('/auth/check?delay=100'),
                        ax.get('/auth/check?delay=3000'),    // ← 拉到 3 秒，让 stale 时差极明显
                    ]);
                    log.json('result', {
                        elapsed: (Date.now() - t0) + 'ms',
                        refreshCalls: authCounters.refresh - refresh0,
                        currentToken: tm.accessToken,
                    });
                    if (authCounters.refresh - refresh0 === 1) {
                        log.ok('refresh 仅 1 次 + 慢请求被识别为 stale 直接重放（不再触发新 refresh）');
                    } else {
                        log.err(`refresh 触发了 ${authCounters.refresh - refresh0} 次，应为 1`);
                    }
                    authState.refreshDelay = 0;
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────────────────
    //  rethrow · success=false → reject 裁决
    // ───────────────────────────────────────────────────────────────────────

    {
        title: 'rethrow · 把失败响应重新 reject（不改变成功响应行为）',
        desc: '契约：apiResp.success===true ⇒ 永远 Promise.resolve（不动）；apiResp.success===false ⇒ 默认 Promise.reject。配置只影响"失败要不要 reject"',
        actions: [
            {
                label: '业务成功 ⇒ Promise.resolve（默认） [1 HTTP, 200]',
                async run(log) {
                    const r = await ax.get('/ok');
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        code: (r.data as ApiResponse).code,
                    });
                    log.ok('Promise 走 .then —— 成功响应不被 rethrow 改动');
                },
            },
            {
                label: '业务失败 + rethrow:true ⇒ Promise.reject [1 HTTP, 200]',
                async run(log) {
                    // 注：本 demo 的 rethrow 全局装了 shouldRethrow 默认豁免（让其他卡片
                    // 不需要 try/catch），所以这里要 rethrow:true 才回到"失败默认 reject"路径。
                    // 真实业务装 rethrow 时通常不传 shouldRethrow，所有失败默认就走 .catch。
                    try {
                        await ax.get('/flaky/biz-error', { rethrow: true } as any);
                        log.err('应该走 .catch，没走');
                    } catch (e: any) {
                        log.json('caught (.catch)', {
                            isApiResponse: e instanceof ApiResponse,
                            success: e?.success,
                            code: e?.code,
                        });
                        log.ok('apiResp.success=false → caller 走 .catch 拿到 ApiResponse');
                    }
                },
            },
            {
                label: '业务成功 + config.rethrow=true ⇒ 仍 resolve（契约不可破） [1 HTTP, 200]',
                async run(log) {
                    // 即便用户传 rethrow:true，rethrow 也不会改变成功响应的行为 —— 这是契约
                    const r = await ax.get('/ok', { rethrow: true } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        code: (r.data as ApiResponse).code,
                    });
                    log.ok('rethrow:true 对 success===true 无作用 —— 仍走 .then');
                },
            },
            {
                label: '业务失败 + config.rethrow=false ⇒ 单次豁免，resolve [1 HTTP, 200]',
                async run(log) {
                    // 非关键请求（如埋点 / 心跳）业务侧不想 try/catch，单次让失败也 resolve
                    const r = await ax.get('/flaky/biz-error', { rethrow: false } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        code: (r.data as ApiResponse).code,
                    });
                    log.ok('rethrow:false 让本次失败也 resolve（caller 自己看 apiResp.success）');
                },
            },
            {
                label: 'data=null + nullable:true ⇒ success=true → resolve（契约不动成功） [1 HTTP, 200]',
                async run(log) {
                    // nullable 已从 rethrow 移到 normalize：让 normalize 标 success=true，
                    // rethrow 看到成功就完全不动 —— 这才是契约的工作方式
                    const r = await ax.get('/ok', {
                        normalize: { dataKeyPath: 'nonexistent' },
                        nullable: true,
                    } as any);
                    log.json('apiResp', {
                        success: (r.data as ApiResponse).success,
                        data: (r.data as ApiResponse).data,
                    });
                    log.ok('normalize 标 success=true → rethrow 不动 → resolve');
                },
            },
        ],
    },

    // ───────────────────────────────────────────────────────────────────────
    //  notification · 弹通知（依赖 normalize）
    // ───────────────────────────────────────────────────────────────────────

    {
        title: 'notification · 失败弹通知',
        desc: 'success=false 时按 messages 表查 code/status，default 兜底；每个按钮 label 末尾标了该次点击触发的真实业务 HTTP 数 + status，比对 Network 面板',
        actions: [
            {
                label: '业务失败 ⇒ 命中 BIZ_ERR 文案 [1 HTTP, 200]',
                async run(log) {
                    const before = notifyLog.length;
                    // /flaky/biz-error 是 HTTP 200，业务 envelope code=BIZ_ERR
                    const r = await ax.get('/flaky/biz-error');
                    const fired = notifyLog.slice(before);
                    log.json('apiResp', { status: (r.data as ApiResponse).status, code: (r.data as ApiResponse).code });
                    log.json('notify 调用', fired);
                    log.ok('HTTP 200 + biz code=BIZ_ERR → 弹"业务错"');
                },
            },
            {
                label: 'HTTP 500 ⇒ 命中 default 兜底 [1 HTTP, 500]',
                async run(log) {
                    const before = notifyLog.length;
                    // /flaky/status?code=500 是 HTTP 500，envelope code=SERVER_ERR
                    const r = await ax.get('/flaky/status?n=99&code=500', {
                        headers: { 'X-Test-Key': 'notif-500-' + Date.now() },
                    } as any);
                    const fired = notifyLog.slice(before);
                    log.json('apiResp', { status: (r.data as ApiResponse).status, code: (r.data as ApiResponse).code });
                    log.json('notify 调用', fired);
                    log.ok('SERVER_ERR 在 messages 表没条目 → 用 default = "请求失败"');
                },
            },
            {
                label: '请求级 notify:null ⇒ 跳过本次通知 [1 HTTP, 200]',
                async run(log) {
                    // notification 插件文档约定：null/空白 → 跳；false 不在跳过列表（会"走表"照常通知）。这里用 null 才正确抑制。
                    const before = notifyLog.length;
                    await ax.get('/flaky/biz-error', { notify: null } as any);
                    log.json('notify++', notifyLog.length - before);
                    if (notifyLog.length === before) log.ok('屏幕无新弹窗 = notify:null 抑制成功');
                    else log.err('仍弹了（确认 notify:null 而不是 false）');
                },
            },
            {
                label: '请求级 notify:"自定义文案" ⇒ 直接用 [1 HTTP, 200]',
                async run(log) {
                    const before = notifyLog.length;
                    await ax.get('/flaky/biz-error', { notify: '我自己说的失败' } as any);
                    const fired = notifyLog.slice(before);
                    log.json('notify 调用', fired);
                    log.ok('请求级字符串覆盖 messages 查找');
                },
            },
            {
                label: '成功响应 ⇒ 不弹 [1 HTTP, 200]',
                async run(log) {
                    const before = notifyLog.length;
                    // 唯一调用 /ok（HTTP 200 + envelope success=0000）—— 没有第二个请求；
                    // Network 看到的其它 5xx 是连续点击 15.1/15.2 等留下的，不是 15.5 的
                    const r = await ax.get('/ok');
                    log.json('apiResp', { status: (r.data as ApiResponse).status, success: (r.data as ApiResponse).success });
                    log.json('notify++', notifyLog.length - before);
                    if (notifyLog.length === before) log.ok('success=true → notification 直接 skip → 0 弹窗');
                    else log.err('竟然弹了 —— 检查 main.ts 的 notify 实现');
                },
            },
        ],
    },
];


/* ── 渲染 ───────────────────────────────────────────────────────────── */

const root = document.getElementById('scenarios')!;
scenarios.forEach((s, i) => root.appendChild(createCard(s, i)));

console.log('[e2e] 已装载', api.plugins().length, '个插件');
console.log('[e2e] 插件列表:', api.plugins().map((p) => p.name).join(' → '));


/* ── window.__http: 给 Playwright spec 用的句柄 ────────────────────────
 *
 * Playwright spec 在 page.evaluate 里通过 `window.__http.*` 直接调用插件，
 * 绕过 UI / DOM 断言。所有断言都在 Node 进程里跑，浏览器只承担"执行 axios + 插件"
 * 的运行时角色 —— 是 vitest 集成测试在浏览器侧的对照实验。
 */
declare global {
    interface Window {
        __http: {
            ax: typeof ax;
            api: typeof api;
            cancelAll: typeof cancelAll;
            clearCache: typeof clearCache;
            removeCache: typeof removeCache;
            ApiResponse: typeof ApiResponse;
            /** 累计 notify 调用 —— spec 可 splice(0) 清空后再断言 */
            notifyLog: Array<{ msg: string; ok: boolean; code: string | number }>;
            /** 累计 loading toggle */
            loadingLog: boolean[];
            /** auth 插件 testkit —— 切 behavior / 读计数 / 直接访问 tm */
            auth: {
                tm: ITokenManager;
                state: typeof authState;
                counters: typeof authCounters;
                setBehavior(b: AuthBehavior): void;
                setRefreshDelay(ms: number): void;
                /** 重置 behavior + counters + tm.clear()；spec 每个用例开头调一次 */
                reset(): void;
            };
        };
    }
}

window.__http = {
    ax,
    api,
    cancelAll,
    clearCache,
    removeCache,
    ApiResponse,
    notifyLog,
    loadingLog,
    auth: {
        tm,
        state: authState,
        counters: authCounters,
        setBehavior(b) { authState.refreshBehavior = b; },
        setRefreshDelay(ms) { authState.refreshDelay = ms; },
        reset() {
            authState.refreshBehavior = 'ok';
            authState.refreshDelay = 0;
            authCounters.refresh = 0;
            authCounters.denied = 0;
            authCounters.expired = 0;
            authCounters.readyAuthValues.length = 0;
            tm.clear();
            notifyLog.splice(0);
            loadingLog.splice(0);
        },
    },
};
