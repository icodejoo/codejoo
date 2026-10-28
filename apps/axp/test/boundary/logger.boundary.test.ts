import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import logger from '../../src/plugins/logger';
import { CONSOLE_LOGGER, pluginLog, pluginWarn, pluginError } from '../../src/helper';

afterEach(() => { vi.restoreAllMocks(); });

describe('logger — 空值、异常与重复安装', () => {
    it('[logger.fn.axpLogger][logger.method.install][logger.method.cleanup] 重复安装按逆序清理，重复 cleanup 恢复最初未配置状态', () => {
        const ax = axios.create();
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const first = logger({ debug: true, logger: sink }).install(ax);
        const second = logger().install(ax);
        expect(ax.defaults.debug).toBe(false);
        expect(ax.defaults.logger).toBe(CONSOLE_LOGGER);
        second?.();
        expect(ax.defaults.debug).toBe(true);
        expect(ax.defaults.logger).toBe(sink);
        first?.(); first?.();
        expect(ax.defaults.debug).toBeUndefined();
        expect(ax.defaults.logger).toBeUndefined();
    });

    it.each([
        { call: pluginLog, method: 'log' as const, ids: '[logger.cb.logger.log][logger.req.logger.log]' },
        { call: pluginWarn, method: 'warn' as const, ids: '[logger.cb.logger.warn][logger.req.logger.warn]' },
        { call: pluginError, method: 'error' as const, ids: '[logger.cb.logger.error][logger.req.logger.error]' },
    ])('$ids $method 回调抛错保留身份，关闭调试后不执行异常回调', async ({ call, method }) => {
        const error = new Error('日志失败');
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        sink[method].mockImplementation(() => { throw error; });
        const ax = axios.create({ adapter: async (config) => {
            call(config);
            return { config, status: 200, statusText: '', headers: {}, data: 'ok' };
        } });
        logger({ debug: true, logger: sink }).install(ax);
        await expect(ax.get('/global')).rejects.toBe(error);
        await expect(ax.get('/request', { logger: sink })).rejects.toBe(error);
        expect((await ax.get('/disabled', { debug: false })).data).toBe('ok');
        expect(sink[method]).toHaveBeenCalledTimes(2);
    });

    it('[logger.opt.debug][logger.req.debug][logger.opt.logger][logger.req.logger] null sink 回退默认，null debug 静默', async () => {
        const fallback = vi.spyOn(CONSOLE_LOGGER, 'log').mockImplementation(() => {});
        const ax = axios.create({ adapter: async (config) => {
            pluginLog(config, config.url);
            return { config, status: 200, statusText: '', headers: {}, data: null };
        } });
        const off = logger({ debug: true, logger: null as any }).install(ax);
        await ax.get('/global-null');
        await ax.get('/request-null', { logger: null as any });
        await ax.get('/silent', { debug: null as any });
        expect(fallback.mock.calls).toEqual([['/global-null'], ['/request-null']]);
        off?.();
    });
});
