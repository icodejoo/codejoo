import { describe, it, expect } from 'vitest';
import type { IHttpOptions } from '../../../src/types';
import { $parse } from '../../../src/plugins/key';

describe('$parse — key 字段处理', () => {
    it('[key.fn.$parse][key.req.key] null/undefined/false/空串/空白串 → null', () => {
        expect($parse({} as IHttpOptions)).toBe(null);
        expect($parse({ key: null } as any)).toBe(null);
        expect($parse({ key: false } as any)).toBe(null);
        expect($parse({ key: '' } as IHttpOptions)).toBe(null);
        expect($parse({ key: '   ' } as IHttpOptions)).toBe(null);
    });

    it('[key.fn.$parse][key.req.key][key.req.key.number] 数字 0 转字符串 "0"（非 null）', () => {
        expect($parse({ key: 0 } as IHttpOptions)).toBe('0');
    });

    it('[key.fn.$parse][key.req.key] 字符串去空白后保留', () => {
        expect($parse({ key: 'abc' } as IHttpOptions)).toBe('abc');
        expect($parse({ key: '  abc  ' } as IHttpOptions)).toBe('abc');
    });

    it('[key.fn.$parse][key.req.key][key.req.key.number] 数字转字符串', () => {
        expect($parse({ key: 42 } as IHttpOptions)).toBe('42');
    });

    it('[key.fn.$parse][key.req.key] 字符串 "deep" → 触发 deep 模式自动生成', () => {
        const r = $parse({ key: 'deep', url: '/u', method: 'GET', params: { x: 1 } } as IHttpOptions);
        console.log(`  [${r}] key:'deep'`);
        expect(r).not.toBe(null);
        expect(typeof r).toBe('string');
    });

    it('[key.fn.$parse][key.req.key][key.req.key.callback] 函数返回值用作 key', () => {
        expect($parse({ key: () => 'fn-key' } as unknown as IHttpOptions)).toBe('fn-key');
        expect($parse({ key: (() => 123) as any } as IHttpOptions)).toBe('123');
        expect($parse({ key: () => null } as unknown as IHttpOptions)).toBe(null);
    });

    it('[key.fn.$parse][key.req.key] key=true → simple 模式自动生成', () => {
        const r = $parse({ key: true, url: '/u', method: 'GET' } as IHttpOptions);
        console.log(`  [${r}] key:true`);
        expect(r).not.toBe(null);
        expect(typeof r).toBe('string');
    });

    it('[key.fn.$parse][key.req.key] key 为对象 → 默认 deep + 透传 ignore 选项', () => {
        const r = $parse({
            key: { ignores: ['ts'] },
            url: '/u', method: 'GET',
            params: { x: 1, ts: null },
        } as IHttpOptions);
        console.log(`  [${r}] key:{ignores:['ts']}`);
        expect(r).not.toBe(null);
    });
});

describe('$parse — 插件级 defaults 与请求级合并', () => {
    it('[key.opt.sample][key.req.key.sample] 请求级 sample:false 覆盖插件采样并恢复全量哈希', () => {
        const data = 'a'.repeat(100);
        const changed = data.slice(0, 20) + 'b' + data.slice(21);
        const config = { url: '/x', method: 'post', key: { sample: false }, data };
        expect($parse(config, { sample: true })).not.toBe($parse({ ...config, data: changed }, { sample: true }));
        expect($parse({ ...config, key: {} }, { sample: true })).toBe($parse({ ...config, key: {}, data: changed }, { sample: true }));
    });
    const reqWithTs = {
        key: true,
        url: '/u', method: 'POST',
        data: { x: 1, ts: null },
    } as IHttpOptions;
    const reqNoTs = {
        key: true,
        url: '/u', method: 'POST',
        data: { x: 1 },
    } as IHttpOptions;

    it('[key.fn.$parse][key.opt.fastMode][key.opt.ignores] 插件级 fastMode:false 让 key:true 走 deep', () => {
        const r1 = $parse({ ...reqWithTs }, { fastMode: false });
        const r2 = $parse({ ...reqNoTs }, { fastMode: false });
        // deep 模式下，ts:null 默认会被过滤 → r1 等于 r2
        expect(r1).toBe(r2);
        console.log(`  [${r1}] key:true + plugin fastMode:false`);
        // 对照：simple 模式（默认）下，r1 r2 完全忽略 data，也是相等
        const rSimple1 = $parse({ ...reqWithTs });
        const rSimple2 = $parse({ ...reqNoTs });
        expect(rSimple1).toBe(rSimple2);
        // 但 deep 与 simple 的 key 不同
        expect(r1).not.toBe(rSimple1);
    });

    it('[key.fn.$parse][key.opt.fastMode][key.opt.ignores] 插件级 ignores 键名在 key:true + fastMode:false 时生效', () => {
        const defaults = { fastMode: false, ignores: ['ts'] };
        const r1 = $parse({ ...reqWithTs }, defaults);
        const r2 = $parse({ ...reqNoTs }, defaults);
        // ts 被插件级 ignores 强制保留 → r1 ≠ r2
        expect(r1).not.toBe(r2);
        console.log(`  [${r1}] plugin ignores:['ts'] preserves ts:null`);
    });

    it('[key.fn.$parse][key.opt.fastMode][key.opt.ignores] 插件级 ignores 按值在 key:"deep" 时生效', () => {
        const defaults = { ignores: [null] };
        const r1 = $parse({
            key: 'deep' as any,
            url: '/u', method: 'POST',
            data: { x: 1, y: null },
        } as IHttpOptions, defaults);
        const r2 = $parse({
            key: 'deep' as any,
            url: '/u', method: 'POST',
            data: { x: 1 },
        } as IHttpOptions, defaults);
        expect(r1).not.toBe(r2);
        console.log(`  [${r1}] plugin ignores:[null] preserves y:null`);
    });

    it('[key.fn.$parse][key.opt.fastMode][key.opt.ignores][key.req.key.ignores] 请求级对象优先于插件级', () => {
        const defaults = { fastMode: false, ignores: ['plugin-key'] };
        // 请求级 ignores:['req-key'] 应当完全覆盖插件级（不合并）
        const r = $parse({
            key: { ignores: ['req-key'] },
            url: '/u', method: 'POST',
            data: { x: 1, 'req-key': null, 'plugin-key': null },
        } as IHttpOptions, defaults);
        // req-key 被保留、plugin-key 被过滤 → 与"只有 req-key 保留"等价
        const expected = $parse({
            key: { ignores: ['req-key'] },
            url: '/u', method: 'POST',
            data: { x: 1, 'req-key': null },
        } as IHttpOptions);
        expect(r).toBe(expected);
        console.log(`  [${r}] req ignores overrides plugin ignores`);
    });

    it('[key.fn.$parse][key.opt.fastMode][key.opt.ignores] 请求级未指定的字段回退到插件级', () => {
        // 请求 key:{} 既没 fastMode 也没 ignores → 全用插件级
        const defaults = { fastMode: false, ignores: ['ts'] };
        const r1 = $parse({
            key: {},
            url: '/u', method: 'POST',
            data: { x: 1, ts: null },
        } as IHttpOptions, defaults);
        const r2 = $parse({
            key: { fastMode: false, ignores: ['ts'] },
            url: '/u', method: 'POST',
            data: { x: 1, ts: null },
        } as IHttpOptions);
        expect(r1).toBe(r2);
    });

    it('[key.fn.$parse][key.opt.fastMode][key.opt.ignores] 无 defaults 时行为与之前一致（向后兼容）', () => {
        const r1 = $parse({ ...reqWithTs });
        const r2 = $parse({ ...reqWithTs }, undefined);
        const r3 = $parse({ ...reqWithTs }, {});
        expect(r1).toBe(r2);
        expect(r2).toBe(r3);
    });
});

// 来源 review #1
describe('$parse — scope 并入 key', () => {
    it('[key.req.key.fastMode] 请求级 fastMode:true 覆盖插件 deep 默认', () => {
        const config = { url: '/x', method: 'get', key: { fastMode: true }, params: { n: 1 } };
        expect($parse(config, { fastMode: false })).toBe($parse({ ...config, params: { n: 2 } }, { fastMode: false }));
        expect($parse(config, { fastMode: false })).not.toBe($parse({ ...config, key: { fastMode: false } }));
    });

    it('[key.req.key.scope.callback] 请求级 scope 回调接收当前配置并覆盖插件回调', () => {
        const config = { url: '/tenant', key: { scope: (c: any) => c.url } };
        expect($parse(config, { scope: () => 'plugin' })).toBe($parse({ ...config, key: {} }) + '#/tenant');
    });
    it('[key.fn.$parse][key.opt.scope][key.cb.scope][key.req.key.scope] scope 不同 → key 不同；相同 → 相同', () => {
        const cfg = { method: 'get', url: '/x', key: true } as any;
        const a = $parse(cfg, { scope: () => 'u1' });
        const b = $parse(cfg, { scope: () => 'u2' });
        expect(a).not.toBe(b);
        expect(a).toBe($parse(cfg, { scope: () => 'u1' }));
    });
    it('[key.fn.$parse][key.opt.scope][key.req.key.scope] scope 对字符串 / 函数 key 也生效；返回空值则不并入', () => {
        expect($parse({ key: 'abc' } as any, { scope: () => 7 })).not.toBe('abc');
        expect($parse({ key: 'abc' } as any, { scope: () => undefined })).toBe('abc');
        expect($parse({ key: () => 'f' } as any, { scope: () => 's' })).not.toBe('f');
    });
    it('[key.fn.$parse][key.opt.scope][key.req.key.scope] 请求级 key 对象的 scope 优先于插件级', () => {
        const a = $parse({ url: '/x', key: { scope: 'req' } } as any, { scope: () => 'plug' });
        const b = $parse({ url: '/x', key: { scope: 'req2' } } as any, { scope: () => 'plug' });
        expect(a).not.toBe(b);
    });
});
