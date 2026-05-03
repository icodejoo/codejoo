import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { create } from '../../core';
import normalize from '../normalize';
import ApiResponse, { ERR_CODES } from '../../objects/ApiResponse';
import retry, {
    $resolveMax,
    $mergeArr,
    $normalize,
    $merge,
    $decide,
    $computeDelay,
    $parseRetryAfter,
    $read,
    $write,
    $reset,
    type IRetryConfig,
} from './retry';
import { AUTH_REFRESHED_KEY, isRetry, RETRY_KEY, SHARE_SETTLED_KEY } from '../../helper';


/* ── 纯函数：max 归一化 ─────────────────────────────────────────────────── */

describe('$resolveMax', () => {
    it('false → 0', () => expect($resolveMax(false)).toBe(0));
    it('0 → 0', () => expect($resolveMax(0)).toBe(0));
    it('true → 默认 2', () => expect($resolveMax(true)).toBe(2));
    it('undefined → 默认 2', () => expect($resolveMax(undefined)).toBe(2));
    it('正数 → 自身', () => expect($resolveMax(5)).toBe(5));
    it('-1 → -1（无限）', () => expect($resolveMax(-1)).toBe(-1));
});


/* ── 纯函数：数组合并 ─────────────────────────────────────────────────── */

describe('$mergeArr', () => {
    it('未提供 user → 直接返回 defaults（零拷贝快路径）', () => {
        const def = ['a', 'b'];
        const r = $mergeArr(def, undefined);
        expect(r).toEqual(['a', 'b']);
        expect(r).toBe(def);
    });
    it('合并去重保序', () => {
        expect($mergeArr(['get', 'put'], ['post', 'get'])).toEqual(['get', 'put', 'post']);
    });
    it('user 为空数组 → 仍走 set 合并产出新副本', () => {
        const def = ['a'];
        const r = $mergeArr(def, []);
        expect(r).toEqual(['a']);
        expect(r).not.toBe(def);
    });
});


/* ── 归一化配置 ────────────────────────────────────────────────────────── */

describe('$normalize', () => {
    it('全部默认值', () => {
        const c = $normalize({});
        expect(c.enable).toBe(true);
        expect(c.max).toBe(2);
        expect(c.methods).toEqual(['get', 'put', 'head', 'delete', 'options', 'trace']);
        expect(c.status).toEqual([408, 413, 429, 500, 502, 503, 504]);
        expect(c.codes).toEqual([ERR_CODES.NETWORK, ERR_CODES.TIMEOUT, ERR_CODES.HTTP]);
        expect(c.retryOnTimeout).toBe(false);
        expect(c.retryAfterMax).toBe(Infinity);
        expect(c.delayMax).toBe(Infinity);
        expect(c.jitter).toBe(false);
        expect(typeof c.delay).toBe('function');
    });
    it('methods 与默认合并（小写）', () => {
        const c = $normalize({ methods: ['POST'] });
        expect(c.methods).toEqual(['get', 'put', 'head', 'delete', 'options', 'trace', 'post']);
    });
    it('status 与默认合并', () => {
        const c = $normalize({ status: [401, 502] });
        expect(c.status).toEqual([408, 413, 429, 500, 502, 503, 504, 401]);
    });
    it('codes 与默认合并', () => {
        const c = $normalize({ codes: ['CUSTOM_ERR'] });
        expect(c.codes).toEqual([ERR_CODES.NETWORK, ERR_CODES.TIMEOUT, ERR_CODES.HTTP, 'CUSTOM_ERR']);
    });
    it('指数退避默认: 300, 600, 1200', () => {
        const c = $normalize({});
        const fn = c.delay as (n: number) => number;
        expect(fn(1)).toBe(300);
        expect(fn(2)).toBe(600);
        expect(fn(3)).toBe(1200);
    });
});


/* ── 请求级 merge ─────────────────────────────────────────────────────── */

describe('$merge', () => {
    const cfg = $normalize({});

    it('未指定 → 复用 cfg（零分配）', () => {
        const out = $merge(cfg, {});
        expect(out).toBe(cfg);
    });
    it('config.retry === true → 复用 cfg', () => {
        expect($merge(cfg, { retry: true } as any)).toBe(cfg);
    });
    it('config.retry === false → max=0', () => {
        const out = $merge(cfg, { retry: false } as any);
        expect(out.max).toBe(0);
    });
    it('config.retry === number → 仅修 max', () => {
        const out = $merge(cfg, { retry: 5 } as any);
        expect(out.max).toBe(5);
        expect(out.methods).toBe(cfg.methods);  // 引用未变
    });
    it('config.retry === object → 字段覆盖', () => {
        const out = $merge(cfg, { retry: { max: 3, methods: ['POST'] } } as any);
        expect(out.max).toBe(3);
        expect(out.methods).toContain('post');
    });
    it('config.retry === function → MaybeFun 解开', () => {
        const out = $merge(cfg, { retry: () => 9 } as any);
        expect(out.max).toBe(9);
    });
});


/* ── 默认决策 $decide：基于 ApiResponse ─────────────────────────────── */

describe('$decide', () => {
    const cfg: IRetryConfig = $normalize({});

    function mkApi(status: number, code: string | number, successful = false): ApiResponse {
        return new ApiResponse(status, code, null, null, successful);
    }

    it('GET 500 → 重试（status 命中）', () => {
        expect($decide(cfg, { method: 'get' }, mkApi(500, 'X'))).toBe(true);
    });
    it('POST 500 → 不重试（method 白名单）', () => {
        expect($decide(cfg, { method: 'post' }, mkApi(500, 'X'))).toBe(false);
    });
    it('GET 200 + biz 失败但无 status 命中 + 无 code 命中 → 不重试', () => {
        expect($decide(cfg, { method: 'get' }, mkApi(200, 'BIZ_ERR'))).toBe(false);
    });
    it('GET 401 → 不重试（status 不在白名单）', () => {
        expect($decide(cfg, { method: 'get' }, mkApi(401, 'X'))).toBe(false);
    });
    it('GET + NETWORK_ERR → 重试', () => {
        expect($decide(cfg, { method: 'get' }, mkApi(0, ERR_CODES.NETWORK))).toBe(true);
    });
    it('GET + TIMEOUT_ERR + retryOnTimeout=false → 不重试', () => {
        expect($decide(cfg, { method: 'get' }, mkApi(0, ERR_CODES.TIMEOUT))).toBe(false);
    });
    it('GET + TIMEOUT_ERR + retryOnTimeout=true → 重试', () => {
        const c2 = { ...cfg, retryOnTimeout: true };
        expect($decide(c2, { method: 'get' }, mkApi(0, ERR_CODES.TIMEOUT))).toBe(true);
    });
    it('CANCEL 永不重试', () => {
        const c2 = { ...cfg, codes: [...cfg.codes, ERR_CODES.CANCEL] };  // 即使加进 whitelist
        expect($decide(c2, { method: 'get' }, mkApi(0, ERR_CODES.CANCEL))).toBe(false);
    });
});


/* ── delay 计算 ──────────────────────────────────────────────────────── */

describe('$computeDelay', () => {
    it('数字 delay 直接用', () => {
        const c = $normalize({ delay: 500 });
        expect($computeDelay(c as any, 1)).toBe(500);
    });
    it('函数 delay 调用 attempt', () => {
        const c = $normalize({ delay: (n) => n * 100 });
        expect($computeDelay(c as any, 3)).toBe(300);
    });
    it('delayMax 封顶', () => {
        const c = $normalize({ delay: 1000, delayMax: 200 });
        expect($computeDelay(c as any, 1)).toBe(200);
    });
    it('jitter:true 在 [0, base) 随机', () => {
        const c = $normalize({ delay: 1000, jitter: true });
        for (let i = 0; i < 10; i++) {
            const d = $computeDelay(c as any, 1);
            expect(d).toBeGreaterThanOrEqual(0);
            expect(d).toBeLessThan(1000);
        }
    });
});


/* ── Retry-After 头解析 ──────────────────────────────────────────────── */

describe('$parseRetryAfter', () => {
    const cfg = $normalize({}) as any;

    it('数字 → 秒级 delta', () => {
        const resp: any = { headers: { 'retry-after': '5' } };
        expect($parseRetryAfter(resp, cfg)).toBe(5000);
    });
    it('受 retryAfterMax 封顶', () => {
        const resp: any = { headers: { 'retry-after': '999' } };
        const c2 = { ...cfg, retryAfterMax: 100 };
        expect($parseRetryAfter(resp, c2)).toBe(100);
    });
    it('无头部 → undefined', () => {
        expect($parseRetryAfter({ headers: {} } as any, cfg)).toBeUndefined();
    });
    it('支持 ratelimit-reset 别名', () => {
        const resp: any = { headers: { 'ratelimit-reset': '3' } };
        expect($parseRetryAfter(resp, cfg)).toBe(3000);
    });
});


/* ── __retry 字段读写 + isRetry 协议 ─────────────────────────────────── */

describe('__retry counter / isRetry', () => {
    it('write/read/reset round-trip', () => {
        const cfg: any = {};
        expect($read(cfg)).toBeUndefined();
        $write(cfg, 3);
        expect($read(cfg)).toBe(3);
        expect(cfg[RETRY_KEY]).toBe(3);
        $reset(cfg);
        expect($read(cfg)).toBeUndefined();
        expect(RETRY_KEY in cfg).toBe(false);
    });
    it('isRetry: 没字段 → false', () => {
        expect(isRetry({} as any)).toBe(false);
    });
    it('isRetry: 有字段（含 0 / -1）→ true', () => {
        const cfg: any = {};
        $write(cfg, 0);
        expect(isRetry(cfg)).toBe(true);
        $write(cfg, -1);
        expect(isRetry(cfg)).toBe(true);
    });
    it('isRetry(null/undefined) → false', () => {
        expect(isRetry(null)).toBe(false);
        expect(isRetry(undefined)).toBe(false);
    });
});


/* ── 安装/卸载生命周期 ───────────────────────────────────────────────── */

describe('retry — install', () => {
    it('throws when normalize not installed first', () => {
        const ax = axios.create();
        const api = create(ax);
        expect(() => api.use(retry())).toThrow(/requires "normalize"/);
    });

    it('does not register interceptor when enable:false', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry({ enable: false })]);
        const snap = api.plugins().find(p => p.name === 'retry');
        expect(snap?.responseInterceptors).toBe(0);
    });

    it('registers one onFulfilled interceptor', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry()]);
        const snap = api.plugins().find(p => p.name === 'retry');
        expect(snap?.responseInterceptors).toBe(1);
    });

    it('eject removes the interceptor', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry()]);
        api.eject('retry');
        expect(api.plugins().find(p => p.name === 'retry')).toBeUndefined();
    });
});


/* ── share-race 联动：探针返回 true → 跳过重试 ────────────────────────── */

describe('retry — share-race 联动', () => {
    /** mock 一个永远 503 失败的 adapter；返回的 response.config 沿用传入 config，
     *  以便 normalize 在 reject 路径上能看到 share 挂的探针字段。 */
    function makeFailAdapter() {
        return vi.fn(async (config: any) => ({
            status: 503,
            statusText: 'Service Unavailable',
            headers: {},
            config,
            data: 'fail',
        })) as any;
    }

    it('config 挂 __raceSettled 且返回 true → 不重试，HTTP 只发一次', async () => {
        const ax = axios.create();
        const adapter = makeFailAdapter();
        ax.defaults.adapter = adapter;
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry({ max: 3, delay: 0 })]);

        // 模拟 share.race 已经挂上"已 settled"的探针
        const config: any = {
            method: 'get',
            url: '/x',
            [SHARE_SETTLED_KEY]: () => true,
        };
        const resp = await ax.request(config);
        // adapter 只被调一次：retry 入口检测到 race 已 settled，跳过重试
        expect(adapter).toHaveBeenCalledTimes(1);
        // __retry 已被清除，response.config 干净
        expect(isRetry(resp.config)).toBe(false);
    });

    it('探针返回 false → 走原有重试逻辑', async () => {
        const ax = axios.create();
        const adapter = makeFailAdapter();
        ax.defaults.adapter = adapter;
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry({ max: 2, delay: 0 })]);

        const config: any = {
            method: 'get',
            url: '/x',
            [SHARE_SETTLED_KEY]: () => false,
        };
        await ax.request(config);
        // max=2 → 首发 + 2 次重试 = 3 次
        expect(adapter).toHaveBeenCalledTimes(3);
    });

    it('share 未装（探针不存在）→ 重试照常工作', async () => {
        const ax = axios.create();
        const adapter = makeFailAdapter();
        ax.defaults.adapter = adapter;
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry({ max: 1, delay: 0 })]);

        const config: any = { method: 'get', url: '/x' };
        await ax.request(config);
        expect(adapter).toHaveBeenCalledTimes(2);
    });
});


/* ── auth-refresh 联动：bag 上 _refreshed=true → 跳过重试，避免叠加 ─── */

describe('retry — auth-refresh 联动', () => {
    function makeFailAdapter() {
        return vi.fn(async (config: any) => ({
            status: 401, statusText: 'Unauthorized',
            headers: {}, config, data: 'fail',
        })) as any;
    }

    it('config 挂 _refreshed=true → 不重试，HTTP 只发一次（auth 重发不再叠加 retry）', async () => {
        const ax = axios.create();
        const adapter = makeFailAdapter();
        ax.defaults.adapter = adapter;
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry({ max: 3, delay: 0 })]);

        // 模拟 auth 已经 refresh 后重发：在 config 上挂 _refreshed
        const config: any = {
            method: 'get',
            url: '/x',
            [AUTH_REFRESHED_KEY]: true,
        };
        const resp = await ax.request(config);
        // 只发一次：retry 入口看到 _refreshed → 直接放行响应
        expect(adapter).toHaveBeenCalledTimes(1);
        expect(isRetry(resp.config)).toBe(false);
    });

    it('config 没挂 _refreshed → 重试照常工作', async () => {
        const ax = axios.create();
        const adapter = makeFailAdapter();
        ax.defaults.adapter = adapter;
        const api = create(ax);
        api.use([normalize({ success: (a: any) => a.code === '0000' }), retry({ max: 2, delay: 0, status: [401] })]);

        const config: any = { method: 'get', url: '/x' };
        await ax.request(config);
        // max=2 → 首发 + 2 次重试 = 3 次
        expect(adapter).toHaveBeenCalledTimes(3);
    });
});
