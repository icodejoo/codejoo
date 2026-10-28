import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import cache, { clearCache, removeCache } from '../../../src/plugins/cache';

/** 构造 adapter 层原始响应。 */
function response(data: unknown, config: any = {}) {
  return { data, config, status: 200, statusText: '', headers: {} };
}

describe('cache — 插件契约（name / install / cleanup）', () => {
  it('[cache.prop.name] 插件名为 axp:cache', () => {
    expect(cache().name).toBe('axp:cache');
  });

  it('[cache.method.install] install 把 adapter 包成新函数并返回 cleanup，缓存仓随之可用', async () => {
    const adapter = vi.fn(async (c: any) => response('ok', c));
    const ax = axios.create({ adapter });
    const before = ax.defaults.adapter;
    const off = cache().install(ax);
    expect(typeof off).toBe('function');
    expect(ax.defaults.adapter).not.toBe(before);
    await ax.get('/', { key: 'k', cache: true });
    expect(removeCache(ax, 'k')).toBe(true);
  });

  it('[cache.method.cleanup] cleanup 后 adapter 恢复、缓存清空，再请求不再命中', async () => {
    const adapter = vi.fn(async (c: any) => response('ok', c));
    const ax = axios.create({ adapter });
    const before = ax.defaults.adapter;
    const off = cache().install(ax) as () => void;
    await ax.get('/', { key: 'k', cache: true });
    off();
    expect(ax.defaults.adapter).toBe(before);
    expect(clearCache(ax)).toBe(0);
    await ax.get('/', { key: 'k', cache: true });
    await ax.get('/', { key: 'k', cache: true });
    expect(adapter).toHaveBeenCalledTimes(3);
  });
});

describe('cache — storage / memory 选项仅保留类型，工厂不消费', () => {
  it('[cache.opt.storage][cache.cb.storage.getItem][cache.cb.storage.setItem][cache.cb.storage.removeItem][cache.cb.storage.clear] 传入 storage 后四个方法在读写/失效全流程中都不被调用', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const adapter = vi.fn(async (c: any) => response('ok', c));
    const ax = axios.create({ adapter });
    cache({ storage }).install(ax);
    await ax.get('/', { key: 'k', cache: true });
    await ax.get('/', { key: 'k', cache: true });
    removeCache(ax, 'k');
    clearCache(ax);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
  });

  it('[cache.opt.memory] memory 取 true/false 均不改变行为：始终使用进程内缓存', async () => {
    for (const memory of [true, false]) {
      const adapter = vi.fn(async (c: any) => response('ok', c));
      const ax = axios.create({ adapter });
      cache({ memory }).install(ax);
      await ax.get('/', { key: 'k', cache: true });
      await ax.get('/', { key: 'k', cache: true });
      expect(adapter).toHaveBeenCalledTimes(1);
    }
  });
});

describe('cache — 请求级 cache.key 回调', () => {
  it('[cache.req.cache.key.callback] 回调拿到本次 config，返回值作为缓存 key（优先于 config.key）', async () => {
    const adapter = vi.fn(async (c: any) => response('ok', c));
    const ax = axios.create({ adapter });
    cache().install(ax);
    const keyFn = vi.fn((c: any) => `u:${c.params.id}`);
    await ax.get('/', { key: 'ignored', params: { id: 1 }, cache: { key: keyFn } } as any);
    expect(keyFn).toHaveBeenCalledOnce();
    expect(keyFn.mock.calls[0][0].params).toEqual({ id: 1 });
    expect(removeCache(ax, 'u:1')).toBe(true);
    expect(removeCache(ax, 'ignored')).toBe(false);
  });
});
