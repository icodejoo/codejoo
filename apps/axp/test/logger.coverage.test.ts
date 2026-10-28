import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import logger from '../src/plugins/logger';
import { CONSOLE_LOGGER, pluginLog, pluginWarn, pluginError } from '../src/helper';

afterEach(() => { vi.restoreAllMocks(); });

describe('logger — 日志级别、默认值与卸载', () => {
    it.each([
        { call: pluginLog, method: 'log' as const },
        { call: pluginWarn, method: 'warn' as const },
        { call: pluginError, method: 'error' as const },
    ])('$method 关闭时静默，开启时转发全部参数并可回退默认 sink', ({ call, method }) => {
        const sink = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const fallback = vi.spyOn(CONSOLE_LOGGER, method).mockImplementation(() => {});
        call(undefined, 'hidden');
        call({ debug: false, logger: sink }, 'hidden');
        expect(sink[method]).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
        const data = { n: 1 };
        call({ debug: true, logger: sink }, 'message', data);
        expect(sink[method]).toHaveBeenCalledWith('message', data);
        call({ debug: true }, 'fallback');
        expect(fallback).toHaveBeenCalledWith('fallback');
    });
    it('空配置使用 debug:false 与默认 sink，cleanup 恢复之前的引用', () => {
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
    it('请求可覆盖 defaults 的 debug 和 sink', async () => {
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
