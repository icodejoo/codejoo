import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** 装入内存版 localStorage 并重新加载 TokenManager，返回类与底层存储 */
async function load(init: Record<string, string> = {}) {
    const values = new Map(Object.entries(init));
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => { values.set(k, v); },
        removeItem: (k: string) => { values.delete(k); },
    });
    vi.resetModules();
    const { default: TM } = await import('../../../src/objects/TokenManager');
    return { TM, values };
}

describe('TokenManager — 访问器规则', () => {
    it('[public.member.TokenManager.get.accessToken][public.member.TokenManager.set.accessToken] 读取带 Bearer 前缀，写入存裸值，未设置时 undefined', async () => {
        const { TM, values } = await load();
        const tm = new TM();
        expect(tm.accessToken).toBeUndefined();
        tm.accessToken = 'abc';
        expect(tm.accessToken).toBe('Bearer abc');
        expect(values.get('axp:token:access')).toBe('abc');
    });
    it('[public.member.TokenManager.get.refreshToken][public.member.TokenManager.set.refreshToken] refreshToken 原样读写并持久化，不加前缀', async () => {
        const { TM, values } = await load();
        const tm = new TM();
        expect(tm.refreshToken).toBeUndefined();
        tm.refreshToken = 'r1';
        expect(tm.refreshToken).toBe('r1');
        expect(values.get('axp:token:refresh')).toBe('r1');
        expect(new TM().refreshToken).toBe('r1');
    });
});
