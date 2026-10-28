import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import share, {
    $resolvePolicy,
    type ISharedOptions,
    $rebindError,
    $rebindResponse,
} from '../../../src/plugins/share';
import { AxiosError } from 'axios';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** 构造成功响应。 */
function response(config: any = {}) {
    return { data: 'ok', config, headers: {}, status: 200, statusText: '' };
}

// ───────────────────────────────────────────────────────────────────────────
//  $resolvePolicy
// ───────────────────────────────────────────────────────────────────────────

describe('$resolvePolicy', () => {
    const defaults: ISharedOptions = { policy: 'start' };

    it('[share.prop.name] 工厂返回稳定的插件名称', () => {
        expect(share().name).toBe('axp:share');
        expect(share({ enable: false }).name).toBe('axp:share');
    });

    it('[share.fn.$resolvePolicy][share.opt.policy] 未指定 → 插件默认', () => {
        expect($resolvePolicy({} as AxiosRequestConfig, defaults)).toBe('start');
    });

    it('[share.fn.$resolvePolicy][share.req.share] config.share === false → none', () => {
        expect($resolvePolicy({ share: false } as any, defaults)).toBe('none');
    });

    it('[share.fn.$resolvePolicy][share.req.share] config.share === true → 插件默认', () => {
        expect($resolvePolicy({ share: true } as any, defaults)).toBe('start');
        expect($resolvePolicy({ share: true } as any, { policy: 'end' })).toBe('end');
    });

    it('[share.fn.$resolvePolicy][share.req.share.policy] config.share 是字符串 policy → 直接使用', () => {
        expect($resolvePolicy({ share: 'end' } as any, defaults)).toBe('end');
        expect($resolvePolicy({ share: 'race' } as any, defaults)).toBe('race');
        expect($resolvePolicy({ share: 'none' } as any, defaults)).toBe('none');
    });

    it('[share.fn.$resolvePolicy][share.req.share.policy] config.share 字符串非法 → 回退到默认', () => {
        expect($resolvePolicy({ share: 'wat' } as any, defaults)).toBe('start');
    });

    it('[share.fn.$resolvePolicy][share.req.share.policy] config.share 是对象 → 取 policy', () => {
        expect($resolvePolicy({ share: { policy: 'end' } } as any, defaults)).toBe('end');
    });

    it('[share.fn.$resolvePolicy][share.req.share.callback] config.share 是函数 → 调用并解析', () => {
        const dyn = vi.fn(() => 'race' as const);
        expect($resolvePolicy({ share: dyn } as any, defaults)).toBe('race');
        expect(dyn).toHaveBeenCalledOnce();
    });

    it('[share.fn.$resolvePolicy][share.opt.policy] 插件无 default policy + 未指定 → start（兜底）', () => {
        expect($resolvePolicy({} as any, {})).toBe('start');
    });
});

describe('share — 订阅清理与错误属性', () => {
    it('[share.fn.$rebindResponse][share.fn.$rebindError] 相同 config 的响应和错误保持身份，不同 config 保留不可枚举属性与原型', () => {
        const config = {};
        const resp = response(config);
        expect($rebindResponse(resp, config)).toBe(resp);
        const error = new AxiosError('boom', 'E', config as any, undefined, resp as any);
        Object.defineProperty(error, 'detail', { value: 42, enumerable: false });
        expect($rebindError(error, config)).toBe(error);
        const other = {};
        const copy = $rebindError(error, other) as any;
        expect(copy).toBeInstanceOf(AxiosError);
        expect(copy.detail).toBe(42);
        expect(Object.getOwnPropertyDescriptor(copy, 'detail')?.enumerable).toBe(false);
        expect(copy.config).toBe(other);
        expect(error.config).toBe(config);
    });
});
