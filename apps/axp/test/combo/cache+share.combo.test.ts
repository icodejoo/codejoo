import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import type { AxiosAdapter, AxiosResponse } from 'axios';
import cache from '../../src/plugins/cache';
import share from '../../src/plugins/share';

const mockResp = (data: any): AxiosResponse =>
    ({ status: 200, statusText: 'OK', headers: {}, config: {} as any, data } as any);

describe('share — prev 同步抛错不会让条目永久挂起', () => {
    const syncThrowOnce = () => {
        let first = true;
        return vi.fn((_config: any) => {
            if (first) { first = false; throw new Error('sync boom'); }
            return Promise.resolve(mockResp('ok'));
        }) as unknown as AxiosAdapter;
    };

    it('[cache.cb.key × share.opt.policy] install 级：内层 cache 的 key 函数同步抛错后，同 key 后续请求不挂起（同时覆盖裸 axios.create()）', async () => {
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
