import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpKey as key, axpCache as cache } from '../../../src';
import { makeNetwork } from '../../helpers/network';
import { use } from '../../helpers/install';

/** 装好网络仿真的 Core 工厂 */
function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('key', () => {
  it('[key.fn.axpKey × cache.req.cache] without config.key:true, key never writes a key, so cache installed after it never caches', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('GET', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    use(api, [key(), cache()]);

    await api.axios.get('/data', { cache: true } as any);
    await api.axios.get('/data', { cache: true } as any);
    expect(calls).toBe(2);
  });

  it('[key.opt.fastMode × cache.req.cache] deep mode folds params and a plain-object body into the key, order-independently, so two requests differing only in body get different cache entries', async () => {
    // `key: true` alone defaults to FAST mode (method+url only) unless the
    // plugin is configured with fastMode:false — see key.ts's `$parse`
    // (`build === true` branch: `defaults?.fastMode ?? true`).
    const { net, api } = mkApi();
    let calls = 0;
    net.on('POST', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    use(api, [key({ fastMode: false }), cache()]);

    await api.axios.post('/data', { x: 1 }, { params: { b: 2, a: 1 }, key: true, cache: true } as any);
    await api.axios.post('/data', { x: 1 }, { params: { a: 1, b: 2 }, key: true, cache: true } as any);
    expect(calls).toBe(1);

    await api.axios.post('/data', { x: 2 }, { params: { a: 1, b: 2 }, key: true, cache: true } as any);
    expect(calls).toBe(2);
  });

  it('[key.opt.fastMode × cache.req.cache] a string body is folded into the key as-is', async () => {
    const { net, api } = mkApi();
    let calls = 0;
    net.on('POST', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    use(api, [key({ fastMode: false }), cache()]);

    await api.axios.post('/data', 'raw-body', { key: true, cache: true } as any);
    await api.axios.post('/data', 'raw-body', { key: true, cache: true } as any);
    expect(calls).toBe(1);

    await api.axios.post('/data', 'different-body', { key: true, cache: true } as any);
    expect(calls).toBe(2);
  });

  it('[key.fn.$parse × cache.req.cache] a class instance with no own enumerable properties cannot be fingerprinted: no key is generated and nothing is cached (review #16: a miss beats a false hit; Date/Map/Blob take the same path)', async () => {
    class Unencodable { toString() { return 'unencodable'; } }
    const { net, api } = mkApi();
    let calls = 0;
    net.on('GET', '/data', () => { calls++; return { data: { code: 0, data: null } }; });
    use(api, [key({ fastMode: false }), cache()]);

    await api.axios.get('/data', { params: { x: new Unencodable() }, key: true, cache: true } as any);
    await api.axios.get('/data', { params: { x: new Unencodable() }, key: true, cache: true } as any);
    expect(calls).toBe(2);
  });
});
