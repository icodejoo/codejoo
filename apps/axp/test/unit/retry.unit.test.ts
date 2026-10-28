import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import retry, {
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
} from '../../src/plugins/retry';
import { AxiosError } from 'axios';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造成功或可重试的 adapter 响应。 */
function response(config: any, status = 200, headers: any = {}) {
    return { status, statusText: '', headers, config, data: { code: 0 } };
}

describe('$resolveMax', () => {
    it('[retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级 number 优先', () => {
        expect($resolveMax({ retry: 5 } as any, { max: 1 })).toBe(5);
    });
    it('[retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级对象 max 次之', () => {
        expect($resolveMax({ retry: { max: 3 } } as any, { max: 1 })).toBe(3);
    });
    it('[retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级未指定 → 插件级', () => {
        expect($resolveMax({} as AxiosRequestConfig, { max: 2 })).toBe(2);
    });
    it('[retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 全部未指定 → 0', () => {
        expect($resolveMax({} as AxiosRequestConfig, {})).toBe(0);
    });
    it('[retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级 number=0 显式禁用', () => {
        expect($resolveMax({ retry: 0 } as any, { max: 5 })).toBe(0);
    });
    it('[retry.fn.$resolveMax][retry.opt.max][retry.req.retry.max] 请求级 true → 走插件级（true 不是 number/对象，自然回落）', () => {
        expect($resolveMax({ retry: true } as any, { max: 4 })).toBe(4);
    });
});

describe('$resolveMethods', () => {
    it('[retry.fn.$resolveMethods][retry.opt.methods] 请求级对象优先', () => {
        expect($resolveMethods({ retry: { methods: ['post'] } } as any, {})).toEqual(['post']);
    });
    it('[retry.fn.$resolveMethods][retry.opt.methods] 都未指定 → 默认幂等动词，不含 post/patch', () => {
        const m = $resolveMethods({} as AxiosRequestConfig, {});
        expect(m).toContain('get');
        expect(m).not.toContain('post');
        expect(m).not.toContain('patch');
    });
});

describe('$resolveShouldRetry', () => {
    const fn = (r?: AxiosResponse) => r?.data?.code !== 0;
    it('[retry.fn.$resolveShouldRetry][retry.cb.shouldRetry] 请求级对象 shouldRetry 优先', () => {
        const reqFn = vi.fn(() => true);
        expect($resolveShouldRetry({ retry: { max: 1, shouldRetry: reqFn } } as any, { shouldRetry: fn }))
            .toBe(reqFn);
    });
    it('[retry.fn.$resolveShouldRetry][retry.cb.shouldRetry] 请求级 number → 走插件级', () => {
        expect($resolveShouldRetry({ retry: 3 } as any, { shouldRetry: fn })).toBe(fn);
    });
    it('[retry.fn.$resolveShouldRetry][retry.cb.shouldRetry] 都未指定 → undefined（不设默认值）', () => {
        expect($resolveShouldRetry({} as AxiosRequestConfig, {})).toBeUndefined();
    });
});

describe('$resolveStatusCodes / $resolveAfterStatusCodes', () => {
    it('[retry.fn.$resolveStatusCodes][retry.opt.statusCodes] $resolveStatusCodes 都未指定 → 默认 [408,429,500,502,503,504]', () => {
        expect($resolveStatusCodes({} as AxiosRequestConfig, {})).toEqual([408, 429, 500, 502, 503, 504]);
    });
    it('[retry.fn.$resolveAfterStatusCodes][retry.opt.afterStatusCodes] $resolveAfterStatusCodes 都未指定 → 默认 [413,429,503]', () => {
        expect($resolveAfterStatusCodes({} as AxiosRequestConfig, {})).toEqual([413, 429, 503]);
    });
    it('[retry.fn.$resolveStatusCodes][retry.fn.$resolveAfterStatusCodes] 两者都支持请求级覆盖', () => {
        expect($resolveStatusCodes({ retry: { statusCodes: [418] } } as any, {})).toEqual([418]);
        expect($resolveAfterStatusCodes({ retry: { afterStatusCodes: [418] } } as any, {})).toEqual([418]);
    });
});

describe('$resolveDelay / $resolveJitter / $resolveDelayMax', () => {
    it('[retry.fn.$resolveDelay][retry.opt.delay] $resolveDelay 都未指定 → 默认 3000', () => {
        expect($resolveDelay({} as AxiosRequestConfig, {})).toBe(3000);
    });
    it('[retry.fn.$resolveDelay][retry.opt.delay] $resolveDelay 请求级优先', () => {
        expect($resolveDelay({ retry: { delay: 100 } } as any, { delay: 200 })).toBe(100);
    });
    it('[retry.fn.$resolveJitter][retry.opt.jitter] $resolveJitter 都未指定 → undefined（默认不抖动）', () => {
        expect($resolveJitter({} as AxiosRequestConfig, {})).toBeUndefined();
    });
    it('[retry.fn.$resolveJitter][retry.opt.jitter] $resolveJitter 请求级优先', () => {
        expect($resolveJitter({ retry: { jitter: true } } as any, {})).toBe(true);
    });
    it('[retry.fn.$resolveDelayMax][retry.opt.delayMax] $resolveDelayMax 都未指定 → 默认不封顶', () => {
        expect($resolveDelayMax({} as AxiosRequestConfig, {})).toBe(Infinity);
    });
    it('[retry.fn.$resolveDelayMax][retry.opt.delayMax] $resolveDelayMax 请求级优先', () => {
        expect($resolveDelayMax({ retry: { delayMax: 500 } } as any, { delayMax: 1000 })).toBe(500);
    });
});

describe('$resolveRespectRetryAfter / $resolveRetryAfterMax', () => {
    it('[retry.fn.$resolveRespectRetryAfter][retry.opt.respectRetryAfter] $resolveRespectRetryAfter 都未指定 → 默认 true', () => {
        expect($resolveRespectRetryAfter({} as AxiosRequestConfig, {})).toBe(true);
    });
    it('[retry.fn.$resolveRespectRetryAfter][retry.opt.respectRetryAfter] $resolveRespectRetryAfter 请求级优先', () => {
        expect($resolveRespectRetryAfter({ retry: { respectRetryAfter: false } } as any, {})).toBe(false);
    });
    it('[retry.fn.$resolveRetryAfterMax][retry.opt.retryAfterMax] $resolveRetryAfterMax 都未指定 → 默认不封顶', () => {
        expect($resolveRetryAfterMax({} as AxiosRequestConfig, {})).toBe(Infinity);
    });
    it('[retry.fn.$resolveRetryAfterMax][retry.opt.retryAfterMax] $resolveRetryAfterMax 请求级优先', () => {
        expect($resolveRetryAfterMax({ retry: { retryAfterMax: 5000 } } as any, {})).toBe(5000);
    });
});

describe('$shouldRetry — 否决优先级', () => {
    it('[retry.fn.$shouldRetry][retry.req.retry] retry:false → 硬性否决，无视 shouldRetry/statusCodes', () => {
        const cfg = { retry: false, method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 500 } as any)).toBe(false);
    });
    it('[retry.fn.$shouldRetry][retry.req.retry.enable] retry:{enable:false} → 跟 retry:false 等价', () => {
        const cfg = { retry: { enable: false }, method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 500 } as any)).toBe(false);
    });
    it('[retry.fn.$shouldRetry][retry.opt.methods] 方法不在白名单 → 否决，无视 shouldRetry', () => {
        const cfg = { method: 'post' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 500 } as any)).toBe(false);
    });
    it('[retry.fn.$shouldRetry][retry.opt.methods] 方法在自定义 methods 里 → 放行给 shouldRetry/statusCodes 判断', () => {
        const cfg = { method: 'post' } as any;
        expect($shouldRetry(cfg, { methods: ['post'] }, { status: 500 } as any)).toBe(true);
    });
    it('[retry.fn.$shouldRetry][retry.cb.shouldRetry] shouldRetry 返回明确 true/false 覆盖默认状态码判断', () => {
        const cfg = { method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => false }, { status: 500 } as any)).toBe(false);
        expect($shouldRetry(cfg, { shouldRetry: () => true }, { status: 200 } as any)).toBe(true);
    });
    it('[retry.fn.$shouldRetry][retry.cb.shouldRetry][retry.opt.statusCodes] shouldRetry 返回 undefined → 退回状态码表', () => {
        const cfg = { method: 'get' } as any;
        expect($shouldRetry(cfg, { shouldRetry: () => undefined }, { status: 500 } as any)).toBe(true);
        expect($shouldRetry(cfg, { shouldRetry: () => undefined }, { status: 200 } as any)).toBe(false);
    });
});

describe('retry — 请求级空对象与插件级回退', () => {
    it('[retry.fn.$resolveMethods][retry.fn.$resolveStatusCodes][retry.fn.$resolveAfterStatusCodes][retry.fn.$resolveDelay][retry.fn.$resolveJitter][retry.fn.$resolveDelayMax][retry.fn.$resolveRespectRetryAfter][retry.fn.$resolveRetryAfterMax] 全部解析器在 retry:{} 时回退插件值，零值与 false 不丢失', () => {
        const config = { retry: {} };
        const defaults = { methods: ['put'], statusCodes: [418], afterStatusCodes: [418],
            delay: 0, jitter: true as const, delayMax: 0, respectRetryAfter: false, retryAfterMax: 0 };
        expect($resolveMethods(config, defaults)).toBe(defaults.methods);
        expect($resolveStatusCodes(config, defaults)).toBe(defaults.statusCodes);
        expect($resolveAfterStatusCodes(config, defaults)).toBe(defaults.afterStatusCodes);
        expect($resolveDelay(config, defaults)).toBe(0);
        expect($resolveJitter(config, defaults)).toBe(true);
        expect($resolveDelayMax(config, defaults)).toBe(0);
        expect($resolveRespectRetryAfter(config, defaults)).toBe(false);
        expect($resolveRetryAfterMax(config, defaults)).toBe(0);
    });
    it('[retry.fn.$shouldRetry][retry.cb.shouldRetry] 无响应的网络错误默认不重试，自定义判断可明确启用', () => {
        const error = new AxiosError('offline');
        expect($shouldRetry({}, {}, undefined, error)).toBe(false);
        expect($shouldRetry({}, { shouldRetry: () => true }, undefined, error)).toBe(true);
    });
    it('[retry.fn.$shouldRetry][retry.opt.methods][retry.opt.statusCodes] 空方法和状态码列表显式否决，method 缺失按 get 处理', () => {
        expect($shouldRetry({}, {}, response({}, 500))).toBe(true);
        expect($shouldRetry({ retry: { methods: [] } }, {}, response({}, 500))).toBe(false);
        expect($shouldRetry({ retry: { statusCodes: [] } }, {}, response({}, 500))).toBe(false);
    });
    it('[retry.fn.$shouldRetry][retry.opt.methods] methods 白名单按声明应不区分大小写', () => {
        expect($shouldRetry({ method: 'GET' }, { methods: ['GET'] }, response({}, 500))).toBe(true);
    });
});
