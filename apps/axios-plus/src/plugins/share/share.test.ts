import { describe, it, expect, vi } from 'vitest';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
    $resolvePolicy,
    $end,
    $race,
    $start,
} from './share';
import type { ISharedOptions } from './types';
import { SHARE_SETTLED_KEY } from '../../helper';


// ───────────────────────────────────────────────────────────────────────────
//  $resolvePolicy
// ───────────────────────────────────────────────────────────────────────────

describe('$resolvePolicy', () => {
    const defaults: ISharedOptions = { policy: 'start' };

    it('未指定 → 插件默认', () => {
        expect($resolvePolicy({} as AxiosRequestConfig, defaults)).toBe('start');
    });

    it('config.share === false → none', () => {
        expect($resolvePolicy({ share: false } as any, defaults)).toBe('none');
    });

    it('config.share === true → 插件默认', () => {
        expect($resolvePolicy({ share: true } as any, defaults)).toBe('start');
        expect($resolvePolicy({ share: true } as any, { policy: 'end' })).toBe('end');
    });

    it('config.share 是字符串 policy → 直接使用', () => {
        expect($resolvePolicy({ share: 'end' } as any, defaults)).toBe('end');
        expect($resolvePolicy({ share: 'race' } as any, defaults)).toBe('race');
        expect($resolvePolicy({ share: 'none' } as any, defaults)).toBe('none');
    });

    it("config.share 'retry' 已移除 → 回退到默认", () => {
        expect($resolvePolicy({ share: 'retry' } as any, defaults)).toBe('start');
    });

    it('config.share 字符串非法 → 回退到默认', () => {
        expect($resolvePolicy({ share: 'wat' } as any, defaults)).toBe('start');
    });

    it('config.share 是对象 → 取 policy', () => {
        expect($resolvePolicy({ share: { policy: 'end' } } as any, defaults)).toBe('end');
    });

    it('config.share 是函数 → 调用并解析', () => {
        const dyn = vi.fn(() => 'race' as const);
        expect($resolvePolicy({ share: dyn } as any, defaults)).toBe('race');
        expect(dyn).toHaveBeenCalledOnce();
    });

    it('插件无 default policy + 未指定 → start（兜底）', () => {
        expect($resolvePolicy({} as any, {})).toBe('start');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  共用：可控 mock adapter
// ───────────────────────────────────────────────────────────────────────────

function deferredAdapter() {
    const pending: Array<{
        resolve: (v: AxiosResponse) => void;
        reject: (e: any) => void;
        config: AxiosRequestConfig;
    }> = [];
    const adp: AxiosAdapter = vi.fn((config) =>
        new Promise((resolve, reject) => {
            pending.push({ resolve, reject, config });
        }),
    ) as any;
    return { adp, pending };
}

const mockResp = (data: any): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config: {} as any, data } as any);

const cfg = (): InternalAxiosRequestConfig => ({} as any);


// ───────────────────────────────────────────────────────────────────────────
//  $start：相同 key 共享一个 promise；首发的 HTTP 结果广播给所有 caller
// ───────────────────────────────────────────────────────────────────────────

describe('$start', () => {
    it('单请求：正常发 HTTP，成功返回', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $start(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve(mockResp('ok'));
        await expect(p).resolves.toMatchObject({ data: 'ok' });
    });

    it('两并发同 key：HTTP 只发一次，两个 caller 都拿到同一结果', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $start(adp, map, 'k1', cfg());
        const pB = $start(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledOnce();
        pending[0].resolve(mockResp('shared'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a).toBe(b);
        expect(a.data).toBe('shared');
    });

    it('失败也共享：所有 caller 都收到同一个 reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $start(adp, map, 'k1', cfg());
        const pB = $start(adp, map, 'k1', cfg());
        pending[0].reject(new Error('boom'));
        await expect(pA).rejects.toThrow('boom');
        await expect(pB).rejects.toThrow('boom');
    });

    it('完成后：相同 key 的新请求重新发 HTTP', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $start(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('first'));
        await p1;
        const p2 = $start(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve(mockResp('second'));
        await expect(p2).resolves.toMatchObject({ data: 'second' });
    });

    it('不同 key：互不干扰，独立 HTTP', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $start(adp, map, 'k1', cfg());
        const pB = $start(adp, map, 'k2', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[0].resolve(mockResp('A'));
        pending[1].resolve(mockResp('B'));
        await expect(pA).resolves.toMatchObject({ data: 'A' });
        await expect(pB).resolves.toMatchObject({ data: 'B' });
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $end：后到顶替前面，所有 caller 等最后一个的结果
// ───────────────────────────────────────────────────────────────────────────

describe('$end', () => {
    it('单请求：正常返回', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $end(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('ok'));
        await expect(p).resolves.toMatchObject({ data: 'ok' });
    });

    it('两并发：两次 HTTP 都发，但只有第二次的结果分发给两个 caller', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $end(adp, map, 'k1', cfg());
        const pB = $end(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[0].resolve(mockResp('OLD'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(mockResp('NEW'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('NEW');
        expect(b.data).toBe('NEW');
    });

    it('三并发：仅最后一次的结果分发，前两次结果丢弃', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $end(adp, map, 'k1', cfg());
        const p2 = $end(adp, map, 'k1', cfg());
        const p3 = $end(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(3);
        pending[0].resolve(mockResp('first'));
        pending[1].resolve(mockResp('second'));
        await new Promise((r) => setTimeout(r, 0));
        pending[2].resolve(mockResp('third'));
        const results = await Promise.all([p1, p2, p3]);
        for (const r of results) expect(r.data).toBe('third');
    });

    it('最后一次失败 → 所有 caller 都 reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $end(adp, map, 'k1', cfg());
        const pB = $end(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('OLD'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].reject(new Error('newest fails'));
        await expect(pA).rejects.toThrow('newest fails');
        await expect(pB).rejects.toThrow('newest fails');
    });

    it('完成后：相同 key 新请求重新计数', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $end(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('A'));
        await p1;
        const p2 = $end(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('B'));
        await expect(p2).resolves.toMatchObject({ data: 'B' });
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $race：所有都发 HTTP，最先返回的赢家分发给所有 caller
// ───────────────────────────────────────────────────────────────────────────

describe('$race', () => {
    it('两并发：先返回的赢家结果给两个 caller', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve(mockResp('FAST'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('FAST');
        expect(b.data).toBe('FAST');
    });

    it('一个失败、一个成功 → 用成功的（Promise.any 语义）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        // A 先失败 → 不立即 reject（B 还在跑）
        pending[0].reject(new Error('first fail'));
        await new Promise((r) => setTimeout(r, 0));
        // B 后成功 → 共享 promise resolve
        pending[1].resolve(mockResp('LATE_SUCCESS'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('LATE_SUCCESS');
        expect(b.data).toBe('LATE_SUCCESS');
    });

    it('全部失败 → 用最后一次 error reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].reject(new Error('A failed'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].reject(new Error('B failed'));
        await expect(pA).rejects.toThrow('B failed');
        await expect(pB).rejects.toThrow('B failed');
    });

    it('单请求失败 → 直接 reject（in-flight 归零）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $race(adp, map, 'k1', cfg());
        pending[0].reject(new Error('alone fail'));
        await expect(p).rejects.toThrow('alone fail');
    });

    it('成功后续到的失败结果被忽略', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('FAST'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data).toBe('FAST');
        expect(b.data).toBe('FAST');
        // 慢的失败已是 noop，不抛
        pending[0].reject(new Error('SLOW_LATE_FAIL'));
        await new Promise((r) => setTimeout(r, 0));
    });

    it('赢家结算后，新请求重新比赛', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p1 = $race(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('round1'));
        await p1;
        const p2 = $race(adp, map, 'k1', cfg());
        const p3 = $race(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('round2-A'));
        await Promise.all([p2, p3]);
    });

    it('单请求：正常返回（无人和它 race）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const p = $race(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp('alone'));
        await expect(p).resolves.toMatchObject({ data: 'alone' });
    });

    it('与 retry 联动：每个参与者 config 上挂 settled 探针，赢家 settle 后探针返回 true', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const cA = cfg();
        const cB = cfg();
        const pA = $race(adp, map, 'k1', cA);
        const pB = $race(adp, map, 'k1', cB);
        const probeA = (cA as any)[SHARE_SETTLED_KEY] as () => boolean;
        const probeB = (cB as any)[SHARE_SETTLED_KEY] as () => boolean;
        expect(typeof probeA).toBe('function');
        expect(typeof probeB).toBe('function');
        // 还没人赢
        expect(probeA()).toBe(false);
        expect(probeB()).toBe(false);
        // B 先成功
        pending[1].resolve(mockResp('FAST'));
        await Promise.all([pA, pB]);
        // 两个 caller 的 config 上探针都翻 true（它们共享同一个 entry）
        expect(probeA()).toBe(true);
        expect(probeB()).toBe(true);
    });
});
