import axios from 'axios';
import { describe, expect, it } from 'vitest';
import { create } from '../../core';
import ApiResponse, { ERR_CODES } from '../../objects/ApiResponse';
import normalize, {
    $applyEnvelope,
    $extractBiz,
    $get,
    $mergeRequest,
    $resolveConfig,
} from './normalize';
import type { IResolvedRuntime } from './normalize';


// 通用：默认 success 函数（业务码命中 '0000' 视为成功）
const defaultSuccess = (apiResp: ApiResponse): boolean =>
    apiResp.code === '0000';


// ───────────────────────────────────────────────────────────────────────────
//  $get
// ───────────────────────────────────────────────────────────────────────────

describe('normalize — $get', () => {
    it('two-level access', () => {
        expect($get({ data: { code: 'X' } }, 'data.code')).toBe('X');
    });
    it('array index', () => {
        expect($get({ data: ['a', 'b'] }, 'data.0')).toBe('a');
    });
    it('null obj / empty path → undefined', () => {
        expect($get(null, 'a.b')).toBeUndefined();
        expect($get({}, '')).toBeUndefined();
        expect($get({}, undefined)).toBeUndefined();
    });
    it('nullish midway → undefined', () => {
        expect($get({ a: null }, 'a.b')).toBeUndefined();
    });
    it('primitive midway → undefined (no String/Number prototype access)', () => {
        expect($get({ a: 'hello' }, 'a.length')).toBeUndefined();
        expect($get({ a: 42 }, 'a.toString')).toBeUndefined();
        expect($get({ a: true }, 'a.valueOf')).toBeUndefined();
    });
    it('terminal primitive value still returned', () => {
        expect($get({ a: 'hello' }, 'a')).toBe('hello');
        expect($get({ a: 0 }, 'a')).toBe(0);
        expect($get({ a: false }, 'a')).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $resolveConfig —— 默认值兜底；success 必传
// ───────────────────────────────────────────────────────────────────────────

describe('normalize — $resolveConfig', () => {
    it('throws when success is not a function', () => {
        // @ts-expect-error 故意不传
        expect(() => $resolveConfig({})).toThrow(TypeError);
        // @ts-expect-error 字符串不再被允许
        expect(() => $resolveConfig({ success: '0000' })).toThrow(TypeError);
        // @ts-expect-error 数组不再被允许
        expect(() => $resolveConfig({ success: ['0000'] })).toThrow(TypeError);
    });

    it('all defaults populated when only success provided', () => {
        const c = $resolveConfig({ success: defaultSuccess });
        expect(c.code).toBe('code');
        expect(c.message).toBe('message');
        expect(c.data).toBe('data');
        expect(c.success).toBe(defaultSuccess);
        expect(c.httpErrorCode).toBe(ERR_CODES.HTTP);
        expect(c.networkErrorCode).toBe(ERR_CODES.NETWORK);
        expect(c.timeoutErrorCode).toBe(ERR_CODES.TIMEOUT);
        expect(c.cancelCode).toBe(ERR_CODES.CANCEL);
    });

    it('honors all custom overrides', () => {
        const c = $resolveConfig({
            success: defaultSuccess,
            codeKeyPath: 'biz.code',
            messageKeyPath: 'biz.msg',
            dataKeyPath: 'payload',
            httpErrorCode: 'CUSTOM_HTTP',
            networkErrorCode: 'CUSTOM_NET',
            timeoutErrorCode: 'CUSTOM_T',
            cancelCode: 'CUSTOM_C',
        });
        expect(c.code).toBe('biz.code');
        expect(c.message).toBe('biz.msg');
        expect(c.data).toBe('payload');
        expect(c.httpErrorCode).toBe('CUSTOM_HTTP');
        expect(c.networkErrorCode).toBe('CUSTOM_NET');
        expect(c.timeoutErrorCode).toBe('CUSTOM_T');
        expect(c.cancelCode).toBe('CUSTOM_C');
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $mergeRequest —— 请求级合并 + 提取请求级 nullable / emptyable
// ───────────────────────────────────────────────────────────────────────────

describe('normalize — $mergeRequest', () => {
    const cfg = $resolveConfig({ success: defaultSuccess });

    it('config.normalize === false → null', () => {
        expect($mergeRequest(cfg, { normalize: false } as any)).toBeNull();
    });

    it('no override → reuse plugin cfg, reqHadSuccess=false', () => {
        const r = $mergeRequest(cfg, undefined)!;
        expect(r.cfg).toBe(cfg);
        expect(r.reqHadSuccess).toBe(false);
        expect(r.reqNullable).toBeUndefined();
        expect(r.reqEmptyable).toBeUndefined();
    });

    it('config.normalize.success → reqHadSuccess=true + cfg.success replaced', () => {
        const reqFn = (a: ApiResponse) => a.status >= 200;
        const r = $mergeRequest(cfg, { normalize: { success: reqFn } } as any)!;
        expect(r.reqHadSuccess).toBe(true);
        expect(r.cfg.success).toBe(reqFn);
        // 不影响其他字段
        expect(r.cfg.code).toBe(cfg.code);
    });

    it('top-level config.nullable / emptyable picked up; reqHadSuccess=false', () => {
        const r = $mergeRequest(cfg, { nullable: true, emptyable: false } as any)!;
        expect(r.reqHadSuccess).toBe(false);
        expect(r.reqNullable).toBe(true);
        expect(r.reqEmptyable).toBe(false);
    });

    it('nested normalize.nullable / emptyable also work', () => {
        const r = $mergeRequest(cfg, {
            normalize: { nullable: true, emptyable: true },
        } as any)!;
        expect(r.reqNullable).toBe(true);
        expect(r.reqEmptyable).toBe(true);
    });

    it('top-level overrides nested', () => {
        const r = $mergeRequest(cfg, {
            normalize: { nullable: false, emptyable: false },
            nullable: true,   // 顶层覆盖嵌套
        } as any)!;
        expect(r.reqNullable).toBe(true);   // 顶层
        expect(r.reqEmptyable).toBe(false);  // 嵌套（顶层未提供）
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $extractBiz
// ───────────────────────────────────────────────────────────────────────────

describe('normalize — $extractBiz', () => {
    const cfg = $resolveConfig({ success: defaultSuccess });

    it('正常 envelope', () => {
        const r = $extractBiz(
            { status: 200, config: {}, data: { code: '0000', message: 'ok', data: { x: 1 } } } as any,
            undefined,
            cfg,
        );
        expect(r).toEqual({ code: '0000', message: 'ok', data: { x: 1 } });
    });

    it('error 路径 + 4xx/5xx 没 envelope code → 用 httpErrorCode 占位', () => {
        const cfgX = $resolveConfig({ success: defaultSuccess, httpErrorCode: 'BOOM' });
        const r = $extractBiz(
            { status: 500, config: {}, data: null } as any,
            { isAxiosError: true, response: {} } as any,
            cfgX,
        );
        expect(r.code).toBe('BOOM');
    });

    it('error 路径 + status<400 → 用 networkErrorCode 占位', () => {
        const r = $extractBiz(
            { status: 0, config: {}, data: null } as any,
            { isAxiosError: true } as any,
            cfg,
        );
        expect(r.code).toBe(ERR_CODES.NETWORK);
    });

    it('TBizField 函数形态', () => {
        const cfgFn = $resolveConfig({
            success: defaultSuccess,
            codeKeyPath: (resp) => (resp?.data as any)?.bizCode,
            messageKeyPath: (resp) => (resp?.data as any)?.bizMsg,
            dataKeyPath: (resp) => (resp?.data as any)?.payload,
        });
        const r = $extractBiz(
            { status: 200, config: {}, data: { bizCode: 'C', bizMsg: 'M', payload: 'D' } } as any,
            undefined,
            cfgFn,
        );
        expect(r).toEqual({ code: 'C', message: 'M', data: 'D' });
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  $applyEnvelope —— success 函数裁决 + 请求级 nullable/emptyable 二次裁决
// ───────────────────────────────────────────────────────────────────────────

describe('normalize — $applyEnvelope', () => {
    function rt(cfg: ReturnType<typeof $resolveConfig>, partial: Partial<IResolvedRuntime> = {}): IResolvedRuntime {
        return { cfg, reqHadSuccess: false, ...partial };
    }

    it('error 路径：apiResp.success 始终 false（即便 success 函数返回 true）', () => {
        const cfg = $resolveConfig({ success: () => true });
        const resp = { status: 500, config: {}, data: { code: '0000', data: null } } as any;
        $applyEnvelope(resp, { isAxiosError: true } as any, rt(cfg));
        expect((resp.data as ApiResponse).success).toBe(false);
    });

    it('调用 success(apiResp)，并把返回值写回 apiResp.success', () => {
        const cfg = $resolveConfig({
            success: (a) => a.code === '0000' && a.data != null,
        });
        const resp = { status: 200, config: {}, data: { code: '0000', message: 'ok', data: { x: 1 } } } as any;
        $applyEnvelope(resp, undefined, rt(cfg));
        expect((resp.data as ApiResponse).success).toBe(true);

        const resp2 = { status: 200, config: {}, data: { code: '0000', message: 'ok', data: null } } as any;
        $applyEnvelope(resp2, undefined, rt(cfg));
        expect((resp2.data as ApiResponse).success).toBe(false);   // success 自己看 data
    });

    it('success 函数收到的 ApiResponse 此刻 .success=false（即"先假定失败"）', () => {
        let seenSuccess: boolean | undefined;
        const cfg = $resolveConfig({
            success: (a) => { seenSuccess = a.success; return true; },
        });
        const resp = { status: 200, config: {}, data: { code: '0000', data: { x: 1 } } } as any;
        $applyEnvelope(resp, undefined, rt(cfg));
        expect(seenSuccess).toBe(false);
        expect((resp.data as ApiResponse).success).toBe(true);  // 写回后变 true
    });

    it('请求级 nullable=true 在 reqHadSuccess=false 时覆盖 null data → success=true', () => {
        const cfg = $resolveConfig({
            success: (a) => a.code === '0000' && a.data != null,
        });
        const resp = { status: 200, config: {}, data: { code: '0000', data: null } } as any;
        // 默认 success 函数会 return false（data:null）
        $applyEnvelope(resp, undefined, rt(cfg, { reqNullable: true }));
        expect((resp.data as ApiResponse).success).toBe(true);   // nullable:true 覆盖
    });

    it('请求级 nullable=false 在 reqHadSuccess=false 时强制 null data → success=false', () => {
        const cfg = $resolveConfig({ success: () => true }); // 函数总返回 true
        const resp = { status: 200, config: {}, data: { code: '0000', data: null } } as any;
        $applyEnvelope(resp, undefined, rt(cfg, { reqNullable: false }));
        expect((resp.data as ApiResponse).success).toBe(false);   // nullable:false 强制
    });

    it('请求级 emptyable=true 在 reqHadSuccess=false 时让空对象/数组/串视为 success', () => {
        const cfg = $resolveConfig({
            success: (a) => a.code === '0000' && !!a.data,    // 默认 falsy data 不视为成功
        });
        for (const empty of [{}, [], '']) {
            const resp = { status: 200, config: {}, data: { code: '0000', data: empty } } as any;
            $applyEnvelope(resp, undefined, rt(cfg, { reqEmptyable: true }));
            expect((resp.data as ApiResponse).success).toBe(true);
        }
    });

    it('reqHadSuccess=true 时 nullable/emptyable 完全不参与', () => {
        const reqFn = (_a: ApiResponse) => true;
        const cfg = $resolveConfig({ success: defaultSuccess });
        const resp = { status: 200, config: {}, data: { code: '0000', data: null } } as any;
        // reqNullable=false 想强制失败，但 reqHadSuccess=true 让 nullable 不参与 → success=true
        $applyEnvelope(resp, undefined, {
            cfg: { ...cfg, success: reqFn },
            reqHadSuccess: true,
            reqNullable: false,
        });
        expect((resp.data as ApiResponse).success).toBe(true);
    });

    it('nullable 仅在 data===null/undefined 时生效；emptyable 仅在 data 是空容器时生效', () => {
        const cfg = $resolveConfig({ success: () => true });
        // data 非空：nullable / emptyable 都不动
        const resp = { status: 200, config: {}, data: { code: '0000', data: { x: 1 } } } as any;
        $applyEnvelope(resp, undefined, rt(cfg, { reqNullable: false, reqEmptyable: false }));
        expect((resp.data as ApiResponse).success).toBe(true);
    });

    it('nullable 优先于 emptyable —— null 走 nullable 分支不会再判 emptyable', () => {
        const cfg = $resolveConfig({ success: () => true });
        const resp = { status: 200, config: {}, data: { code: '0000', data: null } } as any;
        $applyEnvelope(resp, undefined, rt(cfg, { reqNullable: false, reqEmptyable: true }));
        // null 命中 nullable=false → false（即便 emptyable=true）
        expect((resp.data as ApiResponse).success).toBe(false);
    });
});


// ───────────────────────────────────────────────────────────────────────────
//  Plugin install
// ───────────────────────────────────────────────────────────────────────────

describe('normalize — install', () => {
    it('registers exactly one response interceptor (covers both onF and onR)', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use(normalize({ success: defaultSuccess }));
        const snap = api.plugins().find((p) => p.name === 'normalize');
        expect(snap?.responseInterceptors).toBe(1);
    });

    it('eject removes the interceptor', () => {
        const ax = axios.create();
        const api = create(ax);
        api.use(normalize({ success: defaultSuccess }));
        api.eject('normalize');
        expect(api.plugins().find((p) => p.name === 'normalize')).toBeUndefined();
    });
});
