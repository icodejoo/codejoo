import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** 装入内存版 localStorage 并重新加载 TokenManager */
async function load(init: Record<string, string> = {}) {
    const values = new Map(Object.entries(init));
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => { values.set(k, v); },
        removeItem: (k: string) => { values.delete(k); },
    });
    vi.resetModules();
    const { default: TM } = await import('../../src/objects/TokenManager');
    return { TM, values };
}

describe('TokenManager — 边界', () => {
    it.each([undefined, null, ''])('[public.member.TokenManager.set.accessToken][public.member.TokenManager.get.accessToken] 写入 %s 视为清除：不带 Bearer、存储键被删', async (v) => {
        const { TM, values } = await load({ 'axp:token:access': 'old' });
        const tm = new TM();
        tm.accessToken = v as any;
        expect(tm.accessToken).toBeUndefined();
        expect(values.has('axp:token:access')).toBe(false);
    });
    it.each([undefined, null, ''])('[public.member.TokenManager.set.refreshToken][public.member.TokenManager.get.refreshToken] 写入 %s 视为清除并删除存储键', async (v) => {
        const { TM, values } = await load({ 'axp:token:refresh': 'old' });
        const tm = new TM();
        tm.refreshToken = v as any;
        expect(tm.refreshToken).toBeUndefined();
        expect(values.has('axp:token:refresh')).toBe(false);
    });
    it('[public.member.TokenManager.get.accessToken][public.member.TokenManager.get.refreshToken] 存储中为空串视为无 token', async () => {
        const { TM } = await load({ 'axp:token:access': '', 'axp:token:refresh': '' });
        const tm = new TM();
        expect(tm.accessToken).toBeUndefined();
        expect(tm.refreshToken).toBeUndefined();
    });
    it('[public.member.TokenManager.set] 无参 set() 清空两者；只传 access 会清除已有 refresh', async () => {
        const { TM, values } = await load({ 'axp:token:access': 'a', 'axp:token:refresh': 'r' });
        const tm = new TM();
        tm.set('a2');
        expect(tm.accessToken).toBe('Bearer a2');
        expect(tm.refreshToken).toBeUndefined();
        tm.set();
        expect(tm.accessToken).toBeUndefined();
        expect(values.size).toBe(0);
    });
    it('[public.member.TokenManager.clear] 对空状态与重复 clear 都安全', async () => {
        const { TM, values } = await load();
        const tm = new TM();
        expect(() => { tm.clear(); tm.clear(); }).not.toThrow();
        expect(values.size).toBe(0);
    });
    it('[public.member.TokenManager.constructor] 无 localStorage（undefined）时构造不抛，仅内存态', async () => {
        vi.stubGlobal('localStorage', undefined);
        vi.resetModules();
        const { default: TM } = await import('../../src/objects/TokenManager');
        const tm = new TM();
        tm.set('a', 'r');
        expect(tm.accessToken).toBe('Bearer a');
        expect(tm.refreshToken).toBe('r');
    });
    it('[public.member.TokenManager.constructor] 多个实例各自内存态独立，但共享存储键', async () => {
        const { TM } = await load();
        const a = new TM();
        const b = new TM();
        a.set('x');
        expect(b.accessToken).toBeUndefined();
        expect(new TM().accessToken).toBe('Bearer x');
    });
    it('[public.member.TokenManager.canRefresh] canRefresh 默认 true，可赋任意布尔，实例间互不影响', async () => {
        const { TM } = await load();
        const a = new TM();
        const b = new TM();
        expect(a.canRefresh).toBe(true);
        a.canRefresh = false;
        expect(b.canRefresh).toBe(true);
    });
    it('[public.export.TokenManager] 模块导出的类可重复实例化，实现 ITokenManager 的全部成员', async () => {
        const { TM } = await load();
        const tm = new TM() as any;
        for (const k of ['set', 'clear']) expect(typeof tm[k]).toBe('function');
        for (const k of ['canRefresh', 'accessToken', 'refreshToken']) expect(k in tm).toBe(true);
    });
});
