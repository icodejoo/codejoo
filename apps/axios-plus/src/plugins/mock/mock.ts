
import type { Plugin } from '../../plugin/types';
import { __DEV__ , lockName} from '../../helper';
import type { AxiosRequestConfig } from 'axios';
import type { IMockOptions } from './types';


export const name = 'mock'

/**
 * Mock 插件：把命中规则的请求路径前缀重写到 `mockUrl`。
 *
 *   - **触发判定**：`config.mock` 为真，或插件级 `mock: true` 兜底
 *   - **URL 改写**：
 *       - 请求 url 是绝对地址 → 去掉 origin、用 mockUrl 重新拼接
 *       - 请求 url 是相对路径 → 简单拼接 `mockUrl + url`
 *       - 请求未填 url → 改 `baseURL = mockUrl`
 *   - **建议在 dev 启用**：`enable: import.meta.env.DEV`（生产环境永远不会触发）
 *
 * @example
 *   useAxiosPlugin(ax).use(mock({
 *     enable: import.meta.env.DEV,
 *     mockUrl: 'http://localhost:4523',
 *     mock: false,  // 全局默认不 mock，按请求 opt-in
 *   }));
 *
 *   ax.get('/api/x', { mock: true });                     // 走 mockUrl
 *   ax.get('/api/y', { mock: { mockUrl: 'http://m2' } }); // 走特定 mockUrl
 */
export default function mock({ enable = false, mock: mockGlobal = false, mockUrl }: IMockOptions = {}): Plugin {
    const defaults: IMockOptions = { mock: mockGlobal, mockUrl };
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${enable} mockUrl:${mockUrl ?? '<none>'}`);
            if (!enable) return;
            ctx.request(
                function $mock(config) {
                    const opt = $resolveMock(config, defaults);
                    delete config.mock;
                    if (!opt) return config;
                    const target = opt.mockUrl;
                    if (!target) {
                        if (__DEV__) ctx.logger.warn(`${name} skipped: no mockUrl`);
                        return config;
                    }
                    $rewriteUrl(config, target);
                    return config;
                },
                null,
                {
                    runWhen: (config) => $shouldMock(config, defaults),
                },
            );
        },
    };
}


/** 仅判断"是否启用 mock"（runWhen 用） @internal */
export function $shouldMock(config: AxiosRequestConfig, defaults: IMockOptions): boolean {
    const v = config.mock;
    if (v === false) return false;
    if (v === true) return true;
    if (typeof v === 'object' && v !== null) {
        if (v.mock === false) return false;
        return v.mock === true || !!v.mockUrl;
    }
    return !!defaults.mock;
}


/** 解析 mock 配置；返回 null 表示本请求不 mock @internal */
export function $resolveMock(config: AxiosRequestConfig, defaults: IMockOptions): { mockUrl?: string } | null {
    const v = config.mock;
    if (v === false) return null;
    if (v === true) return { mockUrl: defaults.mockUrl };
    if (typeof v === 'object' && v !== null) {
        if (v.mock === false) return null;
        return { mockUrl: v.mockUrl ?? defaults.mockUrl };
    }
    return defaults.mock ? { mockUrl: defaults.mockUrl } : null;
}


/** 将 config.url / config.baseURL 重写到 mockUrl @internal */
export function $rewriteUrl(config: AxiosRequestConfig, mockUrl: string): void {
    const url = config.url;
    if (!url) {
        config.baseURL = mockUrl;
        return;
    }
    if (isAbsoluteURL(url)) {
        // 完整 URL：去掉原 origin，把 path/search 拼到 mockUrl 后
        try {
            const u = new URL(url);
            config.url = combineURLs(mockUrl, u.pathname + u.search + u.hash);
        } catch {
            // 解析失败时退化为简单拼接
            config.url = combineURLs(mockUrl, url);
        }
    } else {
        config.url = combineURLs(mockUrl, url);
    }
}


/** 简化版：是否绝对 URL */
function isAbsoluteURL(url: string): boolean {
    return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
}

/** 简化版：处理结尾 / 与开头 / 的拼接 */
function combineURLs(base: string, rel: string): string {
    return rel ? `${base.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}` : base;
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(mock)` 在 minify 后仍能识别
lockName(mock, name);
