import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import logger from '../../../src/plugins/logger';
import { CONSOLE_LOGGER, pluginLog, pluginWarn, pluginError } from '../../../src/helper';

afterEach(() => { vi.restoreAllMocks(); });

describe('logger — 日志级别、默认值与卸载', () => {
    it('[logger.prop.name] 工厂返回固定插件名称', () => {
        expect(logger().name).toBe('axp:logger');
    });

    it.each([
        { call: pluginLog, method: 'log' as const, ids: '[logger.cb.logger.log][logger.req.logger.log]' },
        { call: pluginWarn, method: 'warn' as const, ids: '[logger.cb.logger.warn][logger.req.logger.warn]' },
        { call: pluginError, method: 'error' as const, ids: '[logger.cb.logger.error][logger.req.logger.error]' },
    ])('$ids $method 经 defaults 继承并支持请求级替换', async ({ call, method }) => {
        const globalSink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const requestSink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const payload = { n: 1 };
        const ax = axios.create({ adapter: async (config) => {
            call(config, '消息', payload);
            return { config, status: 200, statusText: '', headers: {}, data: null };
        } });
        logger({ debug: true, logger: globalSink }).install(ax);
        await ax.get('/global');
        await ax.get('/request', { logger: requestSink });
        expect(globalSink[method]).toHaveBeenCalledExactlyOnceWith('消息', payload);
        expect(requestSink[method]).toHaveBeenCalledExactlyOnceWith('消息', payload);
    });
    it('[logger.method.install][logger.fn.axpLogger][logger.opt.debug][logger.opt.logger][logger.method.cleanup] 空配置使用 debug:false 与默认 sink，cleanup 恢复之前的引用', () => {
        const ax = axios.create();
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        ax.defaults.debug = true;
        ax.defaults.logger = sink;
        const off = logger().install(ax);
        expect(ax.defaults.debug).toBe(false);
        expect(ax.defaults.logger).toBe(CONSOLE_LOGGER);
        off?.();
        expect(ax.defaults.debug).toBe(true);
        expect(ax.defaults.logger).toBe(sink);
    });
    it('[logger.req.debug][logger.req.logger] 请求可覆盖 defaults 的 debug 和 sink', async () => {
        const globalSink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const requestSink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const ax = axios.create({ adapter: async (config) => {
            pluginWarn(config, 'request');
            return { status: 200, statusText: '', data: null, headers: {}, config };
        } });
        logger({ debug: true, logger: globalSink }).install(ax);
        await ax.get('/', { debug: false });
        await ax.get('/', { logger: requestSink });
        expect(globalSink.warn).not.toHaveBeenCalled();
        expect(requestSink.warn).toHaveBeenCalledWith('request');
    });
});
