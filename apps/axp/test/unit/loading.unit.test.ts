import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import loading, {
    $resolveLoading,
    $resolveDelay,
    $resolveDelayClose,
    type ILoadingOptions,
    type TLoadingFunc,
} from '../../src/plugins/loading';

// ───────────────────────────────────────────────────────────────────────────
//  $resolveLoading：请求级 → 插件级 兜底
// ───────────────────────────────────────────────────────────────────────────

describe('$resolveLoading', () => {
    const fallback: TLoadingFunc = () => { };
    const defaults: ILoadingOptions = { loading: fallback };

    it('[loading.fn.$resolveLoading][loading.req.loading] config.loading === false → null（跳过）', () => {
        expect($resolveLoading({ loading: false } as any, defaults)).toBe(null);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading] config.loading === true → 走插件级回退', () => {
        expect($resolveLoading({ loading: true } as any, defaults)).toBe(fallback);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading] config.loading 未指定 → 走插件级回退', () => {
        expect($resolveLoading({} as AxiosRequestConfig, defaults)).toBe(fallback);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading.callback] config.loading 是函数 → 直接作为回调（请求级覆盖）', () => {
        const custom: TLoadingFunc = () => { };
        expect($resolveLoading({ loading: custom } as any, defaults)).toBe(custom);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading] 插件级也没回调 + config 显式 true → null', () => {
        expect($resolveLoading({ loading: true } as any, {})).toBe(null);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading] 插件级也没回调 + config 未指定 → null', () => {
        expect($resolveLoading({} as AxiosRequestConfig, {})).toBe(null);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading.enable] config.loading 是对象且 enable:false → null（跳过，等价于顶层 false）', () => {
        expect($resolveLoading({ loading: { enable: false } } as any, defaults)).toBe(null);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading.loading] config.loading 是对象且给了 loading 字段 → 用它', () => {
        const custom: TLoadingFunc = () => { };
        expect($resolveLoading({ loading: { loading: custom } } as any, defaults)).toBe(custom);
    });

    it('[loading.fn.$resolveLoading][loading.req.loading] config.loading 是对象但没给 loading 字段 → 走插件级回退', () => {
        expect($resolveLoading({ loading: { delay: 100 } } as any, defaults)).toBe(fallback);
    });
});

// ───────────────────────────────────────────────────────────────────────────
//  $resolveDelay / $resolveDelayClose：请求级对象 → 插件级 → 0 兜底
// ───────────────────────────────────────────────────────────────────────────

describe('$resolveDelay / $resolveDelayClose', () => {
    it('[loading.fn.$resolveDelay][loading.fn.$resolveDelayClose][loading.opt.delay][loading.opt.delayClose] 都未指定 → 默认 0', () => {
        expect($resolveDelay({} as AxiosRequestConfig, {})).toBe(0);
        expect($resolveDelayClose({} as AxiosRequestConfig, {})).toBe(0);
    });

    it('[loading.fn.$resolveDelay][loading.fn.$resolveDelayClose][loading.opt.delay][loading.opt.delayClose] 插件级设置 → 用插件级', () => {
        expect($resolveDelay({} as AxiosRequestConfig, { delay: 200 })).toBe(200);
        expect($resolveDelayClose({} as AxiosRequestConfig, { delayClose: 300 })).toBe(300);
    });

    it('[loading.fn.$resolveDelay][loading.fn.$resolveDelayClose][loading.req.loading.delay][loading.req.loading.delayClose] 请求级对象覆盖插件级', () => {
        expect($resolveDelay({ loading: { delay: 50 } } as any, { delay: 200 })).toBe(50);
        expect($resolveDelayClose({ loading: { delayClose: 50 } } as any, { delayClose: 300 })).toBe(50);
    });

    it('[loading.fn.$resolveDelay][loading.fn.$resolveDelayClose] 请求级是函数（非对象）→ 走插件级', () => {
        const fn: TLoadingFunc = () => { };
        expect($resolveDelay({ loading: fn } as any, { delay: 200 })).toBe(200);
    });
});
