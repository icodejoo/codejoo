import { describe, it, expect } from 'vitest';
import type { IHttpOptions } from '../../src/types';
import key, { $key, $parse, type KeyOpts } from '../../src/plugins/key';

/** 把任意值格式化成可读单行（保留 undefined / NaN 等 JSON.stringify 会丢的信息） */
function fmt(v: any, seen = new WeakSet()): string {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'number') return v !== v ? 'NaN' : String(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v !== 'object') return String(v);
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return '[ ' + v.map(x => fmt(x, seen)).join(', ') + ' ]';
    const keys = Object.keys(v);
    return keys.length === 0 ? '{}' : '{ ' + keys.map(k => `${k}: ${fmt(v[k], seen)}`).join(', ') + ' }';
}

/** 包装 $key 调用：执行 + 打印 [hash] policy config 形式的日志 */
function k(config: any, policy: 'simple' | 'deep' = 'deep', opts?: KeyOpts): string {
    const result = $key(config as IHttpOptions, policy === 'simple', opts);
    const tag = opts ? `${policy}+opts` : policy;
    console.log(`  [${result}] ${tag.padEnd(12)} ${fmt(config)}${opts ? ' opts=' + fmt(opts) : ''}`);
    return result;
}

/** 按指定请求体与选项生成 deep key。 */
function fingerprint(data: unknown, options: any = {}) {
    return $parse({ method: 'post', url: '/x', data, key: { ...options } });
}

describe('$key — ignores 按键名豁免', () => {
    it('[key.fn.$key][key.opt.ignores] 指定 key 即使 value 为 null 也参与 hash', () => {
        // 默认：ts:null 会被过滤，与无 ts 等价
        const baseline = k({ url: '/u', method: 'POST', data: { x: 1, ts: null } });
        const noTs = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(baseline).toBe(noTs);
        // 启用 ignores: ts 强制保留 → 与无 ts 不同
        const preserved = k({ url: '/u', method: 'POST', data: { x: 1, ts: null } }, 'deep', { ignores: ['ts'] });
        expect(preserved).not.toBe(noTs);
    });

    it('[key.fn.$key][key.opt.ignores] 被保留的 key 即使 value 为空容器也参与 hash', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: 1, filter: {} } }, 'deep', { ignores: ['filter'] });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key][key.opt.ignores] value 非空时 ignores 不影响（与无 opts 等价）', () => {
        const withOpts = k({ url: '/u', method: 'POST', data: { x: 1, ts: 100 } }, 'deep', { ignores: ['ts'] });
        const withoutOpts = k({ url: '/u', method: 'POST', data: { x: 1, ts: 100 } });
        expect(withOpts).toBe(withoutOpts);
    });

    it('[key.fn.$key][key.opt.ignores] 未在对象中的 ignores 键名项无副作用', () => {
        // ignores 包含 'missing'，但对象里没有 missing
        const a = k({ url: '/u', method: 'POST', data: { x: 1 } }, 'deep', { ignores: ['missing'] });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(a).toBe(b);
    });

    it('[key.fn.$key][key.opt.ignores] 多个键名同时生效', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: 1, a: null, b: undefined } }, 'deep', { ignores: ['a', 'b'] });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        const c = k({ url: '/u', method: 'POST', data: { x: 1, a: null } }, 'deep', { ignores: ['a'] });
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);  // 多保留一个 b → 与只保留 a 不同
    });
});

describe('$key — ignores 按值豁免', () => {
    it('[key.fn.$key][key.opt.ignores] 保留 null 值，使 {x:null} ≠ 无 data', () => {
        const baseline = k({ url: '/u', method: 'POST', data: { x: null } });
        const noData = k({ url: '/u', method: 'POST' });
        expect(baseline).toBe(noData);  // 默认：null 被过滤
        const preserved = k({ url: '/u', method: 'POST', data: { x: null } }, 'deep', { ignores: [null] });
        expect(preserved).not.toBe(noData);
    });

    it('[key.fn.$key][key.opt.ignores] 保留 null 时 key 名仍参与 hash', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: null } }, 'deep', { ignores: [null] });
        const b = k({ url: '/u', method: 'POST', data: { y: null } }, 'deep', { ignores: [null] });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key][key.opt.ignores] 保留 NaN（NaN-aware 比较）', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: NaN } }, 'deep', { ignores: [NaN] });
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(noData);
    });

    it('[key.fn.$key][key.opt.ignores] 保留 undefined', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: undefined } }, 'deep', { ignores: [undefined] });
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(noData);
    });

    it('[key.fn.$key][key.opt.ignores] 保留多个值类型并存', () => {
        const opts = { ignores: [null, undefined, NaN] } satisfies KeyOpts;
        const a = k({ url: '/u', method: 'POST', data: { x: null, y: undefined, z: NaN } }, 'deep', opts);
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(noData);
        // 同 key 集合，但 x/y 的值类型互换（null↔undefined）→ hash 字节流不同
        const b = k({ url: '/u', method: 'POST', data: { x: undefined, y: null, z: NaN } }, 'deep', opts);
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key][key.opt.ignores] 数组中的 null 在 ignores:[null] 下保留', () => {
        const filtered = k({ url: '/u', method: 'POST', data: [1, null, 2] });
        const compact = k({ url: '/u', method: 'POST', data: [1, 2] });
        expect(filtered).toBe(compact);  // 默认：null 在数组中被过滤
        const preserved = k({ url: '/u', method: 'POST', data: [1, null, 2] }, 'deep', { ignores: [null] });
        expect(preserved).not.toBe(compact);
    });

    it('[key.fn.$key][key.opt.ignores] 未命中 ignores 的 falsy 值仍被过滤', () => {
        // ignores 只包含 null，undefined 仍被过滤
        const a = k({ url: '/u', method: 'POST', data: { x: undefined } }, 'deep', { ignores: [null] });
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).toBe(noData);
    });
});

describe('$key — ignores 混合键名/值', () => {
    it('[key.fn.$key][key.opt.ignores] 同一个 ignores 数组里键名和值两种豁免同时生效', () => {
        const opts: KeyOpts = { ignores: ['ts', null] };
        const a = k({ url: '/u', method: 'POST', data: { ts: undefined, x: null } }, 'deep', opts);
        const b = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(b);  // ts 命中键名豁免保留、x 命中值豁免保留
    });

    it('[key.fn.$key][key.opt.ignores] 对象形式 key 默认走 deep + 透传 opts', () => {
        // 通过 $parse 验证整条链路
        const r1 = $parse({
            key: { ignores: ['ts'] },
            url: '/u', method: 'POST',
            data: { x: 1, ts: null },
        } as IHttpOptions);
        const r2 = $parse({
            key: { ignores: ['ts'] },
            url: '/u', method: 'POST',
            data: { x: 1 },
        } as IHttpOptions);
        console.log(`  [${r1}] with ts:null preserved`);
        console.log(`  [${r2}] without ts`);
        expect(r1).not.toBe(r2);
    });
});

// Review 修复：#16 特殊类型 / #1 scope

// 来源 review #16
describe('$parse deep — Date / URLSearchParams / 不可序列化类型', () => {
    const k = (data: any) => $parse({ method: 'post', url: '/x', key: 'deep', data } as any);
    it('[key.fn.$parse][key.opt.ignores] 被 ignores 命中的字段不影响（即便是 Blob）', () => {
        const a = $parse({ url: '/x', key: { ignores: ['file'] }, data: { file: new Blob(['a']), n: 1 } } as any);
        expect(a).not.toBeNull();
    });
});

describe('key — scope、采样与错误边界', () => {
    it('[key.fn.$key][key.opt.ignores] 忽略值可以保留 false、空字符串等特殊标签，避免与缺失项等价', () => {
        expect(fingerprint({ value: '' }, { ignores: [''] })).not.toBe(fingerprint({}));
        expect(fingerprint({ value: false }, { ignores: [false] })).not.toBe(fingerprint({ value: false }));
    });
});
