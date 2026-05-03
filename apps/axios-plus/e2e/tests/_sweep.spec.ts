// 卡片 sweep —— 真的点每张卡片每个按钮，监控 network + console 找问题。
// 不做强断言，只收集 raw 数据后打到 stdout，让我们看哪里行为不对。

import { test, expect } from '@playwright/test';
import type { ConsoleMessage, Request, Response } from '@playwright/test';


test('点遍每张卡片每个按钮，记录 network + console + log 内容', async ({ page }) => {
    test.setTimeout(180_000);

    type ReqLog = { method: string; url: string; status: number | null };
    const reqs: ReqLog[] = [];
    const errors: { type: 'console' | 'pageerror'; text: string }[] = [];

    page.on('request', (r: Request) => {
        // 只关心打到 /api/* 的业务请求 + 可疑的 mock URL
        if (r.url().includes('/api/') || r.url().includes('localhost:3030') || r.url().includes('localhost:0')) {
            reqs.push({ method: r.method(), url: r.url(), status: null });
        }
    });
    page.on('response', (r: Response) => {
        const last = reqs.find((x) => x.url === r.url() && x.status === null);
        if (last) last.status = r.status();
    });
    page.on('console', (m: ConsoleMessage) => {
        if (m.type() === 'error' || m.type() === 'warning') {
            errors.push({ type: 'console', text: `[${m.type()}] ${m.text()}` });
        }
    });
    page.on('pageerror', (e) => {
        errors.push({ type: 'pageerror', text: e.message });
    });

    await page.goto('/');
    await page.waitForFunction(() => {
        const h = (window as any).__http;
        return !!h && typeof h.api?.plugins === 'function' && h.api.plugins().length >= 15;
    }, undefined, { timeout: 15_000 });

    // 触发 fixture 等的 reset 路径：清缓存 + 重置 auth
    await page.evaluate(() => {
        const h = (window as any).__http;
        h.auth.reset();
        return h.clearCache();
    });

    const cards = page.locator('section.card');
    const cardCount = await cards.count();

    const report: Array<{
        cardIdx: number;
        title: string;
        actionLabel: string;
        log: string;
        reqsAfter: ReqLog[];
        errorsAfter: { type: string; text: string }[];
        durationMs: number;
    }> = [];

    for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i);
        const title = (await card.locator('h2').textContent()) ?? '';
        const buttons = card.locator('button');
        const btnCount = await buttons.count();

        for (let b = 0; b < btnCount; b++) {
            const btn = buttons.nth(b);
            const label = (await btn.textContent()) ?? '';

            const reqsBefore = reqs.length;
            const errorsBefore = errors.length;
            const t0 = Date.now();

            await btn.click();
            // 等卡片 log 区有"完成态"信号 —— 简单等 button 重新可点（onclick 设 disable→done 后 re-enable）
            try {
                await expect(btn).toBeEnabled({ timeout: 30_000 });
            } catch {
                // 长动作（loading 慢请求等）超时也别炸 sweep
            }

            const log = (await card.locator('pre.log').textContent()) ?? '';
            const reqsAfter = reqs.slice(reqsBefore);
            const errorsAfter = errors.slice(errorsBefore);

            report.push({
                cardIdx: i,
                title: title.trim(),
                actionLabel: label.trim(),
                log: log.trim().slice(0, 400),
                reqsAfter,
                errorsAfter,
                durationMs: Date.now() - t0,
            });
        }
    }

    // 用 console.log 打总报告 —— playwright reporter 会 forward 出来
    console.log('\n\n========== CARD SWEEP REPORT ==========\n');
    for (const r of report) {
        console.log(`\n--- [${r.cardIdx}] ${r.title} → "${r.actionLabel}" (${r.durationMs}ms)`);
        if (r.errorsAfter.length) {
            console.log(`  ⚠ errors:`);
            for (const e of r.errorsAfter) console.log(`      ${e.type}: ${e.text}`);
        }
        if (r.reqsAfter.length) {
            console.log(`  network (${r.reqsAfter.length}):`);
            for (const q of r.reqsAfter) console.log(`      ${q.method} ${q.status ?? '???'} ${q.url}`);
        }
        // 摘录 log 的前几行
        const logHead = r.log.split('\n').slice(0, 4).join(' | ');
        if (logHead) console.log(`  log: ${logHead}`);
    }
    console.log('\n========== END OF SWEEP REPORT ==========\n');

    // 软断言：只有"严重错误"才让 sweep 失败 —— 让我们能拿到完整 report 再修
    const hard = report.flatMap((r) => r.errorsAfter.filter((e) => e.type === 'pageerror'));
    expect(hard, 'pageerror should be empty').toEqual([]);
});
