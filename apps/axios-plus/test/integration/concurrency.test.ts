// Integration coverage for the concurrency plugin.
//   - max=N ⇒ 同时最多 N 个 HTTP 在飞，超出排队
//   - 用 /slow?ms=K 制造可预测的耗时，断言派发时序

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { concurrencyPlugin } from '../../src';
import { startHarness, stopHarness, type IntegrationHarness } from './_helpers';

describe('concurrency plugin — integration', () => {
    let h: IntegrationHarness;
    beforeAll(async () => { h = await startHarness(); });
    afterAll(async () => { await stopHarness(h); });
    afterEach(() => {
        const names = h.api.plugins().map(p => p.name).reverse();
        for (const name of names) h.api.eject(name);
    });

    it('max=2，发 4 个 ~200ms 请求 ⇒ 总耗时 ≈ 2 × 200 ms', async () => {
        h.api.use([concurrencyPlugin({ max: 2 })]);
        const t0 = Date.now();
        await Promise.all([
            h.ax.get('/slow?ms=200'),
            h.ax.get('/slow?ms=200'),
            h.ax.get('/slow?ms=200'),
            h.ax.get('/slow?ms=200'),
        ]);
        const elapsed = Date.now() - t0;
        // 期待 ~400ms（两个批次），允许网络抖动 ±200ms
        expect(elapsed).toBeGreaterThanOrEqual(380);
        expect(elapsed).toBeLessThan(900);
    });

    it('max=∞（max <= 0）⇒ 全部并发，~200ms', async () => {
        h.api.use([concurrencyPlugin({ max: 0 })]);
        const t0 = Date.now();
        await Promise.all([
            h.ax.get('/slow?ms=200'),
            h.ax.get('/slow?ms=200'),
            h.ax.get('/slow?ms=200'),
            h.ax.get('/slow?ms=200'),
        ]);
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeLessThan(500);
    });

    it('config.concurrency: false ⇒ 单次绕过队列', async () => {
        h.api.use([concurrencyPlugin({ max: 1 })]);
        const t0 = Date.now();
        // 第一个占住唯一槽位
        const p1 = h.ax.get('/slow?ms=300');
        // 第二个 bypass：并行而非排队
        const p2 = h.ax.get('/slow?ms=300', { concurrency: false } as any);
        await Promise.all([p1, p2]);
        const elapsed = Date.now() - t0;
        // 两者并发 ~300ms 而非串行 600ms
        expect(elapsed).toBeLessThan(500);
    });

    it('priority 跳队：先打满槽位 + 高优先级在低优先级前完成', async () => {
        h.api.use([concurrencyPlugin({ max: 1 })]);

        // 占满唯一槽位
        const filler = h.ax.get('/slow?ms=300');
        await new Promise((r) => setTimeout(r, 30));

        const finishOrder: string[] = [];
        const t0 = Date.now();
        const lo = h.ax.get('/slow?ms=50', { priority: 1 } as any).then(() => {
            finishOrder.push(`lo@${Date.now() - t0}`);
        });
        // 50ms 后再加一个高优先级（确保它入队时低优先级已在队列里）
        await new Promise((r) => setTimeout(r, 50));
        const hi = h.ax.get('/slow?ms=50', { priority: 10 } as any).then(() => {
            finishOrder.push(`hi@${Date.now() - t0}`);
        });

        await Promise.all([filler, lo, hi]);
        // 高优先级应该先于低优完成
        expect(finishOrder[0]).toMatch(/^hi@/);
        expect(finishOrder[1]).toMatch(/^lo@/);
    });

    it('methods 白名单：POST 不在内时不计并发', async () => {
        h.api.use([concurrencyPlugin({ max: 1, methods: ['get'] })]);
        const t0 = Date.now();
        // 占满 GET 槽位
        const p1 = h.ax.get('/slow?ms=300');
        // POST 不入队 ⇒ 并行
        const p2 = h.ax.post('/echo', { ms: 300 });
        await Promise.all([p1, p2]);
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeLessThan(500);
    });

    // 注：config.concurrency / priority 的 delete 是单测覆盖范围（adapter 内部行为，
    // axios.request 内部 clone 配置后才传给 adapter，原 config 引用不会被改）。
    // 集成层不再断言该实现细节。
});
