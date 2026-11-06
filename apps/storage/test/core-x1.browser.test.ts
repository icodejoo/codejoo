import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy, COMMIT } from "../src/proxy";
import { Memory } from "../src/memory";
import { Idb } from "../src/idb";
import { invalidate, memoHub } from "../src/hub";
import { parseEntity, isExpired, renewOf, mkEntity } from "../src/entity";
import { crossTab } from "../src/sync";
import { fifo } from "./helpers/fifo";

/** 保留真实通道供异步集成用例使用。 */
const NativeChannel = BroadcastChannel;
/** 统一释放处理器和数据库连接。 */
const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
/** 分配独立真实 IDB 并登记清理。 */
function idb(name = "x1-" + crypto.randomUUID()) {
  const store = new Idb(name);
  cleanups.push(() => new Promise<void>((resolve, reject) => { const req = indexedDB.deleteDatabase(name); req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); }));
  cleanups.push(() => store.destroy());
  return store;
}

describe.each([['FIFO', fifo], ['IDB', idb]] as const)("X1 %s", (_name, create) => {
  it.each(['destroy', 'namespace', 'hub'])("F1 pending write survives %s in its original namespace", async action => {
    const store = create(), memo = new Memory(), h = proxy(store, memo, { namespace: 'old', memoized: true });
    const write = h.set('k', 1);
    const close = action === 'destroy' ? h.destroy() : undefined;
    if (action === 'namespace') h.setNamespace('new');
    if (action === 'hub') invalidate(store.area ?? store, null);
    await write; await close;
    expect(JSON.parse((await store.get('old:k'))!).value).toBe(1);
    expect(await store.get('new:k')).toBeNull(); expect(memo.length).toBe(0);
    await h.destroy();
  });
  it.each(['', 'ns'])("F2 clear before get waits for removal namespace=%s", async namespace => {
    const store = create(), h = proxy(store, new Memory(), { namespace, memoized: true });
    await h.set('token', 'old'); const clear = h.clear(), read = h.get('token', 'default');
    await clear; expect(await read).toBe('default'); expect(await store.length()).toBe(0); await h.destroy();
  });
});

it('F2 synchronous clear before get returns default', () => {
  const store = new Memory(), h = proxy(store, new Memory(), { namespace: 'ns' });
  h.set('token', 'old'); h.clear(); expect(h.get('token', 'default')).toBe('default'); expect(store.length).toBe(0); h.destroy();
});

it('F3 historical envelopes preserve null metadata without corrupt reports', () => {
  const store = new Memory(), onError = vi.fn(), h = proxy(store, new Memory(), { sliding: true, onError });
  const now = Date.now();
  for (const metadata of [{}, { createdAt: now }, { createdAt: now, ttl: null, expireAt: null }, { createdAt: now, ttl: null }, { createdAt: now, ttl: 10000, expireAt: now + 10000 }, { createdAt: now, expireAt: now + 10000 }]) {
    const text = JSON.stringify({ value: 1, ...metadata }); store.set('k', text);
    expect(h.get('k')).toBe(1); expect(store.get('k')).toBe(text);
    const entity = parseEntity(text); expect(isExpired(entity, now)).toBe(false); expect(renewOf(entity, now)).toBeUndefined();
  }
  const expiring = parseEntity(JSON.stringify({ value: 1, createdAt: now - 10000, ttl: 10000, expireAt: now + 1 }));
  expect(isExpired(expiring, now + 1)).toBe(true); expect(renewOf(expiring, now)?.expireAt).toBe(now + 10000);
  expect(onError).not.toHaveBeenCalled(); h.destroy();
});

it('F5 stored null silently uses primitive defaults and preserves data', () => {
  const store = new Memory(), onError = vi.fn(), error = vi.spyOn(console, 'error').mockImplementation(() => {}), h = proxy(store, new Memory(), { onError });
  h.set('k', null); const text = store.get('k');
  for (const fallback of [1, 'default', false, 1n]) expect(h.get('k', fallback)).toBe(fallback);
  const plain = proxy(store, new Memory()); expect(plain.get('k', 1)).toBe(1); plain.destroy();
  expect(store.get('k')).toBe(text); expect(onError).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  h.set('k', 'bad'); expect(h.get('k', 1)).toBe(1); expect(onError.mock.calls[0][0].kind).toBe('type'); expect(store.get('k')).not.toBeNull(); h.destroy();
});

it('F9 readonly force retries after purging expired data', () => {
  const store = new Memory(), h = proxy(store, new Memory(), { readonly: true }), original = store.set.bind(store);
  store.set('dead', JSON.stringify({ value: 0, createdAt: 1, expireAt: 2 }));
  const set = vi.spyOn(store, 'set').mockImplementation((key, value) => { if (store.get('dead')) throw new DOMException('quota', 'QuotaExceededError'); original(key, value); });
  h.set('k', 1); expect(set).toHaveBeenCalledTimes(2); expect(store.get('dead')).toBeNull(); expect(h.get('k')).toBe(1); h.destroy();
});

it.each(['', 'ns'])('F12 clear emits one COMMIT and one broadcast namespace=%s', namespace => {
  const post = vi.fn(); vi.stubGlobal('BroadcastChannel', class { postMessage = post; close() {} });
  const h = proxy(new Memory('local'), new Memory(), { namespace }), stop = crossTab(h, 'x1-clear');
  h.set('a', 1); h.set('b', 2); post.mockClear(); const commit = vi.fn(); h[COMMIT](commit); h.clear();
  expect(commit).toHaveBeenCalledTimes(1); expect(commit.mock.calls[0][0].op).toBe('clear'); expect(post).toHaveBeenCalledTimes(1); stop(); h.destroy();
});

it('F4 crossTab mounts without crypto.randomUUID', () => {
  vi.stubGlobal('crypto', { randomUUID: undefined });
  const h = proxy(new Memory('local'), new Memory()); expect(() => { const stop = crossTab(h, 'x1-no-uuid'); stop(); }).not.toThrow(); h.destroy();
});

it('F10 real BroadcastChannel replays expired SET as stamped REMOVE', async () => {
  const name = 'x1-real-' + crypto.randomUUID(), h = proxy(new Memory('local'), new Memory()), stop = crossTab(h, name), sender = new NativeChannel(name);
  cleanups.push(() => { sender.close(); stop(); h.destroy(); });
  h.set('k', 'old'); const ts = Date.now() + 10000;
  sender.postMessage({ v: 2, op: 'set', ns: '', key: 'k', payload: '{"value":"expired","createdAt":1}', expireAt: 1, ts, from: 'remote' });
  await vi.waitFor(() => expect(h.get('k')).toBeNull());
  sender.postMessage({ v: 2, op: 'set', ns: '', key: 'k', payload: '{"value":"stale"}', ts: ts - 1, from: 'remote' });
  // 同一发送端 FIFO；哨兵交付时前一条消息已经处理。
  sender.postMessage({ v: 2, op: 'set', ns: '', key: 'sentinel', payload: '{"value":1}', ts: ts + 1, from: 'remote' });
  await vi.waitFor(() => expect(h.get('sentinel')).toBe(1)); expect(h.get('k')).toBeNull();
});

it('F11 sliding write errors identify get operation', () => {
  const store = new Memory(), onError = vi.fn(); store.set('k', JSON.stringify({ value: 1, createdAt: Date.now(), ttl: 10000, expireAt: Date.now() + 1000 }));
  vi.spyOn(store, 'set').mockImplementation(() => { throw new Error('write'); });
  const h = proxy(store, new Memory(), { sliding: true, onError }); expect(h.get('k')).toBe(1); expect(onError.mock.calls[0][0].op).toBe('get'); h.destroy();
});

it('F13 memo broadcast opens once until destroy', () => {
  const construct = vi.fn(), close = vi.fn(), channels: { onmessage?: (event: { data: unknown }) => void }[] = [], receive = vi.fn();
  vi.stubGlobal('BroadcastChannel', class { onmessage?: (event: { data: unknown }) => void; constructor() { construct(); channels.push(this); } postMessage() {} close = close; });
  const hub = memoHub({}, receive, 'x1'); expect(construct).not.toHaveBeenCalled(); hub.publish('a'); hub.publish('b'); hub.connect();
  channels[0].onmessage!({ data: 'remote' }); expect(receive).toHaveBeenCalledWith('remote'); expect(construct).toHaveBeenCalledTimes(1); hub.destroy(); expect(close).toHaveBeenCalledTimes(1);
});

it('F13 destroy closes a channel opened by a pending async write', async () => {
  const close = vi.fn(); vi.stubGlobal('BroadcastChannel', class { postMessage() {} close = close; });
  const h = proxy(fifo(), new Memory(), { broadcast: true }); const write = h.set('k', 1); await h.destroy(); await write; expect(close).toHaveBeenCalledOnce();
});

it('clear fast path failures report once and preserve backend data', async () => {
  const store = fifo(), error = new Error('clear'), onError = vi.fn(), h = proxy(store, new Memory(), { onError });
  await h.set('k', 1); vi.spyOn(store, 'clear').mockRejectedValue(error); await h.clear(); expect(await h.get('k')).toBe(1);
  expect(onError).toHaveBeenCalledOnce(); expect(onError.mock.calls[0][0]).toMatchObject({ op: 'clear', kind: 'write' }); expect(onError.mock.calls[0][0].error).toBe(error); await h.destroy();
});

it('overlapping clear scans release versions and allow subsequent writes', async () => {
  const store = fifo(), h = proxy(store, new Memory(), { namespace: 'ns', memoized: true });
  await h.set('old', 1); await Promise.all([h.clear(), h.clear(), h.set('new', 2)]); expect(await h.keys()).toEqual(['new']);
  await h.clear(); expect(await h.keys()).toEqual([]); await h.set('new', 3); expect(await h.get('new')).toBe(3); await h.destroy();
});

it('F14 same-name Idb instances invalidate each other memo', async () => {
  const name = 'x1-shared-' + crypto.randomUUID(), a = idb(name), b = new Idb(name); cleanups.push(() => b.destroy());
  expect(a.area).toBe(b.area); expect(a.area).not.toBe(idb().area);
  const h = proxy(a, new Memory(), { memoized: true }), other = proxy(b, new Memory());
  await h.set('k', 1); expect(await h.get('k')).toBe(1); await other.set('k', 2); expect(await h.get('k')).toBe(2); await h.destroy(); await other.destroy();
});

it('F15 untransformed key and length bypass enumeration', () => {
  const store = new Memory(), keys = vi.spyOn(store, 'keys'), key = vi.spyOn(store, 'key'), h = proxy(store, new Memory());
  h.set('k', 1); expect(h.length).toBe(1); expect(h.key(0)).toBe('k'); expect(keys).not.toHaveBeenCalled(); expect(key).toHaveBeenCalledTimes(1); h.destroy();
});

it.each(['', 'ns'])('clear preserves writes started during scanning namespace=%s', async namespace => {
  const store = fifo(), clear = vi.spyOn(store, 'clear'), remove = vi.spyOn(store, 'remove'), keys = vi.spyOn(store, 'keys');
  const h = proxy(store, new Memory(), { namespace, memoized: true }); await h.set('old', 1);
  const before = h.set('cancelled', 1), clearing = h.clear(), after = h.set('new', 2);
  await Promise.all([before, clearing, after]); expect(await h.keys()).toEqual(['new']); expect(await h.get('new')).toBe(2);
  if (!namespace) { expect(clear).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled(); expect(keys).toHaveBeenCalledTimes(1); }
  else { expect(clear).not.toHaveBeenCalled(); expect(remove).toHaveBeenCalledTimes(2); }
  await h.destroy();
});

it('F15 real IDB key and count bypass full key enumeration', async () => {
  const store = idb(), keys = vi.spyOn(store, 'keys'), key = vi.spyOn(store, 'key'), count = vi.spyOn(store, 'length'), clear = vi.spyOn(store, 'clear');
  const h = proxy(store, new Memory()); await h.set('k', 1); expect(await h.length).toBe(1); expect(await h.key(0)).toBe('k');
  expect(keys).not.toHaveBeenCalled(); expect(key).toHaveBeenCalledOnce(); expect(count).toHaveBeenCalledOnce(); await h.clear(); expect(clear).toHaveBeenCalledOnce(); await h.destroy();
});

/** 对照 f853575 的 buildEntity 和 b999ce2 的 mkEntity 保存的历史信封形态。 */
const historical = [
  ['0.0.x omitted ttl', {}, false],
  ['0.0.x finite ttl', { ttl: 10000, expireAt: 20000 }, false],
  ['0.0.x zero ttl', { ttl: 0, expireAt: 10000 }, true],
  ['0.0.x negative ttl', { ttl: -1, expireAt: 9999 }, true],
  ['0.0.x Infinity ttl', { ttl: Infinity, expireAt: Infinity }, false],
  ['0.0.x NaN ttl', { ttl: NaN, expireAt: NaN }, false],
  ['0.0.x negative Infinity ttl', { ttl: -Infinity, expireAt: -Infinity }, false],
  ['0.0.x nonfinite ttl plus finite absolute expiry', { ttl: Infinity, expireAt: 20000 }, false],
  ['0.0.x absolute Infinity', { expireAt: Infinity }, false],
  ['absolute expiry only', { expireAt: 20000 }, false],
  ['absolute expiry overrides ttl', { ttl: 1000, expireAt: 20000 }, false],
  ['sliding past absolute expiry', { ttl: 1000, expireAt: 11000 }, false],
  ['sliding past expiry without ttl', { expireAt: 9999 }, true],
  ['renewed envelope', { ttl: 1000, expireAt: 12000 }, false],
] as const;
it.each(historical)('F3 historical compatibility %s', (_name, metadata, expired) => {
  vi.spyOn(Date, 'now').mockReturnValue(10000);
  const text = JSON.stringify({ value: 1, createdAt: 10000, ...metadata }), store = new Memory(), onError = vi.fn(); store.set('k', text);
  const h = proxy(store, new Memory(), { onError }); expect(h.get('k', 0)).toBe(expired ? 0 : 1);
  expect(store.get('k')).toBe(expired ? null : text); expect(onError).not.toHaveBeenCalled(); h.destroy();
});

it('F3 HEAD mkEntity outputs remain readable and nonfinite decoded metadata stays corrupt', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}), now = Date.now();
  for (const ttl of [undefined, 0, -1, Infinity, NaN, 10000]) for (const expiry of [undefined, now + 20000, new Date(now + 20000), new Date(now + 20000).toISOString()]) {
    const entity = mkEntity(1, ttl, expiry, false, 'k', now)!; expect(parseEntity(JSON.stringify(entity))).toEqual(entity);
  }
  for (const field of ['createdAt', 'ttl', 'expireAt']) for (const number of [NaN, Infinity, -Infinity]) expect(() => parseEntity('ignored', () => ({ value: 1, [field]: number }))).toThrow(TypeError);
  expect(warn).toHaveBeenCalled();
});

it.each([false, true])('S2 codec value encode preserves exception identity async=%s', async asynchronous => {
  const store = asynchronous ? fifo() : new Memory(), error = new Error('encode'), onError = vi.fn(), opts = { codeable: true, codec: { encode: () => { throw error; }, decode: (s: string) => s } };
  const h = proxy(store, new Memory(), opts);
  if (asynchronous) { let result: unknown; expect(() => { result = h.set('k', 1); }).not.toThrow(); await expect(result).rejects.toBe(error); }
  else { let thrown: unknown; try { void h.set('k', 1); } catch (caught) { thrown = caught; } expect(thrown).toBe(error); }
  const reporting = proxy(store, new Memory(), { ...opts, onError }); await reporting.set('k', 1);
  expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'serialize', op: 'set', key: 'k' }); expect(onError.mock.calls[0][0].error).toBe(error); expect(await store.get('k')).toBeNull(); await h.destroy(); await reporting.destroy();
});

