import { describe, it, expect } from 'vitest';
import type { IHttpOptions } from '../../../src/types';
import { $key, type KeyOpts, $parse } from '../../../src/plugins/key';

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

describe('$key — method 大小写规范化', () => {
    it('[key.fn.$key] GET / get / Get / gEt 等价', () => {
        const a = k({ url: '/u', method: 'GET' });
        const b = k({ url: '/u', method: 'get' });
        const c = k({ url: '/u', method: 'Get' });
        const d = k({ url: '/u', method: 'gEt' });
        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(c).toBe(d);
    });

    it('[key.fn.$key] 不同 method 得到不同 key', () => {
        const a = k({ url: '/u', method: 'GET' });
        const b = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(b);
    });
});

describe('$key — simple vs deep 策略', () => {
    it('[key.fn.$key][key.opt.fastMode] simple 仅看 method+url，忽略 params 内容', () => {
        const a = k({ url: '/u', method: 'GET', params: { x: 1 } }, 'simple');
        const b = k({ url: '/u', method: 'GET', params: { x: 999 } }, 'simple');
        expect(a).toBe(b);
    });

    it('[key.fn.$key][key.opt.fastMode] simple 仅看 method+url，忽略 data 内容', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: 1 } }, 'simple');
        const b = k({ url: '/u', method: 'POST', data: { x: 999 } }, 'simple');
        expect(a).toBe(b);
    });

    it('[key.fn.$key][key.opt.fastMode] deep 区分 params 内容', () => {
        const a = k({ url: '/u', method: 'GET', params: { x: 1 } });
        const b = k({ url: '/u', method: 'GET', params: { x: 2 } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key][key.opt.fastMode] 无 body 时 simple === deep', () => {
        const a = k({ url: '/u', method: 'GET' }, 'simple');
        const b = k({ url: '/u', method: 'GET' }, 'deep');
        expect(a).toBe(b);
    });
});

describe('$key — 空容器等价（核心约束）', () => {
    it('[key.fn.$key] undefined / null / [] / {} / 嵌套空容器都等价于无 params', () => {
        const base = k({ url: '/u', method: 'GET' });
        const variants: any[] = [
            { url: '/u', method: 'GET', params: undefined },
            { url: '/u', method: 'GET', params: null },
            { url: '/u', method: 'GET', params: {} },
            { url: '/u', method: 'GET', params: [] },
            { url: '/u', method: 'GET', params: [null, undefined] },
            { url: '/u', method: 'GET', params: { a: null, b: undefined } },
            { url: '/u', method: 'GET', params: [{}] },
            { url: '/u', method: 'GET', params: { a: [] } },
            { url: '/u', method: 'GET', params: [[{}]] },
            { url: '/u', method: 'GET', params: { a: { b: { c: [] } } } },
        ];
        for (const v of variants) expect(k(v)).toBe(base);
    });

    it('[key.fn.$key] data 中等价空 child 与 [1] 等价', () => {
        const base = k({ url: '/u', method: 'POST', data: [1] });
        const variants: any[] = [
            { url: '/u', method: 'POST', data: [1, []] },
            { url: '/u', method: 'POST', data: [1, {}] },
            { url: '/u', method: 'POST', data: [1, null] },
            { url: '/u', method: 'POST', data: [1, undefined] },
            { url: '/u', method: 'POST', data: [1, NaN] },
            { url: '/u', method: 'POST', data: [1, [{}]] },
            { url: '/u', method: 'POST', data: [1, { t: [] }] },
        ];
        for (const v of variants) expect(k(v)).toBe(base);
    });

    it('[key.fn.$key] 对象 value 含等价空 与 {x:1} 等价', () => {
        const base = k({ url: '/u', method: 'POST', data: { x: 1 } });
        const variants: any[] = [
            { url: '/u', method: 'POST', data: { x: 1, y: null } },
            { url: '/u', method: 'POST', data: { x: 1, y: undefined } },
            { url: '/u', method: 'POST', data: { x: 1, y: NaN } },
            { url: '/u', method: 'POST', data: { x: 1, y: '' } },
            { url: '/u', method: 'POST', data: { x: 1, y: '   ' } },
            { url: '/u', method: 'POST', data: { x: 1, y: {} } },
            { url: '/u', method: 'POST', data: { x: 1, y: [] } },
            { url: '/u', method: 'POST', data: { x: 1, y: { z: [] } } },
        ];
        for (const v of variants) expect(k(v)).toBe(base);
    });
});

describe('$key — falsy 默认过滤策略', () => {
    it('[key.fn.$key] false / 0 视为有内容，互不相等且都不等于"无 data"', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: false } });
        const b = k({ url: '/u', method: 'POST', data: { a: 0 } });
        const none = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(b);
        expect(a).not.toBe(none);
        expect(b).not.toBe(none);
    });

    it('[key.fn.$key] "" / "   " / null / undefined / NaN 全部默认过滤，与"无 data"等价', () => {
        const variants: any[] = [
            { url: '/u', method: 'POST', data: { a: '' } },
            { url: '/u', method: 'POST', data: { a: '   ' } },
            { url: '/u', method: 'POST', data: { a: null } },
            { url: '/u', method: 'POST', data: { a: undefined } },
            { url: '/u', method: 'POST', data: { a: NaN } },
        ];
        const none = k({ url: '/u', method: 'POST' });
        for (const v of variants) expect(k(v)).toBe(none);
    });

    it('[key.fn.$key][key.opt.ignores] 用 ignores:[""] 可恢复空串作为有效值', () => {
        const noData = k({ url: '/u', method: 'POST' });
        const withEmpty = k({ url: '/u', method: 'POST', data: { a: '' } }, 'deep', { ignores: [''] });
        expect(withEmpty).not.toBe(noData);
        // 同时不与 null 撞 key（safeStr 区分 'e' / 'n'）
        const withNull = k({ url: '/u', method: 'POST', data: { a: null } }, 'deep', { ignores: ['', null] });
        expect(withEmpty).not.toBe(withNull);
    });
});

describe('$key — 内容差异区分', () => {
    it('[key.fn.$key] 不同 url', () => {
        const a = k({ url: '/a', method: 'GET' });
        const b = k({ url: '/b', method: 'GET' });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 不同 method', () => {
        const a = k({ url: '/u', method: 'GET' });
        const b = k({ url: '/u', method: 'PUT' });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] params 内容不同', () => {
        const a = k({ url: '/u', method: 'GET', params: { a: 1 } });
        const b = k({ url: '/u', method: 'GET', params: { a: 2 } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] params key 名不同', () => {
        const a = k({ url: '/u', method: 'GET', params: { a: 1 } });
        const b = k({ url: '/u', method: 'GET', params: { b: 1 } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 数组顺序不同', () => {
        const a = k({ url: '/u', method: 'POST', data: [1, 2] });
        const b = k({ url: '/u', method: 'POST', data: [2, 1] });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 数组长度不同', () => {
        const a = k({ url: '/u', method: 'POST', data: [1, 2] });
        const b = k({ url: '/u', method: 'POST', data: [1, 2, 3] });
        expect(a).not.toBe(b);
    });
});

describe('$key — 对象 key 顺序无关', () => {
    it('[key.fn.$key] 内部 sort 后 {a,b,c} ≡ {c,b,a}', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: 1, b: 2, c: 3 } });
        const b = k({ url: '/u', method: 'POST', data: { c: 3, b: 2, a: 1 } });
        expect(a).toBe(b);
    });
});

describe('$key — params/data 字段身份不互通', () => {
    it('[key.fn.$key] params={x:1} ≠ data={x:1}', () => {
        const a = k({ url: '/u', method: 'POST', params: { x: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 两边内容互换 → 不同 key', () => {
        const a = k({ url: '/u', method: 'POST', params: { x: 1 }, data: { y: 2 } });
        const b = k({ url: '/u', method: 'POST', params: { y: 2 }, data: { x: 1 } });
        expect(a).not.toBe(b);
    });
});

describe('$key — 边界字符串碰撞防护', () => {
    it('[key.fn.$key] 数组分隔符防碰撞 ["ab","c"] ≠ ["a","bc"]', () => {
        const a = k({ url: '/u', method: 'POST', data: ['ab', 'c'] });
        const b = k({ url: '/u', method: 'POST', data: ['a', 'bc'] });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 对象 key/value 分隔防碰撞 {ab:1} ≠ {a:"b1"}', () => {
        const a = k({ url: '/u', method: 'POST', data: { ab: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { a: 'b1' } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 字符串内容含分隔符：["ab,c"] ≠ ["ab","c"]（长度分帧）', () => {
        const a = k({ url: '/u', method: 'POST', params: ['ab,c'] });
        const b = k({ url: '/u', method: 'POST', params: ['ab', 'c'] });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 对象键含分隔符：{"a:b":"c"} ≠ {a:"b:c"}（长度分帧）', () => {
        const a = k({ url: '/u', method: 'POST', data: { 'a:b': 'c' } });
        const b = k({ url: '/u', method: 'POST', data: { a: 'b:c' } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 长度分帧不破坏等价性：键序无关、同内容同 key、采样模式同样防碰撞', () => {
        const x = k({ url: '/u', method: 'POST', data: { a: 'x', b: 'y' } });
        const y = k({ url: '/u', method: 'POST', data: { b: 'y', a: 'x' } });
        expect(x).toBe(y);
        const long = 'z'.repeat(100);
        const s1 = $key({ url: '/u', method: 'POST', params: [long + ',q'] } as IHttpOptions, false, undefined, true);
        const s2 = $key({ url: '/u', method: 'POST', params: [long, 'q'] } as IHttpOptions, false, undefined, true);
        expect(s1).not.toBe(s2);
    });
});

describe('$key — 长字符串采样', () => {
    it('[key.fn.$key][key.opt.sample] 相同长串 → 同 key', () => {
        const long = 'a'.repeat(200);
        const a = k({ url: '/u', method: 'POST', data: { token: long } });
        const b = k({ url: '/u', method: 'POST', data: { token: long } });
        expect(a).toBe(b);
    });

    it('[key.fn.$key][key.opt.sample] 长度不同 → 不同 key（L<n> 长度标签兜底）', () => {
        const a = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(100) } });
        const b = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(101) } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key][key.opt.sample] 内容差异落在中段 → 不同 key', () => {
        const a = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(100) + 'X' + 'a'.repeat(100) } });
        const b = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(100) + 'Y' + 'a'.repeat(100) } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key][key.opt.sample] 短串前后空格被 trim', () => {
        const a = k({ url: '/u', method: 'POST', data: { q: 'hi' } });
        const b = k({ url: '/u', method: 'POST', data: { q: '  hi  ' } });
        expect(a).toBe(b);
    });
});

describe('$key — Buffer / ArrayBuffer-like', () => {
    const buf = (n: number) => ({ byteLength: n });

    it('[key.fn.$key] 空 Buffer 视为空', () => {
        const a = k({ url: '/u', method: 'POST', data: buf(0) });
        const b = k({ url: '/u', method: 'POST' });
        expect(a).toBe(b);
    });

    it('[key.fn.$key] Buffer 长度不同 → 不同 key', () => {
        const a = k({ url: '/u', method: 'POST', data: buf(100) });
        const b = k({ url: '/u', method: 'POST', data: buf(101) });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] Buffer 长度相同 → 同 key', () => {
        const a = k({ url: '/u', method: 'POST', data: buf(100) });
        const b = k({ url: '/u', method: 'POST', data: buf(100) });
        expect(a).toBe(b);
    });
});

describe('$key — 嵌套结构', () => {
    it('[key.fn.$key] 嵌套对象内容不同', () => {
        const a = k({ url: '/u', method: 'POST', data: { filter: { type: 'video' } } });
        const b = k({ url: '/u', method: 'POST', data: { filter: { type: 'image' } } });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 数组中嵌套对象内容不同', () => {
        const a = k({ url: '/u', method: 'POST', data: [{ id: 1 }, { id: 2 }] });
        const b = k({ url: '/u', method: 'POST', data: [{ id: 1 }, { id: 3 }] });
        expect(a).not.toBe(b);
    });

    it('[key.fn.$key] 深层全空 等价于不带该字段', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { a: 1, b: { c: { d: [null, [], {}] } } } });
        expect(a).toBe(b);
    });
});

describe('$key — 已知行为', () => {
    it('[key.fn.$key] 数字 1 与字符串 "1" 等价（按 String() 序列化）', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { a: '1' } });
        expect(a).toBe(b);
    });
});

// Review 修复：#16 特殊类型 / #1 scope

// 来源 review #16
describe('$parse deep — Date / URLSearchParams / 不可序列化类型', () => {
    const k = (data: any) => $parse({ method: 'post', url: '/x', key: 'deep', data } as any);

    it('[key.fn.$parse] 不同 Date → 不同 key；相同 Date → 同 key', () => {
        expect(k({ d: new Date('2020-01-01') })).not.toBe(k({ d: new Date('2021-01-01') }));
        expect(k({ d: new Date('2020-01-01') })).toBe(k({ d: new Date('2020-01-01') }));
    });
    it('[key.fn.$parse] 顶层 Date 也区分', () => {
        expect(k(new Date(1))).not.toBe(k(new Date(2)));
    });
    it('[key.fn.$parse] URLSearchParams 按内容区分', () => {
        expect(k(new URLSearchParams('a=1'))).not.toBe(k(new URLSearchParams('a=2')));
        expect(k(new URLSearchParams('a=1'))).toBe(k(new URLSearchParams('a=1')));
    });
    it('[key.fn.$parse] FormData / Blob / Map / Set 等不可序列化 → 返回 null（宁可不命中）', () => {
        expect(k(new FormData())).toBeNull();
        expect(k({ f: new Blob(['x']) })).toBeNull();
        expect(k({ m: new Map([[1, 2]]) })).toBeNull();
        expect(k({ s: new Set([1]) })).toBeNull();
    });
});
