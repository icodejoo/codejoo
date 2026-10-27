import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import cache from '../src/plugins/cache';
import share, {
    $resolvePolicy,
    $createEntry,
    $end,
    $race,
    $start,
    $follow,
    type ISharedOptions,
} from '../src/plugins/share';


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
//  $start：相同 key 并发请求复用首发的 promise，HTTP 只发一次，无内部重试
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
});


// ───────────────────────────────────────────────────────────────────────────
//  兼容性 / 异常 / config 归属
// ───────────────────────────────────────────────────────────────────────────

describe('share — 不依赖 Promise.withResolvers（ES2024）', () => {
    it('环境缺少 Promise.withResolvers 时 $createEntry 照常工作', async () => {
        const orig = (Promise as any).withResolvers;
        (Promise as any).withResolvers = undefined;
        try {
            const map = new Map();
            const e = $createEntry(map, 'k');
            expect(map.get('k')).toBe(e);
            e.resolve(mockResp('ok'));
            await expect(e.promise).resolves.toMatchObject({ data: 'ok' });
            await Promise.resolve();
            expect(map.has('k')).toBe(false); // settle 后自动清理
        } finally {
            (Promise as any).withResolvers = orig;
        }
    });
});


describe('share — prev 同步抛错不会让条目永久挂起', () => {
    const syncThrowOnce = () => {
        let first = true;
        return vi.fn((_config: any) => {
            if (first) { first = false; throw new Error('sync boom'); }
            return Promise.resolve(mockResp('ok'));
        }) as unknown as AxiosAdapter;
    };

    it.each([
        ['start', $start],
        ['end', $end],
        ['race', $race],
    ] as const)('%s：首次同步抛错 → reject；同 key 第二次请求拿到结果', async (_name, run) => {
        const map = new Map();
        const adp = syncThrowOnce();
        await expect(run(adp, map, 'k', cfg())).rejects.toThrow('sync boom');
        const r = await run(adp, map, 'k', cfg());
        expect(r.data).toBe('ok');
    });

    it('install 级：内层 cache 的 key 函数同步抛错后，同 key 后续请求不挂起（同时覆盖裸 axios.create()）', async () => {
        const net = vi.fn(async (config: any) => ({ status: 200, statusText: 'OK', headers: {}, config, data: 'real' }) as any);
        const ax = axios.create({ adapter: [net as any] });
        let first = true;
        cache({ key: () => { if (first) { first = false; throw new Error('key boom'); } return 'ck'; } }).install(ax);
        share().install(ax);
        const opt = { key: 'same', share: true, cache: true } as any;
        await expect(ax.get('/x', { ...opt })).rejects.toThrow('key boom');
        const r = await Promise.race([
            ax.get('/x', { ...opt }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 500)),
        ]) as any;
        expect(r.data).toBe('real');
    });
});


describe('share — 共享响应按调用方换上各自的 config', () => {
    it('并发同 key 的每个 caller 拿到的 response.config 就是自己的 config，data 共享', async () => {
        const data = { v: 1 };
        const ax: any = {
            defaults: {
                adapter: vi.fn(async () => ({ status: 200, statusText: 'OK', headers: {}, config: { first: true }, data })),
            },
        };
        share().install(ax);
        const wrapped = ax.defaults.adapter as AxiosAdapter;
        const c1: any = { key: 'k' };
        const c2: any = { key: 'k' };
        const [r1, r2] = await Promise.all([wrapped(c1), wrapped(c2)]);
        expect(r1.config).toBe(c1);
        expect(r2.config).toBe(c2);
        expect(r1.data).toBe(data);
        expect(r2.data).toBe(data);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  B4：start 下 leader 单独取消不连带 follower
// ───────────────────────────────────────────────────────────────────────────

describe('$start 取消语义', () => {
    /** 构造带独立 AbortController 的订阅者：返回 config、ctrl 与 $follow 后的 promise */
    const sub = (adp: AxiosAdapter, map: Map<string, any>) => {
        const ctrl = new AbortController();
        const config = { signal: ctrl.signal } as any as InternalAxiosRequestConfig;
        const p = $follow($start(adp, map, 'k1', config), config);
        p.catch(() => {}); // 避免晚挂 handler 触发 unhandled 告警
        return { ctrl, p };
    };

    it('leader 取消：自己 canceled，follower 仍拿到结果，底层不 abort', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        const F = sub(adp, map);
        const underlying = pending[0].config.signal as AbortSignal;
        L.ctrl.abort();
        await expect(L.p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        expect(underlying.aborted).toBe(false);
        pending[0].resolve(mockResp('ok'));
        await expect(F.p).resolves.toMatchObject({ data: 'ok' });
        expect(adp).toHaveBeenCalledOnce();
    });

    it('底层请求不带 leader 的 signal', () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        expect(pending[0].config.signal).not.toBe(L.ctrl.signal);
        L.ctrl.abort();
        return expect(L.p).rejects.toBeDefined();
    });

    it('全部订阅者都取消才 abort 底层，并摘除 entry', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        const F = sub(adp, map);
        const underlying = pending[0].config.signal as AbortSignal;
        L.ctrl.abort();
        expect(underlying.aborted).toBe(false);
        F.ctrl.abort();
        expect(underlying.aborted).toBe(true);
        expect(map.size).toBe(0);
        await expect(L.p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        await expect(F.p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        // 全取消后新请求重新发 HTTP
        const N = sub(adp, map);
        expect(adp).toHaveBeenCalledTimes(2);
        pending[1].resolve(mockResp('new'));
        await expect(N.p).resolves.toMatchObject({ data: 'new' });
    });

    it('leader 取消后新订阅者加入：仍复用同一请求并拿到结果', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const L = sub(adp, map);
        const F1 = sub(adp, map);
        L.ctrl.abort();
        const F2 = sub(adp, map);
        expect(adp).toHaveBeenCalledOnce();
        F1.ctrl.abort();
        // F2 还在，底层不能 abort
        expect((pending[0].config.signal as AbortSignal).aborted).toBe(false);
        pending[0].resolve(mockResp('late'));
        await expect(F2.p).resolves.toMatchObject({ data: 'late' });
        await expect(F1.p).rejects.toBeDefined();
    });

    it('已中止 signal 的单一订阅者：直接 canceled 且底层被 abort', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const ctrl = new AbortController();
        ctrl.abort();
        const config = { signal: ctrl.signal } as any as InternalAxiosRequestConfig;
        const p = $follow($start(adp, map, 'k1', config), config);
        p.catch(() => {}); // 避免晚挂 handler 触发 unhandled 告警
        await expect(p).rejects.toMatchObject({ code: 'ERR_CANCELED' });
        expect((pending[0].config.signal as AbortSignal).aborted).toBe(true);
        expect(map.size).toBe(0);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  B5：race 下 business 风格失败（200 + 非成功 code）不算赢家
// ───────────────────────────────────────────────────────────────────────────

describe('$race business 风格', () => {
    const bizFail = (msg: string) => mockResp({ code: 500, message: msg, data: null });
    const bizOk = (v: any) => mockResp({ code: 0, message: 'ok', data: v });

    it('先到的 200+code500 不算赢家，后到成功者胜出', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A fail'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(bizOk('B'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data.data).toBe('B');
        expect(b.data.data).toBe('B');
    });

    it('adapter 层 data 是未解析的 JSON 字符串时，200+code500 同样不算赢家', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(mockResp(JSON.stringify({ code: 500, message: 'A fail', data: null })));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(mockResp(JSON.stringify({ code: 0, message: 'ok', data: 'B' })));
        const [a, b] = await Promise.all([pA, pB]);
        expect(JSON.parse(a.data).data).toBe('B');
        expect(JSON.parse(b.data).data).toBe('B');
    });

    it('先失败者之后又有 reject，再来成功者仍胜出', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        const pC = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A'));
        pending[1].reject(new Error('B net'));
        await new Promise((r) => setTimeout(r, 0));
        pending[2].resolve(bizOk('C'));
        const [a] = await Promise.all([pA, pB, pC]);
        expect(a.data.data).toBe('C');
    });

    it('全部业务失败：resolve 最后一个失败响应（与不装 share 时形态一致）', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].resolve(bizFail('B'));
        const [a, b] = await Promise.all([pA, pB]);
        expect(a.data.message).toBe('B');
        expect(b.data.message).toBe('B');
    });

    it('最后落定的是 reject：以该 error reject', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[0].resolve(bizFail('A'));
        await new Promise((r) => setTimeout(r, 0));
        pending[1].reject(new Error('B net'));
        await expect(pA).rejects.toThrow('B net');
        await expect(pB).rejects.toThrow('B net');
    });

    it('http 风格（无 code 信封）：首个 resolve 仍直接胜出', async () => {
        const map = new Map();
        const { adp, pending } = deferredAdapter();
        const pA = $race(adp, map, 'k1', cfg());
        const pB = $race(adp, map, 'k1', cfg());
        pending[1].resolve(mockResp('FAST'));
        const [a] = await Promise.all([pA, pB]);
        expect(a.data).toBe('FAST');
    });
});
