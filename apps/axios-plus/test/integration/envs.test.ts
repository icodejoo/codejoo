// Integration coverage for the envs plugin.
//   - install 时按 default 选 env name → 在 rules 中查命中规则 → 浅合并 config 到 axios.defaults
//   - 没有 response 拦截器，纯 install-time 行为

import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { create, envsPlugin } from '../../src';
import { startServer, type ServerHandle } from '../../server';

describe('envs plugin — integration', () => {
    let server: ServerHandle;
    let baseURL: string;
    beforeAll(async () => {
        server = await startServer();
        baseURL = `http://localhost:${server.port}`;
    });
    afterAll(async () => { await server?.close?.(); });

    it('字面量 default ⇒ 直接当 env 名查 rules，浅合并配置', async () => {
        const ax = axios.create();
        const api = create(ax);
        api.use([
            envsPlugin({
                enable: true,
                default: 'prod',
                rules: [
                    { rule: 'dev', config: { baseURL: 'http://wrong-dev' } },
                    { rule: 'prod', config: { baseURL, timeout: 12_345 } },
                ],
            }),
        ]);
        expect(ax.defaults.baseURL).toBe(baseURL);
        expect(ax.defaults.timeout).toBe(12_345);
        // 真发一个 HTTP 验证 baseURL 真正生效
        const r = await ax.get('/ok');
        expect(r.status).toBe(200);
        expect(r.data.code).toBe('0000');
    });

    it('函数 default ⇒ install 时调用一次取 env name', async () => {
        const ax = axios.create();
        const api = create(ax);
        let calls = 0;
        api.use([
            envsPlugin({
                enable: true,
                default: () => { calls++; return 'staging'; },
                rules: [
                    { rule: 'staging', config: { baseURL } },
                ],
            }),
        ]);
        expect(calls).toBe(1);
        expect(ax.defaults.baseURL).toBe(baseURL);
    });

    it('未命中任何 rule ⇒ no-op，不动 axios.defaults', async () => {
        const ax = axios.create({ baseURL });
        const before = ax.defaults.baseURL;
        const api = create(ax);
        api.use([
            envsPlugin({
                enable: true,
                default: 'unknown',
                rules: [
                    { rule: 'dev', config: { baseURL: 'http://wrong' } },
                ],
            }),
        ]);
        expect(ax.defaults.baseURL).toBe(before);
        const r = await ax.get('/ok');
        expect(r.status).toBe(200);
    });
});
