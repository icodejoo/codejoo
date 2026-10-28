import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { AxiosAdapter } from 'axios';
import {
    resolveAdapter,
    wrapAdapter,
    getBaseAdapter,
    registerAttemptHook,
    runAttempt,
} from '../../src/helper';
import type { AttemptHook } from '../../src/helper';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** 构造不访问网络的成功响应。 */
function response(config: any, data: unknown = 'ok') {
    return { status: 200, statusText: 'OK', headers: {}, config, data };
}

describe('helper — 基础值与克隆边界', () => {
    it('[helper.resolveAdapter] resolveAdapter 缺省候选、字符串和函数均可解析；非法名称抛错', () => {
        const ax = axios.create();
        ax.defaults.adapter = undefined;
        expect(typeof resolveAdapter(ax)).toBe('function');
        ax.defaults.adapter = 'fetch';
        expect(resolveAdapter(ax)).toBe(axios.getAdapter('fetch'));
        ax.defaults.adapter = 'invalid';
        expect(() => resolveAdapter(ax)).toThrow();
    });
});

describe('helper — adapter 外部替换与旧引用', () => {
    it('[helper.wrapAdapter][helper.getBaseAdapter] 外部替换后移除旧层不覆盖新 adapter，旧层引用退化为直通', async () => {
        const base = vi.fn(async (c) => response(c, 'base'));
        const replacement = vi.fn(async (c) => response(c, 'replacement'));
        const ax = axios.create({ adapter: base });
        const called = vi.fn();
        const off = wrapAdapter(ax, (prev) => (c) => { called(); return prev(c); });
        const old = ax.defaults.adapter as AxiosAdapter;
        ax.defaults.adapter = replacement;
        expect(getBaseAdapter(ax)).toBe(replacement);
        const offNew = wrapAdapter(ax, (prev) => prev);
        off();
        expect((await ax.get('/')).data).toBe('replacement');
        expect((await old({} as any)).data).toBe('base');
        expect(called).not.toHaveBeenCalled();
        offNew();
        expect(ax.defaults.adapter).toBe(replacement);
    });
});

describe('helper — 原始请求体与单次尝试钩子', () => {
    it('[helper.registerAttemptHook][helper.runAttempt] 钩子按登记顺序运行且注销幂等，运行中注销不改变本次快照', async () => {
        const calls: string[] = [];
        const ax = axios.create();
        /** 构造记录顺序的尝试钩子。 */
        function hook(name: string): AttemptHook {
            return {
                /** 记录请求准备顺序。 */
                async onRequest(c) { calls.push(name + ':request'); return c; },
                /** 记录响应处理顺序。 */
                async onResponse(r) { calls.push(name + ':response'); return r; },
                /** 错误保持拒绝。 */
                async onError(e) { throw e; },
            };
        }
        const offA = registerAttemptHook(ax, hook('a'));
        const offB = registerAttemptHook(ax, hook('b'));
        const adapter = vi.fn(async (c) => response(c));
        const pending = runAttempt(ax, { url: '/', adapter });
        offB(); offB();
        await pending;
        expect(calls).toEqual(['a:request', 'b:request', 'a:response', 'b:response']);
        offA(); offA();
        calls.length = 0;
        await runAttempt(ax, { url: '/', adapter });
        expect(calls).toEqual([]);
    });
    it('[helper.registerAttemptHook][helper.runAttempt] 请求准备失败不发送网络，错误钩子可恢复并交给后续响应钩子', async () => {
        const ax = axios.create();
        const error = new Error('prepare');
        const adapter = vi.fn();
        const recovered = response({}, 'recovered');
        const onError = vi.fn(async () => recovered);
        const onResponse = vi.fn(async (r) => r);
        registerAttemptHook(ax, {
            /** 模拟凭证准备失败。 */
            async onRequest() { throw error; },
            onResponse, onError,
        });
        registerAttemptHook(ax, {
            /** 后续准备因前一项失败不会执行。 */
            async onRequest(c) { return c; },
            onResponse,
            /** 未恢复的错误继续拒绝。 */
            async onError(e) { throw e; },
        });
        await expect(runAttempt(ax, { adapter })).resolves.toBe(recovered);
        expect(adapter).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(error);
        expect(onResponse).toHaveBeenCalledOnce();
    });
});
