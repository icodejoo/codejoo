import { describe, it, expect, afterEach, vi } from 'vitest';
import cache, {
    $resolveCache,
    $resolveKey,
    $resolveCloneFn,
    $shallowClone,
    $defaultShouldCache,
} from '../../../src/plugins/cache';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** 构造 adapter 层原始响应。 */
function response(data: unknown, config: any = {}) {
    return { data, config, status: 200, statusText: '', headers: {} };
}

describe('$resolveCache', () => {
    it('[cache.fn.$resolveCache][cache.req.cache] false / 未指定 → null', () => {
        expect($resolveCache({ cache: false } as any, {})).toBe(null);
        expect($resolveCache({} as any, {})).toBe(null);
    });
    it('[cache.fn.$resolveCache][cache.req.cache] true → 启用，用插件级 expires', () => {
        expect($resolveCache({ cache: true } as any, { expires: 1000 })).toEqual({ expires: 1000 });
    });
    it('[cache.fn.$resolveCache][cache.req.cache.expires][cache.req.cache.key] 对象 → 取请求级 expires/key，缺失时回退插件级', () => {
        expect($resolveCache({ cache: { expires: 50 } } as any, { expires: 1000 }))
            .toEqual({ expires: 50, key: undefined });
        expect($resolveCache({ cache: { key: 'k' } } as any, { expires: 1000 }))
            .toEqual({ expires: 1000, key: 'k' });
    });
});

describe('$resolveKey', () => {
    it('[cache.fn.$resolveKey][cache.req.cache.key] 请求级字符串 key 优先', () => {
        expect($resolveKey({} as any, { key: 'req' }, { key: () => 'plug' })).toBe('req');
    });
    it('[cache.fn.$resolveKey][cache.req.cache.key] 请求级函数次之', () => {
        expect($resolveKey({} as any, { key: () => 'fn' }, { key: () => 'plug' })).toBe('fn');
    });
    it('[cache.fn.$resolveKey][cache.cb.key] 插件级函数再次之', () => {
        expect($resolveKey({} as any, {}, { key: () => 'plug' })).toBe('plug');
    });
    it('[cache.fn.$resolveKey][cache.cb.key] 回退到 config.key（key 兜底）', () => {
        expect($resolveKey({ key: 'fromReqkey' } as any, {}, {})).toBe('fromReqkey');
    });
    it('[cache.fn.$resolveKey][cache.cb.key] 全部缺失 → undefined', () => {
        expect($resolveKey({} as any, {}, {})).toBeUndefined();
    });
});

describe('$resolveCloneFn / $shallowClone — 拷贝策略解析', () => {
    it('[cache.fn.$resolveCloneFn][cache.opt.clone] 缺省 / true（resolved.clone undefined） → null（共享引用）', () => {
        expect($resolveCloneFn(undefined)).toBeNull();
    });
    it("[cache.fn.$resolveCloneFn][cache.opt.clone] 'shallow' → 浅拷贝函数（仅顶层）", () => {
        const fn = $resolveCloneFn('shallow')!;
        const src = { a: 1, nested: { b: 2 } };
        const out = fn(src);
        expect(out).not.toBe(src);          // 顶层是新对象
        expect(out).toEqual(src);
        expect(out.nested).toBe(src.nested); // 嵌套仍共享
    });
    it("[cache.fn.$resolveCloneFn][cache.opt.clone] 'deep' → structuredClone 深拷贝（完整隔离）", () => {
        const fn = $resolveCloneFn('deep')!;
        const src = { a: 1, nested: { b: 2 } };
        const out = fn(src);
        expect(out).not.toBe(src);
        expect(out.nested).not.toBe(src.nested);
        expect(out).toEqual(src);
    });
    it('[cache.fn.$resolveCloneFn][cache.opt.clone] function → 原样作为自定义拷贝', () => {
        const custom = (d: any) => ({ ...d, tagged: true });
        const fn = $resolveCloneFn(custom)!;
        expect(fn).toBe(custom);
    });
    it('[cache.fn.$shallowClone] $shallowClone：数组复制顶层、原始值原样返回', () => {
        const arr = [1, 2, 3];
        expect($shallowClone(arr)).not.toBe(arr);
        expect($shallowClone(arr)).toEqual(arr);
        expect($shallowClone(42)).toBe(42);
        expect($shallowClone('s')).toBe('s');
    });
});

describe('cache — 解析与错误边界', () => {
    it.each(['{invalid', 'plain', '', '  {"code":0}  ', '[1,2]', false, null])(
        '[cache.fn.$defaultShouldCache] 成功 HTTP 原始 body %s 可缓存，非法 JSON 退回文本语义', (data) => {
            expect($defaultShouldCache(response(data))).toBe(true);
        },
    );
    it.each([199, 300, 404, 500])('[cache.fn.$defaultShouldCache] HTTP %i 即使业务 code=0 也不缓存', (status) => {
        expect($defaultShouldCache({ ...response({ code: 0 }), status })).toBe(false);
    });
    it('[cache.fn.$resolveKey][cache.cb.key] 空 key 函数显式禁用缓存，不回退 config.key；空字符串可回退', () => {
        const config = { key: 'fallback' };
        expect($resolveKey(config, { key: () => '' }, {})).toBeUndefined();
        expect($resolveKey(config, {}, { key: () => undefined })).toBeUndefined();
        expect($resolveKey(config, { key: '' }, {})).toBe('fallback');
    });
    it('[cache.fn.$resolveCache][cache.fn.$resolveCloneFn] 非法运行时配置不启用缓存，非法 clone 策略返回共享模式', () => {
        expect($resolveCache({ cache: 1 } as any, {})).toBeNull();
        expect($resolveCloneFn('invalid' as any)).toBeNull();
    });
});
