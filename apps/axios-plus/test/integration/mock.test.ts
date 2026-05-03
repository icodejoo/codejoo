// Integration coverage for the mock plugin.
//   - mock 把命中请求的 url 重写到 mockUrl
//   - 启动两个 Bun mock server：一个当"真实后端"，一个当"mock 后端"
//   - 验证 mock:true 时请求被路由到 mock 后端，真实后端 counter 不增

import axios from 'axios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { create, mockPlugin } from '../../src';
import { startServer, type ServerHandle } from '../../server';

describe('mock plugin — integration', () => {
    let real: ServerHandle;
    let mockSrv: ServerHandle;
    let realURL: string;
    let mockURL: string;

    beforeAll(async () => {
        [real, mockSrv] = await Promise.all([startServer(), startServer()]);
        realURL = `http://localhost:${real.port}`;
        mockURL = `http://localhost:${mockSrv.port}`;
    });
    afterAll(async () => {
        await Promise.all([real?.close?.(), mockSrv?.close?.()]);
    });

    it('mock:true ⇒ url 被重写到 mockUrl，hits mockSrv 不 hits real', async () => {
        const ax = axios.create({ baseURL: realURL });
        const api = create(ax);
        api.use([mockPlugin({ enable: true, mockUrl: mockURL })]);

        const key = 'mock-redirect-' + Date.now();
        const r = await ax.get('/seq', {
            mock: true,
            headers: { 'X-Test-Key': key },
        } as any);
        expect(r.status).toBe(200);

        // 真实后端 counter 不应增加；mock 后端的应该 +1
        const realCount = await axios.get(`${realURL}/counter/seq`, { headers: { 'X-Test-Key': key } });
        const mockCount = await axios.get(`${mockURL}/counter/seq`, { headers: { 'X-Test-Key': key } });
        expect(realCount.data.data.count).toBe(0);
        expect(mockCount.data.data.count).toBe(1);
    });

    it('mock:false ⇒ 不重写，hits real backend', async () => {
        const ax = axios.create({ baseURL: realURL });
        const api = create(ax);
        api.use([mockPlugin({ enable: true, mock: true, mockUrl: mockURL })]);

        const key = 'mock-bypass-' + Date.now();
        await ax.get('/seq', { mock: false, headers: { 'X-Test-Key': key } } as any);

        const realCount = await axios.get(`${realURL}/counter/seq`, { headers: { 'X-Test-Key': key } });
        const mockCount = await axios.get(`${mockURL}/counter/seq`, { headers: { 'X-Test-Key': key } });
        expect(realCount.data.data.count).toBe(1);
        expect(mockCount.data.data.count).toBe(0);
    });

    it('请求级 mockUrl 覆盖插件级', async () => {
        const ax = axios.create({ baseURL: realURL });
        const api = create(ax);
        // 插件级故意配错的 url
        api.use([mockPlugin({ enable: true, mockUrl: 'http://localhost:1' })]);

        const key = 'mock-override-' + Date.now();
        await ax.get('/seq', {
            mock: { mockUrl: mockURL },
            headers: { 'X-Test-Key': key },
        } as any);

        const mockCount = await axios.get(`${mockURL}/counter/seq`, { headers: { 'X-Test-Key': key } });
        expect(mockCount.data.data.count).toBe(1);
    });

    // 注：config.mock 的 delete 是单测覆盖范围（拦截器内部行为，axios.request 内部 clone
    // 配置后才传给拦截器，原 config 引用不会被改）。集成层不再断言该实现细节。
});
