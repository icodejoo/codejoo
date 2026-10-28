import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import cache, { clearCache, removeCache, $defaultShouldCache, $resolveKey, $resolveCloneFn, $resolveCache } from '../src/plugins/cache';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** 创建可控制完成时机的响应。 */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

/** 构造 adapter 层原始响应。 */
function response(data: unknown, config: any = {}) {
    return { data, config, status: 200, statusText: '', headers: {} };
}

describe('cache — 解析与错误边界', () => {
    it.each(['{invalid', 'plain', '', '  {"code":0}  ', '[1,2]', false, null])(
        '成功 HTTP 原始 body %s 可缓存，非法 JSON 退回文本语义', (data) => {
            expect($defaultShouldCache(response(data))).toBe(true);
        },
    );
    it.each([199, 300, 404, 500])('HTTP %i 即使业务 code=0 也不缓存', (status) => {
        expect($defaultShouldCache({ ...response({ code: 0 }), status })).toBe(false);
    });
    it('空 key 函数显式禁用缓存，不回退 config.key；空字符串可回退', () => {
        const config = { key: 'fallback' };
        expect($resolveKey(config, { key: () => '' }, {})).toBeUndefined();
        expect($resolveKey(config, {}, { key: () => undefined })).toBeUndefined();
        expect($resolveKey(config, { key: '' }, {})).toBe('fallback');
    });
    it('非法运行时配置不启用缓存，非法 clone 策略返回共享模式', () => {
        expect($resolveCache({ cache: 1 } as any, {})).toBeNull();
        expect($resolveCloneFn('invalid' as any)).toBeNull();
    });
    it('structuredClone 不可用时 deep 明确抛错且不发送请求', async () => {
        vi.stubGlobal('structuredClone', undefined);
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache().install(ax);
        await expect(ax.get('/', { cache: { key: 'k', clone: 'deep' } })).rejects.toThrow('structuredClone');
        expect(adapter).not.toHaveBeenCalled();
    });
    it('shouldCache 抛错后同 key 后续仍能缓存', async () => {
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache().install(ax);
        const error = new Error('predicate');
        await expect(ax.get('/', { cache: { key: 'k', shouldCache: () => { throw error; } } })).rejects.toBe(error);
        await ax.get('/', { cache: { key: 'k' } });
        await ax.get('/', { cache: { key: 'k' } });
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('拒绝不会入缓存，后续成功可正常写入', async () => {
        const error = new Error('network');
        const adapter = vi.fn().mockRejectedValueOnce(error).mockImplementation(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache().install(ax);
        await expect(ax.get('/', { key: 'k', cache: true })).rejects.toBe(error);
        await ax.get('/', { key: 'k', cache: true });
        await ax.get('/', { key: 'k', cache: true });
        expect(adapter).toHaveBeenCalledTimes(2);
    });
});

describe('cache — 卸载、代次与 TTL 边界', () => {
    it('卸载时在途请求仍返回，但旧响应不写入重新安装后的缓存', async () => {
        const pending = deferred<any>();
        const adapter = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async (c) => response('new', c));
        const ax = axios.create({ adapter });
        const off = cache().install(ax);
        const old = ax.get('/', { key: 'k', cache: true });
        await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());
        off?.();
        expect(removeCache(ax, 'k')).toBe(false);
        cache().install(ax);
        pending.resolve(response('old'));
        expect((await old).data).toBe('old');
        expect((await ax.get('/', { key: 'k', cache: true })).data).toBe('new');
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it.each([0, -1])('TTL=%i 不命中，即使时间未推进', async (expires) => {
        vi.useFakeTimers();
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache({ expires }).install(ax);
        await ax.get('/', { key: 'k', cache: true });
        await ax.get('/', { key: 'k', cache: true });
        expect(adapter).toHaveBeenCalledTimes(2);
    });
    it('TTL 恰好到期时重新发送，max=0 回退默认容量', async () => {
        vi.useFakeTimers();
        const adapter = vi.fn(async (c) => response('ok', c));
        const ax = axios.create({ adapter });
        cache({ expires: 10, max: 0 }).install(ax);
        await ax.get('/', { key: 'a', cache: true });
        await ax.get('/', { key: 'b', cache: true });
        expect(clearCache(ax)).toBe(2);
        await ax.get('/', { key: 'a', cache: true });
        vi.advanceTimersByTime(10);
        await ax.get('/', { key: 'a', cache: true });
        expect(adapter).toHaveBeenCalledTimes(4);
    });
    it('enable:false 保持 adapter 身份且不创建缓存仓', () => {
        const ax = axios.create();
        const before = ax.defaults.adapter;
        expect(cache({ enable: false }).install(ax)).toBeUndefined();
        expect(ax.defaults.adapter).toBe(before);
        expect(clearCache(ax)).toBe(0);
    });
});
