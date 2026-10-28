import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpNotify as notify, axpRetry as retry } from '../../src';
import { makeNetwork } from '../helpers/network';

function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('notify', () => {
  it(`[notify.fn.axpNotify × retry.opt.max] a retry-recovered response fires notify exactly ONCE (retry.ts resends through a bare, interceptor-less axios instance that never re-enters this chain — unlike auth.ts, which still double-fires; see notify.ts's doc comment)`, async () => {
    const { net, api } = mkApi();
    let attempts = 0;
    net.fallback(() => {
      attempts++;
      return attempts < 2 ? { status: 500, data: { code: 1, data: null } } : { data: { code: 0, data: { v: 1 } } };
    });
    const messages: string[] = [];
    Axp.install(api.axios, {
      retry: retry({ max: 2, delay: 0 }),
      notify: notify<any>({ notify: (m) => messages.push(m), stringify: (_data, _m, status) => `status=${status}` }),
    });

    const r = await api.axios.get('/data');
    expect((r.data as any).data.v).toBe(1);
    expect(messages).toEqual(['status=200']);
  });
});
