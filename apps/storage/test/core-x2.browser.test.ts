import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { proxy, COMMIT } from "../src/proxy";
import { Memory } from "../src/memory";
import { Idb } from "../src/idb";
import { fifo } from "./helpers/fifo";

/** 逆序关闭处理器，再删除本轮数据库。 */
const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
/** 创建隔离的真实 IDB，允许同名连接验证 Hub。 */
function idb(name = 'x2-' + crypto.randomUUID()) {
  const store = new Idb(name);
  cleanups.push(() => new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(name); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }));
  cleanups.push(() => store.destroy()); return store;
}

describe.each([['FIFO', fifo], ['IDB', idb]] as const)('X2 %s', (_name, create) => {
  it.each([false, true])('G1 read own writes memo=%s', async memoized => {
    for (const seeded of [false, true]) {
      const store = create(), h = proxy(store, new Memory(), { namespace: 'ns', memoized }); cleanups.push(() => h.destroy());
      if (seeded) { await h.set('k', 0); expect(await h.get('k')).toBe(0); }
      const set = vi.spyOn(store, 'set'), first = h.set('k', 1), read = h.get('k'), keys = h.keys();
      expect(await read).toBe(1); expect(await keys).toEqual(['k']); await first;
      const a = h.set('k', 2), b = h.set('k', 3), latest = h.get('k');
      expect(await latest).toBe(3); await Promise.all([a, b]);
      expect(set.mock.calls.map(([, text]) => JSON.parse(text).value)).toEqual([1, 2, 3]);
      const clear = h.clear(), after = h.set('k', 4), next = h.get('k');
      expect(await next).toBe(4); await Promise.all([clear, after]);
    }
  });
  it('G3 peer eviction preserves a write waiting for clear', async () => {
    const name = 'x2-peer-' + crypto.randomUUID(), store = _name === 'IDB' ? idb(name) : create(), peer = store instanceof Idb ? new Idb(name) : store;
    const a = proxy(store, new Memory(), { namespace: 'ns', memoized: true }), b = proxy(peer, new Memory(), { namespace: 'ns', memoized: true });
    cleanups.push(() => a.destroy(), () => b.destroy());
    await a.get('k');
    let releaseWrite!: () => void, releaseScan!: () => void, dispatched!: () => void;
    const writeGate = new Promise<void>(resolve => { releaseWrite = resolve; }), scanGate = new Promise<void>(resolve => { releaseScan = resolve; }), ready = new Promise<void>(resolve => { dispatched = resolve; });
    const put = peer.set.bind(peer), list = store.keys!.bind(store);
    vi.spyOn(peer, 'set').mockImplementation(async (key, text) => { await put(key, text); dispatched(); await writeGate; });
    const earlier = b.set('k', 0); await ready;
    vi.spyOn(store, 'keys').mockImplementation(async () => { const keys = await list(); await scanGate; return keys; });
    const clear = a.clear(), later = a.set('k', 1); releaseWrite(); await earlier; releaseScan();
    await Promise.all([earlier, clear, later]); expect(await a.get('k')).toBe(1); expect(await b.get('k')).toBe(1);
  });
  it('G5 clear gates enumeration and purge', async () => {
    const store = create(), h = proxy(store, new Memory(), { namespace: 'ns' }); cleanups.push(() => h.destroy());
    await h.set('k', 1); const clear = h.clear(), keys = h.keys(), length = h.length, key = h.key(0), purge = h.purge();
    expect(await keys).toEqual([]); expect(await length).toBe(0); expect(await key).toBeNull(); await Promise.all([clear, purge]);
  });
});

it.each(['readonly', 'write', 'serialize', 'expiry'])('G2 clear removes old value before skipped or failed set %s', async mode => {
  const store = fifo(), onError = vi.fn(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await store.set('ns:k', JSON.stringify({ value: 'old' }));
  const h = proxy(store, new Memory(), { namespace: 'ns', readonly: mode === 'readonly', onError, serialize: mode === 'serialize' ? () => { throw new Error('serialize'); } : undefined });
  cleanups.push(() => h.destroy());
  if (mode === 'write') vi.spyOn(store, 'set').mockRejectedValue(new Error('write'));
  const clear = h.clear(), set = h.set('k', 'default', mode === 'expiry' ? { expireAt: 'invalid' } : undefined);
  await Promise.all([clear, set]); expect(await h.get('k')).toBe(mode === 'readonly' ? 'default' : null);
  expect(await store.get('ns:k')).toEqual(mode === 'readonly' ? expect.any(String) : null);
  if (mode === 'write' || mode === 'serialize') expect(onError).toHaveBeenCalledOnce();
  if (mode === 'expiry') expect(warn).toHaveBeenCalledOnce();
});

it('G4 failed clear does not reject queued reads and writes', async () => {
  const store = fifo(), error = new Error('clear'), h = proxy(store, new Memory(), { onError: () => { throw error; } }); cleanups.push(() => h.destroy());
  vi.spyOn(store, 'clear').mockRejectedValue(error);
  const clear = h.clear(), rejected = expect(clear).rejects.toBe(error), write = h.set('k', 1), read = h.get('k');
  await rejected; await expect(write).resolves.toBeUndefined(); expect(await read).toBe(1);
});

it('G5 synchronous queries preserve their return types', () => {
  const h = proxy(new Memory(), new Memory(), { namespace: 'ns' }); h.set('k', 1);
  expectTypeOf(h.clear()).toEqualTypeOf<void>(); expectTypeOf(h.keys()).toEqualTypeOf<string[]>();
  expectTypeOf(h.length).toEqualTypeOf<number>(); expectTypeOf(h.key(0)).toEqualTypeOf<string | null>(); expectTypeOf(h.purge()).toEqualTypeOf<void>();
  expect(h.keys()).toEqual([]); expect(h.length).toBe(0); expect(h.key(0)).toBeNull(); expect(h.purge()).toBeUndefined(); h.destroy();
});

it('G9 plain clear blocks backend dispatch until the barrier settles', async () => {
  const store = fifo(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(store, 'clear').mockReturnValue(gate);
  const get = vi.spyOn(store, 'get'), set = vi.spyOn(store, 'set'), keys = vi.spyOn(store, 'keys'), key = vi.spyOn(store, 'key'), length = vi.spyOn(store, 'length');
  const h = proxy(store, new Memory()); cleanups.push(() => h.destroy());
  const clear = h.clear(), read = h.get('k'), write = h.set('k', 1), list = h.keys(), count = h.length, first = h.key(0), purge = h.purge();
  expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(keys).not.toHaveBeenCalled(); expect(key).not.toHaveBeenCalled(); expect(length).not.toHaveBeenCalled();
  release(); await Promise.all([clear, read, write, list, count, first, purge]);
  expect(get).toHaveBeenCalled(); expect(set).toHaveBeenCalledOnce(); expect(keys).toHaveBeenCalledTimes(2); expect(key).toHaveBeenCalledOnce(); expect(length).toHaveBeenCalledOnce();
});

it('G6 partial clear suppresses COMMIT and invalidates peer memo', async () => {
  const store = fifo(), memo = new Memory(), onError = vi.fn(), a = proxy(store, new Memory(), { namespace: 'ns', onError }), b = proxy(store, memo, { namespace: 'ns', memoized: true });
  cleanups.push(() => a.destroy(), () => b.destroy()); await a.set('a', 1); await a.set('b', 2); await b.get('a'); await b.get('b');
  const remove = store.remove.bind(store); vi.spyOn(store, 'remove').mockImplementation(key => key === 'ns:a' ? Promise.reject(new Error('remove')) : remove(key));
  const commit = vi.fn(); a[COMMIT](commit); await a.clear();
  expect(commit).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce(); expect(memo.length).toBe(0);
  expect(await b.get('a')).toBe(1); expect(await b.get('b')).toBeNull();
});

it('G7 primitive default for stored null still renews sliding expiry', () => {
  const store = new Memory(), onError = vi.fn(), h = proxy(store, new Memory(), { sliding: true, onError });
  vi.spyOn(Date, 'now').mockReturnValue(10000); h.set('k', null, 1000);
  vi.spyOn(Date, 'now').mockReturnValue(10500); expect(h.get('k', 0)).toBe(0);
  expect(JSON.parse(store.get('k')!).expireAt).toBe(11500); expect(onError).not.toHaveBeenCalled(); h.destroy();
});
