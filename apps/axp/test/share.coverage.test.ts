import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, CanceledError } from 'axios';
import share, { $follow, $rebindError, $rebindResponse, $createEntry } from '../src/plugins/share';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造可手动落定的网络步骤。 */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

/** 构造成功响应。 */
function response(config: any = {}) {
    return { data: 'ok', config, headers: {}, status: 200, statusText: '' };
}

describe('share — 订阅清理与错误属性', () => {
    it('相同 config 的响应和错误保持身份，不同 config 保留不可枚举属性与原型', () => {
        const config = {};
        const resp = response(config);
        expect($rebindResponse(resp, config)).toBe(resp);
        const error = new AxiosError('boom', 'E', config as any, undefined, resp as any);
        Object.defineProperty(error, 'detail', { value: 42, enumerable: false });
        expect($rebindError(error, config)).toBe(error);
        const other = {};
        const copy = $rebindError(error, other) as any;
        expect(copy).toBeInstanceOf(AxiosError);
        expect(copy.detail).toBe(42);
        expect(Object.getOwnPropertyDescriptor(copy, 'detail')?.enumerable).toBe(false);
        expect(copy.config).toBe(other);
        expect(error.config).toBe(config);
    });
    it('共享 entry 的旧轮次落定不得删除同 key 新轮次', async () => {
        const map = new Map();
        const old = $createEntry(map, 'k');
        const fresh = $createEntry(map, 'k');
        old.resolve(response());
        await old.promise;
        expect(map.get('k')).toBe(fresh);
        fresh.reject(new Error('fresh'));
        await expect(fresh.promise).rejects.toThrow('fresh');
        expect(map.has('k')).toBe(false);
    });
    it.each([false, true])('订阅落定清除 timer、signal 与 cancelToken 监听，reject=%s', async (reject) => {
        vi.useFakeTimers();
        const pending = deferred<any>();
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const token = { subscribe: vi.fn(), unsubscribe: vi.fn() };
        const config: any = { signal: controller.signal, cancelToken: token, timeout: 100 };
        const followed = $follow(pending.promise, config);
        const assertion = reject ? expect(followed).rejects.toThrow('failure') : expect(followed).resolves.toMatchObject({ config });
        if (reject) pending.reject(new Error('failure')); else pending.resolve(response());
        await assertion;
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(token.unsubscribe).toHaveBeenCalledWith(token.subscribe.mock.calls[0][0]);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('CancelToken 单独取消 leader 后 follower 仍成功，底层不携带 leader token', async () => {
        const pending = deferred<any>();
        const token = axios.CancelToken.source();
        const adapter = vi.fn((_config: any) => pending.promise);
        const ax = axios.create({ adapter });
        share().install(ax);
        const leader = ax.get('/', { key: 'k', cancelToken: token.token }).catch((e) => e);
        const follower = ax.get('/', { key: 'k' });
        await vi.waitFor(() => expect(adapter).toHaveBeenCalledOnce());
        expect(adapter.mock.calls[0][0].cancelToken).toBeUndefined();
        token.cancel('leader left');
        expect(await leader).toBeInstanceOf(CanceledError);
        expect(adapter.mock.calls[0][0].signal.aborted).toBe(false);
        pending.resolve(response());
        expect((await follower).data).toBe('ok');
    });
    it.fails('冻结 AxiosError 仍应重绑为 follower 的独立错误', () => {
        const error = Object.freeze(new AxiosError('frozen', 'E', {} as any));
        const config = {};
        expect(($rebindError(error, config) as any).config).toBe(config);
    });
    it.fails('所有订阅者 timeout 后也应退出共享轮次并 abort 底层', async () => {
        vi.useFakeTimers();
        const adapter = vi.fn((_config: any) => new Promise<any>(() => {}));
        const ax = axios.create({ adapter });
        share().install(ax);
        const request = ax.get('/', { key: 'k', timeout: 10 }).catch((e) => e);
        await vi.advanceTimersByTimeAsync(10);
        expect((await request).code).toBe('ETIMEDOUT');
        expect(adapter.mock.calls[0][0].signal.aborted).toBe(true);
    });
});

describe('share — 关闭与清理边界', () => {
    it('未提供 key 不计算动态 policy，none 则删除 share 并直接转发', async () => {
        const adapter = vi.fn(async (c) => response(c));
        const ax = axios.create({ adapter });
        share().install(ax);
        const policy = vi.fn(() => false as const);
        await ax.get('/', { share: policy });
        expect(policy).not.toHaveBeenCalled();
        await ax.get('/', { key: 'k', share: policy });
        expect(policy).toHaveBeenCalledOnce();
        expect(adapter.mock.calls[1][0]).not.toHaveProperty('share');
    });
    it('enable:false 不包装 adapter', () => {
        const ax = axios.create();
        const before = ax.defaults.adapter;
        expect(share({ enable: false }).install(ax)).toBeUndefined();
        expect(ax.defaults.adapter).toBe(before);
    });
});
