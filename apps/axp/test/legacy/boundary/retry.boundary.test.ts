import { describe, it, expect, vi, afterEach } from 'vitest';
import axios, { AxiosHeaders } from 'axios';
import axpRetry, { default as retry } from '../../../src/plugins/retry';
import { Axp } from '../../../src/install';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';

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
    it('[retry.opt.max] max=0 → 不重试，直接 reject', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ status: 500 }));
        use(api, axpRetry({ max: 0, delay: 0 }));
        await expect(api.get('/x')(undefined, { retry: 0 } as any)).rejects.toBeTruthy();
        expect(net.calls('GET', '/x')).toBe(1);
    });

    it('[retry.opt.max][retry.cb.shouldRetry] 耗尽次数时最后一次是已 resolve 的响应（shouldRetry 恒为 true）→ 原样 resolve 最后一次响应，不合成错误', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', () => ({ data: { code: 0, data: 'ok' } }));
        use(api, axpRetry({ max: 2, delay: 0, shouldRetry: () => true }));
        await expect(api.get('/x')(undefined, { retry: 2 } as any)).resolves.toBe('ok');
        expect(net.calls('GET', '/x')).toBe(3);  // 首发 + 2 次重试，shouldRetry 一直说重试直到预算耗尽
    });

    it('[retry.opt.max] business 风格（HTTP 200 + 失败码）耗尽后 resolve 最后一次响应，交给下游 normalize 转成失败', async () => {
        const net = makeNetwork().on('GET', '/b', () => ({ data: { code: 500, message: 'boom' } }));
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { retry: axpRetry({ max: 2, delay: 0, shouldRetry: (r) => (r?.data as any)?.code === 500 }) });
        const resp = await ax.get('/b');
        expect(resp.status).toBe(200);
        expect(resp.data).toMatchObject({ code: 500 });   // 原响应，而非通用 "exhausted retries" 错误
        expect(net.calls('GET', '/b')).toBe(3);
    });
});

describe('retry 集成 — delay / jitter / delayMax', () => {
    it('[retry.cb.delay] delay 函数返回非 number 视为 0（不等待）', async () => {
        const { net, api } = mkApi();
        net.on('GET', '/x', (_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        const start = Date.now();
        use(api, axpRetry({ max: 2, delay: () => undefined }));
        await api.get('/x')(undefined, { retry: 2 } as any);
        expect(Date.now() - start).toBeLessThan(200);  // 没有真的等待
    });

    it('[retry.cb.jitter] jitter 函数返回值非有限数/负数时回退原始 delay', async () => {
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
});

describe('retry 集成 — 取消', () => {
    it('[retry.fn.axpRetry] 等待重试期间被取消 → 立刻停止等待并 reject，不会空等满整个 delay', async () => {
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

describe('retry — max=0（默认）时不改写初始结果', () => {
    it('[retry.opt.max] shouldRetry 恒真 + 200 响应 → 原样 resolve，不被改成 "exhausted retries"', async () => {
        const { net, api } = mkApi();
        net.fallback(() => ({ data: { code: 0, data: 'fine' } }));
        use(api, axpRetry({ shouldRetry: () => true }));
        const r = await api.axios.get('/ok');
        expect(r.status).toBe(200);
        expect(net.calls('GET', '/ok')).toBe(1);
    });

    it('[retry.opt.max] shouldRetry 恒真 + 500 → 原错误 reject（不是 exhausted），且不重发', async () => {
        const { net, api } = mkApi();
        net.fallback(() => ({ status: 500 }));
        use(api, axpRetry({ shouldRetry: () => true }));
        await expect(api.axios.get('/bad')).rejects.toMatchObject({ response: { status: 500 } });
        expect(net.calls('GET', '/bad')).toBe(1);
    });
});

describe('retry — 循环终止与 Header 边界', () => {
    it.each(['garbage', '-1', '0', 'Thu, 01 Jan 1970 00:00:00 GMT'])('[retry.opt.respectRetryAfter] Retry-After=%s 无效或过去值不造成额外长等待', async (header) => {
        vi.useFakeTimers();
        const adapter = vi.fn()
            .mockImplementationOnce(async (c) => response(c, 503, new AxiosHeaders({ 'retry-after': header })))
            .mockImplementation(async (c) => response(c));
        const ax = axios.create({ adapter });
        retry({ max: 1, delay: 25 }).install(ax);
        const pending = ax.get('/');
        await vi.advanceTimersByTimeAsync(0);
        expect(adapter).toHaveBeenCalledTimes(header === 'garbage' ? 1 : 2);
        await vi.advanceTimersByTimeAsync(25);
        expect((await pending).status).toBe(200);
        expect(adapter).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('[retry.fn.axpRetry] 错误无 config 时原样拒绝，不启动重试循环', async () => {
        const error = new Error('no config');
        const adapter = vi.fn(async () => { throw error; });
        const ax = axios.create({ adapter });
        retry({ max: 4, delay: 0, shouldRetry: () => true }).install(ax);
        await expect(ax.get('/')).rejects.toBe(error);
        expect(adapter).toHaveBeenCalledOnce();
    });
    it('[retry.cb.shouldRetry] shouldRetry 抛错明确拒绝，不发出额外尝试', async () => {
        const error = new Error('predicate');
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        retry({ max: 2, shouldRetry: () => { throw error; } }).install(ax);
        await expect(ax.get('/')).rejects.toBe(error);
        expect(adapter).toHaveBeenCalledOnce();
    });
});

describe('retry: business-failure loop exhaustion and error-path behavior', () => {
  it('[retry.opt.max][retry.cb.shouldRetry] when every retry attempt still looks like a business failure (shouldRetry), the loop exhausts and RESOLVES with the LAST attempt as-is', async () => {
    // Same as Dio: gives up and resolves with the last, still-failing attempt,
    // so downstream normalize turns it into the usual failure (same as without retry).
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => { attempts++; return { data: { code: 1, data: { attempt: attempts } } }; });
    use(api, [retry({ max: 2, delay: 0, shouldRetry: (r) => (r?.data as any)?.code !== 0 })]);

    const resp: any = await api.axios.get('/data', { retry: { max: 2, shouldRetry: (r: any) => r?.data?.code !== 0 } } as any);
    expect(attempts).toBe(3);
    expect(resp.data.code).toBe(1);
  });
});

/** 请求用的测试路径 */
const PATH = '/attempt';

describe('review #8 — 重发/重放保持请求体与首发一致', () => {
  const transformRequest = [(d: unknown) => JSON.stringify({ payload: d })];

  it('[retry.fn.axpRetry][retry.opt.methods] retry：自定义 transformRequest 不被套两层', async () => {
    const bodies: unknown[] = [];
    const net = makeNetwork().on('POST', PATH, (config, hit) => {
      bodies.push(config.data);
      return { status: hit === 1 ? 500 : 200 };
    });
    const ax = axios.create({ adapter: net.adapter, transformRequest });
    Axp.install(ax, { retry: retry({ max: 1, delay: 1, methods: ['post'] }) });
    await ax.post(PATH, { a: 1 });
    expect(bodies).toEqual(['{"payload":{"a":1}}', '{"payload":{"a":1}}']);
  });
});

describe('review #P3 — transformRequest 原地改 data 时重发仍用原始快照', () => {
  it('[retry.fn.axpRetry][retry.opt.max] retry 重发的请求体不累加', async () => {
    const bodies: unknown[] = [];
    const net = makeNetwork().on('PUT', PATH, (config, hit) => {
      bodies.push(config.data);
      return { status: hit === 1 ? 500 : 200 };
    });
    const ax = axios.create({
      adapter: net.adapter,
      transformRequest: [(d: any) => { d.n++; return JSON.stringify(d); }],
    });
    Axp.install(ax, { retry: retry({ max: 2, delay: 1 }) });
    const r = await ax.put(PATH, { n: 0 });
    expect(r.status).toBe(200);
    expect(bodies).toEqual(['{"n":1}', '{"n":1}']);
  });
});
