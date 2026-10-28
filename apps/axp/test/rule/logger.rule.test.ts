import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import logger from '../../src/plugins/logger';
import { CONSOLE_LOGGER, pluginWarn } from '../../src/helper';

afterEach(() => { vi.restoreAllMocks(); });

describe('logger — 日志级别、默认值与卸载', () => {
    it('[logger.fn.axpLogger][logger.opt.debug][logger.opt.logger][logger.method.cleanup] 空配置使用 debug:false 与默认 sink，cleanup 恢复之前的引用', () => {
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
