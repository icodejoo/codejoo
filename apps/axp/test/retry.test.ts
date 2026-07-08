import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import axpRetry, {
    $resolveMax,
    $resolveMethods,
    $resolveShouldRetry,
    $resolveStatusCodes,
    $resolveAfterStatusCodes,
    $resolveDelay,
    $resolveJitter,
    $resolveDelayMax,
    $resolveRespectRetryAfter,
    $resolveRetryAfterMax,
    $shouldRetry,
} from '../src/plugins/retry';
import { Axp } from '../src/install';
import { makeNetwork } from './helpers/network';
import { use } from './helpers/install';

function mkApi() {
    const net = makeNetwork();
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    return { net, api };
}


describe('$resolveMax', () => {
    it('请求级 number 优先', () => {
        expect($resolveMax({ retry: 5 } as any, { max: 1 })).toBe(5);
    });
    it('请求级对象 max 次之', () => {
        expect($resolveMax({ retry: { max: 3 } } as any, { max: 1 })).toBe(3);
    });
    it('请求级未指定 → 插件级', () => {
        expect($resolveMax({} as AxiosRequestConfig, { max: 2 })).toBe(2);
    });
    it('全部未指定 → 0', () => {
        expect($resolveMax({} as AxiosRequestConfig, {})).toBe(0);
    });
    it('请求级 number=0 显式禁用', () => {
        expect($resolveMax({ retry: 0 } as any, { max: 5 })).toBe(0);
    });
    it('请求级 true → 走插件级（true 不是 number/对象，自然回落）', () => {
        expect($resolveMax({ retry: true } as any, { max: 4 })).toBe(4);
    });
});


describe('$resolveMethods', () => {
    it('请求级对象优先', () => {
        expect($resolveMethods({ retry: { methods: ['post'] } } as any, {})).toEqual(['post']);
    });
    it('都未指定 → 默认幂等动词，不含 post/patch', () => {
        const m = $resolveMethods({} as AxiosRequestConfig, {});
        expect(m).toContain('get');
        expect(m).not.toContain('post');
        expect(m).not.toContain('patch');
    });
});


describe('$resolveShouldRetry', () => {
    const fn = (r?: AxiosResponse) => r?.data?.code !== 0;
    it('请求级对象 shouldRetry 优先', () => {
        const reqFn = vi.fn(() => true);
        expect($resolveShouldRetry({ retry: { max: 1, shouldRetry: reqFn } } as any, { shouldRetry: fn }))
            .toBe(reqFn);
    });
    it('请求级 number → 走插件级', () => {
        expect($resolveShouldRetry({ retry: 3 } as any, { shouldRetry: fn })).toBe(fn);
    });
    it('都未指定 → undefined（不设默认值）', () => {
        expect($resolveShouldRetry({} as AxiosRequestConfig, {})).toBeUndefined();
    });
});


describe('$resolveStatusCodes / $resolveAfterStatusCodes', () => {
    it('$resolveStatusCodes 都未指定 → 默认 [408,429,500,502,503,504]', () => {
        expect($resolveStatusCodes({} as AxiosRequestConfig, {})).toEqual([408, 429, 500, 502, 503, 504]);
    });
    it('$resolveAfterStatusCodes 都未指定 → 默认 [413,429,503]', () => {
        expect($resolveAfterStatusCodes({} as AxiosRequestConfig, {})).toEqual([413, 429, 503]);
    });
    it('两者都支持请求级覆盖', () => {
        expect($resolveStatusCodes({ retry: { statusCodes: [418] } } as any, {})).toEqual([418]);
        expect($resolveAfterStatusCodes({ retry: { afterStatusCodes: [418] } } as any, {})).toEqual([418]);
    });
});


describe('$resolveDelay / $resolveJitter / $resolveDelayMax', () => {
    it('$resolveDelay 都未指定 → 默认 3000', () => {
        expect($resolveDelay({} as AxiosRequestConfig, {})).toBe(3000);
    });
    it('$resolveDelay 请求级优先', () => {
        expect($resolveDelay({ retry: { delay: 100 } } as any, { delay: 200 })).toBe(100);
    });
    it('$resolveJitter 都未指定 → undefined（默认不抖动）', () => {
        expect($resolveJitter({} as AxiosRequestConfig, {})).toBeUndefined();
    });
    it('$resolveJitter 请求级优先', () => {
        expect($resolveJitter({ retry: { jitter: true } } as any, {})).toBe(true);
    });
    it('$resolveDelayMax 都未指定 → 默认不封顶', () => {
        expect($resolveDelayMax({} as AxiosRequestConfig, {})).toBe(Infinity);
    });
    it('$resolveDelayMax 请求级优先', () => {
        expect($resolveDelayMax({ retry: { delayMax: 500 } } as any, { delayMax: 1000 })).toBe(500);
    });
});


describe('$resolveRespectRetryAfter / $resolveRetryAfterMax', () => {
    it('$resolveRespectRetryAfter 都未指定 → 默认 true', () => {
        expect($resolveRespectRetryAfter({} as AxiosRequestConfig, {})).toBe(true);
    });
    it('$resolveRespectRetryAfter 请求级优先', () => {
        expect($resolveRespectRetryAfter({ retry: { respectRetryAfter: false } } as any, {})).toBe(false);
    });
    it('$resolveRetryAfterMax 都未指定 → 默认不封顶', () => {
        expect($resolveRetryAfterMax({} as AxiosRequestConfig, {})).toBe(Infinity);
    });
    it('$resolveRetryAfterMax 请求级优先', () => {
        expect($resolveRetryAfterMax({ retry: { retryAfterMax: 5000 } } as any, {})).toBe(5000);
    });
});


describe('$shouldRetry — 否决优先级', () => {
    it('retry:false → 硬性否决，无视 shouldRetry/statusCodes', () => {
        const cfg = { retry: false, method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 500 } as any)).toBe(false);
    });
    it('retry:{enable:false} → 跟 retry:false 等价', () => {
        const cfg = { retry: { enable: false }, method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 500 } as any)).toBe(false);
    });
    it('方法不在白名单 → 否决，无视 shouldRetry', () => {
        const cfg = { method: 'post' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 500 } as any)).toBe(false);
    });
    it('方法在自定义 methods 里 → 放行给 shouldRetry/statusCodes 判断', () => {
        const cfg = { method: 'post' } as any;
        expect($shouldRetry(cfg, { methods: ['post'] }, { status: 500 } as any)).toBe(true);
    });
    it('shouldRetry 返回明确 true/false 覆盖默认状态码判断', () => {
        const cfg = { method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => false }, { status: 500 } as any)).toBe(false);
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 200 } as any)).toBe(true);
    });
    it('shouldRetry 返回 undefined → 退回状态码表', () => {
        const cfg = { method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => undefined }, { status: 500 } as any)).toBe(true);
        expect($shouldRetry(cfg, { shouldRetry: () => undefined }, { status: 200 } as any)).toBe(false);
    });
});


describe('retry 集成 — 网络/HTTP 错误路径', () => {
    it('max=2：前两次 500、第三次成功 → 恢复，调用方只看到成功', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 3 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, { retry: 2 } as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(3);
    });

    it('max=0 → 不重试，直接 reject', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 0, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: 0 } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('持续失败 → 耗尽重试后 reject 最后一次错误', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: 2 } as any)).rejects.toMatchObject({ status: 500 });
        expect(net.calls('GET', '/x')).toBe(3);  // 首发 + 2 次重试
    });

    it('耗尽次数时若最后一次其实是成功响应但 shouldRetry 仍判定要重试（恒为 true）→ 照样合成错误 reject，最后一次响应挂在 error.response 上', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0, shouldRetry: () => true }));
        await expect(api.get('/x')(undefined, { retry: 2 } as any)).rejects.toMatchObject({ response: { data: { code: 0 } } });
        expect(net.calls('GET', '/x')).toBe(3);  // 首发 + 2 次重试，shouldRetry 一直说重试直到预算耗尽
    });

    it('默认 shouldRetry 只认状态码表，4xx（不在表里）不重试', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 400 }));
        use(api, axpRetry({ max: 3, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: 3 } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('408/429 也在默认状态码表内，会重试', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, { retry: 2 } as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(2);
    });
});


describe('retry 集成 — methods 白名单', () => {
    it('post 默认不重试（即使状态码在表里）', async () => {
        const { net, api } = mkApi();
        net.on('POST', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        await expect(api.post('/x')(undefined, { retry: 2 } as any)).rejects.toBeTruthy();
        expect(net.calls('POST', '/x')).toBe(1);
    });

    it('methods 显式包含 post 后可以重试', async () => {
        const { net, api } = mkApi();
        net.on('POST', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0, methods: ['post'] }));
        const r = await api.post('/x')(undefined, { retry: 2 } as any);
        expect(r).toBe('ok');
        expect(net.calls('POST', '/x')).toBe(2);
    });

    it('methods 白名单否决 shouldRetry 的明确 true', async () => {
        const { net, api } = mkApi();
        net.on('POST', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 2, delay: 0, shouldRetry: () => true }));
        await expect(api.post('/x')(undefined, { retry: 2 } as any)).rejects.toBeTruthy();
        expect(net.calls('POST', '/x')).toBe(1);  // shouldRetry:true 也救不回来，方法白名单先否决
    });
});


describe('retry 集成 — shouldRetry 业务异常路径', () => {
    it('成功响应被判为业务异常时也触发重试', async () => {
        const { net, api } = mkApi();
        let hits = 0;
        net.on('GET', '/x', () => { hits++; return { data: { code: hits < 2 ? 1 : 0, data: 'ok' } }; });
        const shouldRetry = vi.fn((r?: AxiosResponse) => (r?.data as any)?.code !== 0);
        use(api, axpRetry({ max: 2, delay: 0, shouldRetry }));
        const r: any = await api.get('/x')(undefined, { retry: 2 } as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(2);
        expect(shouldRetry).toHaveBeenCalled();
    });

    it('正常成功响应不触发重试', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ data: { code: 0, data: 'ok' } }));
        const shouldRetry = vi.fn((r?: AxiosResponse) => (r?.data as any)?.code !== 0);
        use(api, axpRetry({ max: 2, delay: 0, shouldRetry }));
        await api.get('/x')(undefined, { retry: 2 } as any);
        expect(net.calls('GET', '/x')).toBe(1);
    });
});


describe('retry 集成 — delay / jitter / delayMax', () => {
    it('自定义 delay 函数收到 (current, max, response?, err?)', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        const seen: any[] = [];
        const delay = vi.fn((current: number, max: number, response?: AxiosResponse, err?: any) => {
            seen.push({ current, max, hasResponse: !!response, hasErr: !!err });
            return 0;
        });
        use(api, axpRetry({ max: 2, delay }));
        await api.get('/x')(undefined, { retry: 2 } as any);
        expect(delay).toHaveBeenCalledTimes(1);
        expect(seen[0]).toMatchObject({ current: 1, max: 2, hasErr: true });
    });

    it('delay 函数返回非 number 视为 0（不等待）', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        const start = Date.now();
        use(api, axpRetry({ max: 2, delay: () => undefined }));
        await api.get('/x')(undefined, { retry: 2 } as any);
        expect(Date.now() - start).toBeLessThan(200);  // 没有真的等待
    });

    it('未指定 delay 时默认 3000ms（用 fake timer 验证不会提前触发重试）', async () => {
        vi.useFakeTimers();
        try {
            const { net, api } = mkApi();
            net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
            use(api, axpRetry({ max: 1 }));
            const p = api.get('/x')(undefined, { retry: 1 } as any);
            await vi.advanceTimersByTimeAsync(0);          // 首发完成
            expect(net.calls('GET', '/x')).toBe(1);
            await vi.advanceTimersByTimeAsync(2999);        // 差 1ms 到默认 3000ms
            expect(net.calls('GET', '/x')).toBe(1);         // 还没到点，不该重试
            // 注意：到点后重发请求自己的 setTimeout(latency:0) 是在“+1”这一步的 tick
            // 循环内新调度出来的，到期时刻跟这步的目标时刻重合——fake timer 对“刚好卡
            // 在同一虚拟时刻新调度”的定时器不会在同一次 advance 里补跑，必须再往前挪
            // 一点（不能再传 0）才能把它一起冲掉。
            await vi.advanceTimersByTimeAsync(1);
            await vi.advanceTimersByTimeAsync(1);           // 让重试请求自己的 setTimeout(latency:0) 也跑完
            expect(net.calls('GET', '/x')).toBe(2);
            await expect(p).resolves.toBe('ok');
        } finally {
            vi.useRealTimers();
        }
    });

    it('jitter:true 落在 [0, 原始 delay) 区间内', async () => {
        // 固定 Math.random，避免真实计时在慢机器/高负载下抖动导致 flaky。
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.4);
        try {
            const { net, api } = mkApi();
            net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
            const start = Date.now();
            use(api, axpRetry({ max: 1, delay: 1000, jitter: true }));
            await api.get('/x')(undefined, { retry: 1 } as any);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(300);   // 0.4 * 1000 = 400ms，留量给调用开销
            expect(elapsed).toBeLessThan(800);             // 远小于原始 1000ms delay
        } finally {
            randomSpy.mockRestore();
        }
    });

    it('jitter 函数返回值非有限数/负数时回退原始 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        vi.useFakeTimers();
        try {
            use(api, axpRetry({ max: 1, delay: 500, jitter: () => -1 }));
            const p = api.get('/x')(undefined, { retry: 1 } as any);
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(499);
            expect(net.calls('GET', '/x')).toBe(1);  // 无效抖动回退到原始 500ms，还没到点
            await vi.advanceTimersByTimeAsync(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(net.calls('GET', '/x')).toBe(2);
            await expect(p).resolves.toBe('ok');
        } finally {
            vi.useRealTimers();
        }
    });

    it('delayMax 封顶抖动/计算后的 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        const start = Date.now();
        use(api, axpRetry({ max: 1, delay: 5000, delayMax: 30 }));
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);  // 5000ms 被 delayMax:30 封顶
    });
});


describe('retry 集成 — Retry-After 响应头', () => {
    it('数字秒形式的 Retry-After 覆盖 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': '0' } } : { data: { code: 0, data: 'ok' } }));
        const delay = vi.fn(() => 5000);
        const start = Date.now();
        use(api, axpRetry({ max: 1, delay }));
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);  // 用了头里的 0 秒，没走 delay() 算出来的 5000ms
        expect(delay).not.toHaveBeenCalled();
    });

    it('HTTP-date 形式的 Retry-After 也能解析', async () => {
        const { net, api } = mkApi();
        const future = new Date(Date.now() + 10).toUTCString();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': future } } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 1, delay: 5000 }));
        const start = Date.now();
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);
    });

    it('afterStatusCodes 之外的状态码不采信 Retry-After（照样走 delay）', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500, headers: { 'retry-after': '10' } } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 1, delay: 0 }));
        // 500 不在默认 afterStatusCodes([413,429,503]) 里，即使带了 10 秒的头也不该真的等 10 秒 —
        // 用 delay:0 验证走的是 delay 而不是头（若误用了头会等 10s，测试超时失败）。
        const r = await api.get('/x')(undefined, { retry: 1 } as any);
        expect(r).toBe('ok');
    });

    it('retryAfterMax 封顶头给出的等待时长', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': '10' } } : { data: { code: 0, data: 'ok' } }));
        const start = Date.now();
        use(api, axpRetry({ max: 1, retryAfterMax: 20 }));
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);  // 10s 被 retryAfterMax:20ms 封顶
    });

    it('respectRetryAfter:false 时忽略响应头，走 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': '10' } } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 1, delay: 0, respectRetryAfter: false }));
        const r = await api.get('/x')(undefined, { retry: 1 } as any);
        expect(r).toBe('ok');  // 若误用了头会等 10s 超时失败
    });
});


describe('retry 集成 — 取消', () => {
    it('等待重试期间被取消 → 立刻停止等待并 reject，不会空等满整个 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 3, delay: 5000 }));
        const controller = new AbortController();
        const p = api.get('/x')(undefined, { retry: 3, signal: controller.signal } as any);
        setTimeout(() => controller.abort(), 30);
        const start = Date.now();
        await expect(p).rejects.toBeTruthy();
        expect(Date.now() - start).toBeLessThan(500);  // 远小于 5000ms 的 delay，证明没有空等
    });
});


describe('retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义', () => {
    it('retry:false 显式禁用，即使插件级 max>0', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 3, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: false } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('retry:true 不覆盖，走插件级默认', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, { retry: true } as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(2);
    });

    it('retry: { enable: false } 跟 retry:false 等价', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 3, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: { enable: false } } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('retry 未指定时同 true，走插件级默认', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, {} as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(2);
    });
});
