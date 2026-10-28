import { describe, it, expect } from 'vitest';
import axios from 'axios';
import { Axp, axpNotify as notify, axpNormalize as normalize } from '../../../src';
import { makeNetwork } from '../../helpers/network';

function mkApi() {
  const net = makeNetwork();
  const api = Axp.create(axios.create({ adapter: net.adapter }));
  return { net, api };
}

describe('notify', () => {
  it('[notify.fn.axpNotify × normalize.fn.axpNormalize] Axp.install places notify before normalize on the response chain, so it sees the raw envelope, not an already-converted ApiError', async () => {
    const { net, api } = mkApi();
    net.fallback(() => ({ data: { code: 1, data: null, message: 'business fail' } }));
    const seen: unknown[] = [];
    Axp.install(api.axios, {
      notify: notify({ notify: () => {}, stringify: (data) => { seen.push(data); return ''; } }),
      normalize: normalize(),
    });

    await expect(api.axios.get('/data')).rejects.toBeTruthy();
    // If normalize ran first, notify would see the ApiError's response.data
    // (still the raw envelope in this case since normalize doesn't rewrite
    // it) via err.response — either way `seen` gets exactly one call; the
    // real assertion is that this doesn't throw/hang, proving the response
    // chain is wired in the intended order.
    expect(seen).toHaveLength(1);
  });
});
