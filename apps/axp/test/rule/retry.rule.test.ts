import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, { AxiosError } from 'axios';
import type { AxiosResponse } from 'axios';
import axpRetry, { default as retry } from '../../src/plugins/retry';
import { Axp } from '../../src/install';
import { makeNetwork } from '../helpers/network';
import { use } from '../helpers/install';

function mkApi() {
    const net = makeNetwork();
    const api = Axp.create(axios.create({ adapter: net.adapter }));
    return { net, api };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造成功或可重试的 adapter 响应。 */
function response(config: any, status = 200, headers: any = {}) {
    return { status, statusText: '', headers, config, data: { code: 0 } };
}

describe('retry 集成 — 网络/HTTP 错误路径', () => {
    it('[retry.opt.max] max=2：前两次 500、第三次成功 → 恢复，调用方只看到成功', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 3 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, { retry: 2 } as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(3);
    });

    it('[retry.opt.max] 持续失败 → 耗尽重试后 reject 最后一次错误', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: 2 } as any)).rejects.toMatchObject({ status: 500 });
        expect(net.calls('GET', '/x')).toBe(3);  // 首发 + 2 次重试
    });

    it('[retry.opt.statusCodes] 默认 shouldRetry 只认状态码表，4xx（不在表里）不重试', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 400 }));
        use(api, axpRetry({ max: 3, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: 3 } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('[retry.opt.statusCodes] 408/429 也在默认状态码表内，会重试', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, { retry: 2 } as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(2);
    });
});

describe('retry 集成 — methods 白名单', () => {
    it('[retry.opt.methods] post 默认不重试（即使状态码在表里）', async () => {
        const { net, api } = mkApi();
        net.on('POST', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        await expect(api.post('/x')(undefined, { retry: 2 } as any)).rejects.toBeTruthy();
        expect(net.calls('POST', '/x')).toBe(1);
    });

    it('[retry.opt.methods] methods 显式包含 post 后可以重试', async () => {
        const { net, api } = mkApi();
        net.on('POST', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0, methods: ['post'] }));
        const r = await api.post('/x')(undefined, { retry: 2 } as any);
        expect(r).toBe('ok');
        expect(net.calls('POST', '/x')).toBe(2);
    });

    it('[retry.opt.methods][retry.cb.shouldRetry] methods 白名单否决 shouldRetry 的明确 true', async () => {
        const { net, api } = mkApi();
        net.on('POST', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 2, delay: 0, shouldRetry: () => true }));
        await expect(api.post('/x')(undefined, { retry: 2 } as any)).rejects.toBeTruthy();
        expect(net.calls('POST', '/x')).toBe(1);  // shouldRetry:true 也救不回来，方法白名单先否决
    });
});

describe('retry 集成 — shouldRetry 业务异常路径', () => {
    it('[retry.cb.shouldRetry] 成功响应被判为业务异常时也触发重试', async () => {
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

    it('[retry.cb.shouldRetry] 正常成功响应不触发重试', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ data: { code: 0, data: 'ok' } }));
        const shouldRetry = vi.fn((r?: AxiosResponse) => (r?.data as any)?.code !== 0);
        use(api, axpRetry({ max: 2, delay: 0, shouldRetry }));
        await api.get('/x')(undefined, { retry: 2 } as any);
        expect(net.calls('GET', '/x')).toBe(1);
    });
});

describe('retry 集成 — delay / jitter / delayMax', () => {
    it('[retry.cb.delay][retry.opt.delay] 自定义 delay 函数收到 (current, max, response?, err?)', async () => {
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

    it('[retry.opt.delay] 未指定 delay 时默认 3000ms（用 fake timer 验证不会提前触发重试）', async () => {
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

    it('[retry.opt.jitter] jitter:true 落在 [0, 原始 delay) 区间内', async () => {
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

    it('[retry.opt.delayMax] delayMax 封顶抖动/计算后的 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        const start = Date.now();
        use(api, axpRetry({ max: 1, delay: 5000, delayMax: 30 }));
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);  // 5000ms 被 delayMax:30 封顶
    });
});

describe('retry 集成 — Retry-After 响应头', () => {
    it('[retry.opt.respectRetryAfter] 数字秒形式的 Retry-After 覆盖 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': '0' } } : { data: { code: 0, data: 'ok' } }));
        const delay = vi.fn(() => 5000);
        const start = Date.now();
        use(api, axpRetry({ max: 1, delay }));
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);  // 用了头里的 0 秒，没走 delay() 算出来的 5000ms
        expect(delay).not.toHaveBeenCalled();
    });

    it('[retry.opt.respectRetryAfter] HTTP-date 形式的 Retry-After 也能解析', async () => {
        const { net, api } = mkApi();
        const future = new Date(Date.now() + 10).toUTCString();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': future } } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 1, delay: 5000 }));
        const start = Date.now();
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);
    });

    it('[retry.opt.afterStatusCodes] afterStatusCodes 之外的状态码不采信 Retry-After（照样走 delay）', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500, headers: { 'retry-after': '10' } } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 1, delay: 0 }));
        // 500 不在默认 afterStatusCodes([413,429,503]) 里，即使带了 10 秒的头也不该真的等 10 秒 —
        // 用 delay:0 验证走的是 delay 而不是头（若误用了头会等 10s，测试超时失败）。
        const r = await api.get('/x')(undefined, { retry: 1 } as any);
        expect(r).toBe('ok');
    });

    it('[retry.opt.retryAfterMax] retryAfterMax 封顶头给出的等待时长', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': '10' } } : { data: { code: 0, data: 'ok' } }));
        const start = Date.now();
        use(api, axpRetry({ max: 1, retryAfterMax: 20 }));
        await api.get('/x')(undefined, { retry: 1 } as any);
        expect(Date.now() - start).toBeLessThan(300);  // 10s 被 retryAfterMax:20ms 封顶
    });

    it('[retry.opt.respectRetryAfter] respectRetryAfter:false 时忽略响应头，走 delay', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 429, headers: { 'retry-after': '10' } } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 1, delay: 0, respectRetryAfter: false }));
        const r = await api.get('/x')(undefined, { retry: 1 } as any);
        expect(r).toBe('ok');  // 若误用了头会等 10s 超时失败
    });
});

describe('retry 集成 — 单请求 retry 字段的 number/false/true/对象 语义', () => {
    it('[retry.req.retry] retry:false 显式禁用，即使插件级 max>0', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 3, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: false } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('[retry.req.retry] retry:true 不覆盖，走插件级默认', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, { retry: true } as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(2);
    });

    it('[retry.req.retry.enable] retry: { enable: false } 跟 retry:false 等价', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 3, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: { enable: false } } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('[retry.req.retry] retry 未指定时同 true，走插件级默认', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0 }));
        const r = await api.get('/x')(undefined, {} as any);
        expect(r).toBe('ok');
        expect(net.calls('GET', '/x')).toBe(2);
    });
});

describe('retry — 循环终止与 Header 边界', () => {
    it('[retry.cb.shouldRetry] 重试得到不应重试的错误时立刻停止并返回该错误', async () => {
        const adapter = vi.fn()
            .mockImplementationOnce(async (c) => { throw new AxiosError('first', 'E', c, undefined, response(c, 500)); })
            .mockImplementation(async (c) => { throw new AxiosError('last', 'E', c, undefined, response(c, 400)); });
        const ax = axios.create({ adapter });
        retry({ max: 4, delay: 0 }).install(ax);
        await expect(ax.get('/')).rejects.toThrow('last');
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('[retry.opt.enable][retry.method.cleanup] 卸载后不重试，enable:false 不安装任何拦截器', async () => {
        const adapter = vi.fn(async (c) => response(c, 500));
        const ax = axios.create({ adapter });
        const off = retry({ max: 2, delay: 0 }).install(ax);
        off?.();
        expect(retry({ enable: false }).install(ax)).toBeUndefined();
        expect((await ax.get('/')).status).toBe(500);
        expect(adapter).toHaveBeenCalledOnce();
    });
});

describe('retry: business-failure loop exhaustion and error-path behavior', () => {
  it('[retry.opt.enable] a constructor-disabled retry never intercepts a network error at all', async () => {
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { status: 500, data: { code: 1, data: null } }; });
    use(api, [retry({ max: 2, delay: 0, enable: false })]);
    await expect(api.axios.get('/data', { retry: 2 } as any)).rejects.toBeTruthy();
    expect(attempts).toBe(1);
  });

  it('[retry.opt.statusCodes] aligned with Dio\'s default retryIf (which excludes 404): the default shouldRetry only retries >=500, so a 404 is never retried', async () => {
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { status: 404, data: { code: 1, data: null } }; });
    use(api, [retry({ max: 2, delay: 0 })]);
    await expect(api.axios.get('/data', { retry: 2 } as any)).rejects.toBeTruthy();
    expect(attempts).toBe(1); // default shouldRetry excludes 404 — no retries fired
  });
});

/** 给请求加延迟（毫秒），配合 makeNetwork 制造乱序 */
const lat = (ms: number) => ({ latency: ms } as any);

describe('集成 — retry 瞬时错误恢复', () => {
  it('[retry.opt.max] 前两次 500、第三次 200 → retry 自动恢复，对外只见成功', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/flaky', (_c, hit) =>
      hit < 3 ? { status: 500 } : { data: { code: 0, data: 'recovered' } },
    );
    use(api, [retry({ max: 5, delay: 0 })]);

    const r = await api.get('/flaky')(undefined, { retry: 5, ...lat(5) });
    expect(r).toBe('recovered');
    expect(net.calls('GET', '/flaky')).toBe(3);  // 失败2 + 成功1
  });

  it('[retry.opt.max] 始终失败 → 耗尽重试后 reject', async () => {
    const { net, api } = mkApi();
    net.on('GET', '/down', () => ({ status: 503 }));
    use(api, [retry({ max: 2, delay: 0 })]);
    await expect(api.get('/down')(undefined, { retry: 2, ...lat(2) })).rejects.toBeTruthy();
    expect(net.calls('GET', '/down')).toBe(3);  // 首发 + 2 次重试
  });
});
