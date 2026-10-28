import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('TokenManager — 存储不可用环境', () => {
  it('[public.member.TokenManager.canRefresh][public.member.TokenManager.set][public.member.TokenManager.clear] set/clear 不重置刷新许可，登录方必须显式恢复', async () => {
    const { default: TM } = await import('../../../src/objects/TokenManager');
    const tm = new TM();
    tm.canRefresh = false;
    tm.set('login');
    expect(tm.canRefresh).toBe(false);
    tm.clear();
    expect(tm.canRefresh).toBe(false);
    tm.canRefresh = true;
    expect(tm.canRefresh).toBe(true);
  });
  const realDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const restore = () => {
    if (realDesc) Object.defineProperty(globalThis, 'localStorage', realDesc);
    else delete (globalThis as any).localStorage;
    vi.resetModules();
  };

  it('[public.member.TokenManager.constructor] 访问 localStorage 抛 SecurityError：模块导入不崩，内存态照常工作', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('denied', 'SecurityError'); },
    });
    vi.resetModules();
    try {
      const { default: TM } = await import('../../../src/objects/TokenManager');
      const tm = new TM();
      expect(tm.accessToken).toBeUndefined();
      tm.set('a', 'r');
      expect(tm.accessToken).toBe('Bearer a');
      expect(tm.refreshToken).toBe('r');
      tm.clear();
      expect(tm.accessToken).toBeUndefined();
    } finally { restore(); }
  });

  it('[public.member.TokenManager.constructor][public.member.TokenManager.set][public.member.TokenManager.clear] getItem/setItem/removeItem 抛错（配额/隐私模式）：构造、写入、清除都不抛，内存态照常更新', async () => {
    const boom = () => { throw new Error('QuotaExceeded'); };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: boom, setItem: boom, removeItem: boom },
    });
    vi.resetModules();
    try {
      const { default: TM } = await import('../../../src/objects/TokenManager');
      const tm = new TM();
      expect(() => tm.set('a', 'r')).not.toThrow();
      expect(tm.accessToken).toBe('Bearer a');
      expect(() => tm.clear()).not.toThrow();
      expect(tm.accessToken).toBeUndefined();
    } finally { restore(); }
  });
});

describe('TokenManager — 正常持久化路径', () => {
    it('[public.member.TokenManager.constructor][public.member.TokenManager.set][public.member.TokenManager.clear][public.member.TokenManager.canRefresh] 恢复裸 token、写入和空值删除均同步存储，clear 不重置 canRefresh', async () => {
        const values = new Map([['axp:token:access', 'saved'], ['axp:token:refresh', 'refresh']]);
        const storage = {
            getItem: vi.fn((key: string) => values.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
            removeItem: vi.fn((key: string) => { values.delete(key); }),
        };
        vi.stubGlobal('localStorage', storage);
        vi.resetModules();
        const { default: Manager } = await import('../../../src/objects/TokenManager');
        const tm = new Manager();
        expect(tm.accessToken).toBe('Bearer saved');
        expect(tm.refreshToken).toBe('refresh');
        tm.set('next', 'next-refresh');
        expect(new Manager().accessToken).toBe('Bearer next');
        expect(values.get('axp:token:access')).toBe('next');
        tm.accessToken = '';
        tm.refreshToken = null;
        expect(values.size).toBe(0);
        tm.set('again', 'again-refresh');
        tm.canRefresh = false;
        tm.clear();
        expect(values.size).toBe(0);
        expect(tm.canRefresh).toBe(false);
        expect(tm.accessToken).toBeUndefined();
        expect(tm.refreshToken).toBeUndefined();
    });
});
