import { sleep } from '../../helpers/sleep';
import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpRetry } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import cancel, { cancelAll } from '../../../src/plugins/cancel';

describe('cancel — 与 cache / share / retry 组合（Axp.install 规范顺序）', () => {
    it('[cancel.fn.cancelAll × retry.opt.max] cancel + retry：重试等待期间 cancelAll 能中止（返回 1），请求以取消告终', async () => {
        const net = makeNetwork();
        net.fallback(() => ({ status: 500 }));
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { cancel: cancel(), retry: axpRetry({ max: 2, delay: 200 }) });
        const p = ax.get('/r').then(() => 'ok' as const, (e) => e);
        await sleep(60);                       // 首次 500 已返回，正在等待重试
        expect(cancelAll(ax)).toBe(1);
        const out: any = await p;
        expect(axios.isCancel(out)).toBe(true);
        expect(net.calls('GET', '/r')).toBe(1); // 取消后没有再发第二次
    });

    it('[cancel.fn.cancelAll × retry.opt.max] cancel + retry：重试最终成功后 controller 被释放（cancelAll 返回 0）', async () => {
        const net = makeNetwork();
        net.fallback((_c, hit) => (hit < 2 ? { status: 500 } : { data: { code: 0, data: 'ok' } }));
        const ax = axios.create({ adapter: net.adapter });
        Axp.install(ax, { cancel: cancel(), retry: axpRetry({ max: 2, delay: 1 }) });
        const r = await ax.get('/r2');
        expect(r.status).toBe(200);
        expect(net.calls('GET', '/r2')).toBe(2);
        expect(cancelAll(ax)).toBe(0);
    });
});
