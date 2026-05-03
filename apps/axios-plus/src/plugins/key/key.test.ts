import { describe, it, expect } from 'vitest';
import type { IHttpOptions } from '../../core/types';
import { $key, $parse } from './key';
import type { KeyOpts } from './types';

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


describe('$parse — key 字段处理', () => {
    it('null/undefined/false/空串/空白串 → null', () => {
        expect($parse({} as IHttpOptions)).toBe(null);
        expect($parse({ key: null } as any)).toBe(null);
        expect($parse({ key: false } as any)).toBe(null);
        expect($parse({ key: '' } as IHttpOptions)).toBe(null);
        expect($parse({ key: '   ' } as IHttpOptions)).toBe(null);
    });

    it('数字 0 转字符串 "0"（非 null）', () => {
        expect($parse({ key: 0 } as IHttpOptions)).toBe('0');
    });

    it('字符串去空白后保留', () => {
        expect($parse({ key: 'abc' } as IHttpOptions)).toBe('abc');
        expect($parse({ key: '  abc  ' } as IHttpOptions)).toBe('abc');
    });

    it('数字转字符串', () => {
        expect($parse({ key: 42 } as IHttpOptions)).toBe('42');
    });

    it('字符串 "deep" → 触发 deep 模式自动生成', () => {
        const r = $parse({ key: 'deep', url: '/u', method: 'GET', params: { x: 1 } } as IHttpOptions);
        console.log(`  [${r}] key:'deep'`);
        expect(r).not.toBe(null);
        expect(typeof r).toBe('string');
    });

    it('函数返回值用作 key', () => {
        expect($parse({ key: () => 'fn-key' } as unknown as IHttpOptions)).toBe('fn-key');
        expect($parse({ key: (() => 123) as any } as IHttpOptions)).toBe('123');
        expect($parse({ key: () => null } as unknown as IHttpOptions)).toBe(null);
    });

    it('key=true → simple 模式自动生成', () => {
        const r = $parse({ key: true, url: '/u', method: 'GET' } as IHttpOptions);
        console.log(`  [${r}] key:true`);
        expect(r).not.toBe(null);
        expect(typeof r).toBe('string');
    });

    it('key 为对象 → 默认 deep + 透传 ignore 选项', () => {
        const r = $parse({
            key: { ignoreKeys: ['ts'] },
            url: '/u', method: 'GET',
            params: { x: 1, ts: null },
        } as IHttpOptions);
        console.log(`  [${r}] key:{ignoreKeys:['ts']}`);
        expect(r).not.toBe(null);
    });
});


describe('$key — method 大小写规范化', () => {
    it('GET / get / Get / gEt 等价', () => {
        const a = k({ url: '/u', method: 'GET' });
        const b = k({ url: '/u', method: 'get' });
        const c = k({ url: '/u', method: 'Get' });
        const d = k({ url: '/u', method: 'gEt' });
        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(c).toBe(d);
    });

    it('不同 method 得到不同 key', () => {
        const a = k({ url: '/u', method: 'GET' });
        const b = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(b);
    });
});


describe('$key — simple vs deep 策略', () => {
    it('simple 仅看 method+url，忽略 params 内容', () => {
        const a = k({ url: '/u', method: 'GET', params: { x: 1 } }, 'simple');
        const b = k({ url: '/u', method: 'GET', params: { x: 999 } }, 'simple');
        expect(a).toBe(b);
    });

    it('simple 仅看 method+url，忽略 data 内容', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: 1 } }, 'simple');
        const b = k({ url: '/u', method: 'POST', data: { x: 999 } }, 'simple');
        expect(a).toBe(b);
    });

    it('deep 区分 params 内容', () => {
        const a = k({ url: '/u', method: 'GET', params: { x: 1 } });
        const b = k({ url: '/u', method: 'GET', params: { x: 2 } });
        expect(a).not.toBe(b);
    });

    it('无 body 时 simple === deep', () => {
        const a = k({ url: '/u', method: 'GET' }, 'simple');
        const b = k({ url: '/u', method: 'GET' }, 'deep');
        expect(a).toBe(b);
    });
});


describe('$key — 空容器等价（核心约束）', () => {
    it('undefined / null / [] / {} / 嵌套空容器都等价于无 params', () => {
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

    it('data 中等价空 child 与 [1] 等价', () => {
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

    it('对象 value 含等价空 与 {x:1} 等价', () => {
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
    it('false / 0 视为有内容，互不相等且都不等于"无 data"', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: false } });
        const b = k({ url: '/u', method: 'POST', data: { a: 0 } });
        const none = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(b);
        expect(a).not.toBe(none);
        expect(b).not.toBe(none);
    });

    it('"" / "   " / null / undefined / NaN 全部默认过滤，与"无 data"等价', () => {
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

    it('用 ignoreValues:[""] 可恢复空串作为有效值', () => {
        const noData = k({ url: '/u', method: 'POST' });
        const withEmpty = k({ url: '/u', method: 'POST', data: { a: '' } }, 'deep', { ignoreValues: [''] });
        expect(withEmpty).not.toBe(noData);
        // 同时不与 null 撞 key（safeStr 区分 'e' / 'n'）
        const withNull = k({ url: '/u', method: 'POST', data: { a: null } }, 'deep', { ignoreValues: ['', null] });
        expect(withEmpty).not.toBe(withNull);
    });
});


describe('$key — 内容差异区分', () => {
    it('不同 url', () => {
        const a = k({ url: '/a', method: 'GET' });
        const b = k({ url: '/b', method: 'GET' });
        expect(a).not.toBe(b);
    });

    it('不同 method', () => {
        const a = k({ url: '/u', method: 'GET' });
        const b = k({ url: '/u', method: 'PUT' });
        expect(a).not.toBe(b);
    });

    it('params 内容不同', () => {
        const a = k({ url: '/u', method: 'GET', params: { a: 1 } });
        const b = k({ url: '/u', method: 'GET', params: { a: 2 } });
        expect(a).not.toBe(b);
    });

    it('params key 名不同', () => {
        const a = k({ url: '/u', method: 'GET', params: { a: 1 } });
        const b = k({ url: '/u', method: 'GET', params: { b: 1 } });
        expect(a).not.toBe(b);
    });

    it('数组顺序不同', () => {
        const a = k({ url: '/u', method: 'POST', data: [1, 2] });
        const b = k({ url: '/u', method: 'POST', data: [2, 1] });
        expect(a).not.toBe(b);
    });

    it('数组长度不同', () => {
        const a = k({ url: '/u', method: 'POST', data: [1, 2] });
        const b = k({ url: '/u', method: 'POST', data: [1, 2, 3] });
        expect(a).not.toBe(b);
    });
});


describe('$key — 对象 key 顺序无关', () => {
    it('内部 sort 后 {a,b,c} ≡ {c,b,a}', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: 1, b: 2, c: 3 } });
        const b = k({ url: '/u', method: 'POST', data: { c: 3, b: 2, a: 1 } });
        expect(a).toBe(b);
    });
});


describe('$key — params/data 字段身份不互通', () => {
    it('params={x:1} ≠ data={x:1}', () => {
        const a = k({ url: '/u', method: 'POST', params: { x: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(a).not.toBe(b);
    });

    it('两边内容互换 → 不同 key', () => {
        const a = k({ url: '/u', method: 'POST', params: { x: 1 }, data: { y: 2 } });
        const b = k({ url: '/u', method: 'POST', params: { y: 2 }, data: { x: 1 } });
        expect(a).not.toBe(b);
    });
});


describe('$key — 边界字符串碰撞防护', () => {
    it('数组分隔符防碰撞 ["ab","c"] ≠ ["a","bc"]', () => {
        const a = k({ url: '/u', method: 'POST', data: ['ab', 'c'] });
        const b = k({ url: '/u', method: 'POST', data: ['a', 'bc'] });
        expect(a).not.toBe(b);
    });

    it('对象 key/value 分隔防碰撞 {ab:1} ≠ {a:"b1"}', () => {
        const a = k({ url: '/u', method: 'POST', data: { ab: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { a: 'b1' } });
        expect(a).not.toBe(b);
    });
});


describe('$key — 长字符串采样', () => {
    it('相同长串 → 同 key', () => {
        const long = 'a'.repeat(200);
        const a = k({ url: '/u', method: 'POST', data: { token: long } });
        const b = k({ url: '/u', method: 'POST', data: { token: long } });
        expect(a).toBe(b);
    });

    it('长度不同 → 不同 key（L<n> 长度标签兜底）', () => {
        const a = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(100) } });
        const b = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(101) } });
        expect(a).not.toBe(b);
    });

    it('内容差异落在中段 → 不同 key', () => {
        const a = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(100) + 'X' + 'a'.repeat(100) } });
        const b = k({ url: '/u', method: 'POST', data: { token: 'a'.repeat(100) + 'Y' + 'a'.repeat(100) } });
        expect(a).not.toBe(b);
    });

    it('短串前后空格被 trim', () => {
        const a = k({ url: '/u', method: 'POST', data: { q: 'hi' } });
        const b = k({ url: '/u', method: 'POST', data: { q: '  hi  ' } });
        expect(a).toBe(b);
    });
});


describe('$key — Buffer / ArrayBuffer-like', () => {
    const buf = (n: number) => ({ byteLength: n });

    it('空 Buffer 视为空', () => {
        const a = k({ url: '/u', method: 'POST', data: buf(0) });
        const b = k({ url: '/u', method: 'POST' });
        expect(a).toBe(b);
    });

    it('Buffer 长度不同 → 不同 key', () => {
        const a = k({ url: '/u', method: 'POST', data: buf(100) });
        const b = k({ url: '/u', method: 'POST', data: buf(101) });
        expect(a).not.toBe(b);
    });

    it('Buffer 长度相同 → 同 key', () => {
        const a = k({ url: '/u', method: 'POST', data: buf(100) });
        const b = k({ url: '/u', method: 'POST', data: buf(100) });
        expect(a).toBe(b);
    });
});


describe('$key — 嵌套结构', () => {
    it('嵌套对象内容不同', () => {
        const a = k({ url: '/u', method: 'POST', data: { filter: { type: 'video' } } });
        const b = k({ url: '/u', method: 'POST', data: { filter: { type: 'image' } } });
        expect(a).not.toBe(b);
    });

    it('数组中嵌套对象内容不同', () => {
        const a = k({ url: '/u', method: 'POST', data: [{ id: 1 }, { id: 2 }] });
        const b = k({ url: '/u', method: 'POST', data: [{ id: 1 }, { id: 3 }] });
        expect(a).not.toBe(b);
    });

    it('深层全空 等价于不带该字段', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { a: 1, b: { c: { d: [null, [], {}] } } } });
        expect(a).toBe(b);
    });
});


describe('$key — 已知行为', () => {
    it('数字 1 与字符串 "1" 等价（按 String() 序列化）', () => {
        const a = k({ url: '/u', method: 'POST', data: { a: 1 } });
        const b = k({ url: '/u', method: 'POST', data: { a: '1' } });
        expect(a).toBe(b);
    });
});


describe('$key — ignoreKeys（key 豁免空值过滤）', () => {
    it('指定 key 即使 value 为 null 也参与 hash', () => {
        // 默认：ts:null 会被过滤，与无 ts 等价
        const baseline = k({ url: '/u', method: 'POST', data: { x: 1, ts: null } });
        const noTs = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(baseline).toBe(noTs);
        // 启用 ignoreKeys: ts 强制保留 → 与无 ts 不同
        const preserved = k({ url: '/u', method: 'POST', data: { x: 1, ts: null } }, 'deep', { ignoreKeys: ['ts'] });
        expect(preserved).not.toBe(noTs);
    });

    it('被保留的 key 即使 value 为空容器也参与 hash', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: 1, filter: {} } }, 'deep', { ignoreKeys: ['filter'] });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(a).not.toBe(b);
    });

    it('value 非空时 ignoreKeys 不影响（与无 opts 等价）', () => {
        const withOpts = k({ url: '/u', method: 'POST', data: { x: 1, ts: 100 } }, 'deep', { ignoreKeys: ['ts'] });
        const withoutOpts = k({ url: '/u', method: 'POST', data: { x: 1, ts: 100 } });
        expect(withOpts).toBe(withoutOpts);
    });

    it('未在对象中的 ignoreKeys 项无副作用', () => {
        // ignoreKeys 包含 'missing'，但对象里没有 missing
        const a = k({ url: '/u', method: 'POST', data: { x: 1 } }, 'deep', { ignoreKeys: ['missing'] });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        expect(a).toBe(b);
    });

    it('多个 ignoreKeys 都生效', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: 1, a: null, b: undefined } }, 'deep', { ignoreKeys: ['a', 'b'] });
        const b = k({ url: '/u', method: 'POST', data: { x: 1 } });
        const c = k({ url: '/u', method: 'POST', data: { x: 1, a: null } }, 'deep', { ignoreKeys: ['a'] });
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);  // 多保留一个 b → 与只保留 a 不同
    });
});


describe('$key — ignoreValues（值豁免空值过滤）', () => {
    it('保留 null 值，使 {x:null} ≠ 无 data', () => {
        const baseline = k({ url: '/u', method: 'POST', data: { x: null } });
        const noData = k({ url: '/u', method: 'POST' });
        expect(baseline).toBe(noData);  // 默认：null 被过滤
        const preserved = k({ url: '/u', method: 'POST', data: { x: null } }, 'deep', { ignoreValues: [null] });
        expect(preserved).not.toBe(noData);
    });

    it('保留 null 时 key 名仍参与 hash', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: null } }, 'deep', { ignoreValues: [null] });
        const b = k({ url: '/u', method: 'POST', data: { y: null } }, 'deep', { ignoreValues: [null] });
        expect(a).not.toBe(b);
    });

    it('保留 NaN（NaN-aware 比较）', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: NaN } }, 'deep', { ignoreValues: [NaN] });
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(noData);
    });

    it('保留 undefined', () => {
        const a = k({ url: '/u', method: 'POST', data: { x: undefined } }, 'deep', { ignoreValues: [undefined] });
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(noData);
    });

    it('保留多个值类型并存', () => {
        const opts = { ignoreValues: [null, undefined, NaN] } satisfies KeyOpts;
        const a = k({ url: '/u', method: 'POST', data: { x: null, y: undefined, z: NaN } }, 'deep', opts);
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(noData);
        // 同 key 集合，但 x/y 的值类型互换（null↔undefined）→ hash 字节流不同
        const b = k({ url: '/u', method: 'POST', data: { x: undefined, y: null, z: NaN } }, 'deep', opts);
        expect(a).not.toBe(b);
    });

    it('数组中的 null 在 ignoreValues:[null] 下保留', () => {
        const filtered = k({ url: '/u', method: 'POST', data: [1, null, 2] });
        const compact = k({ url: '/u', method: 'POST', data: [1, 2] });
        expect(filtered).toBe(compact);  // 默认：null 在数组中被过滤
        const preserved = k({ url: '/u', method: 'POST', data: [1, null, 2] }, 'deep', { ignoreValues: [null] });
        expect(preserved).not.toBe(compact);
    });

    it('未命中 ignoreValues 的 falsy 值仍被过滤', () => {
        // ignoreValues 只包含 null，undefined 仍被过滤
        const a = k({ url: '/u', method: 'POST', data: { x: undefined } }, 'deep', { ignoreValues: [null] });
        const noData = k({ url: '/u', method: 'POST' });
        expect(a).toBe(noData);
    });
});


describe('$key — ignoreKeys + ignoreValues 组合', () => {
    it('两个选项同时生效', () => {
        const opts: KeyOpts = { ignoreKeys: ['ts'], ignoreValues: [null] };
        const a = k({ url: '/u', method: 'POST', data: { ts: undefined, x: null } }, 'deep', opts);
        const b = k({ url: '/u', method: 'POST' });
        expect(a).not.toBe(b);  // ts 由 ignoreKeys 保留、x 由 ignoreValues 保留
    });

    it('对象形式 key 默认走 deep + 透传 opts', () => {
        // 通过 $parse 验证整条链路
        const r1 = $parse({
            key: { ignoreKeys: ['ts'] },
            url: '/u', method: 'POST',
            data: { x: 1, ts: null },
        } as IHttpOptions);
        const r2 = $parse({
            key: { ignoreKeys: ['ts'] },
            url: '/u', method: 'POST',
            data: { x: 1 },
        } as IHttpOptions);
        console.log(`  [${r1}] with ts:null preserved`);
        console.log(`  [${r2}] without ts`);
        expect(r1).not.toBe(r2);
    });
});


describe('$parse — 插件级 defaults 与请求级合并', () => {
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

    it('插件级 fastMode:false 让 key:true 走 deep', () => {
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

    it('插件级 ignoreKeys 在 key:true + fastMode:false 时生效', () => {
        const defaults = { fastMode: false, ignoreKeys: ['ts'] };
        const r1 = $parse({ ...reqWithTs }, defaults);
        const r2 = $parse({ ...reqNoTs }, defaults);
        // ts 被插件级 ignoreKeys 强制保留 → r1 ≠ r2
        expect(r1).not.toBe(r2);
        console.log(`  [${r1}] plugin ignoreKeys:['ts'] preserves ts:null`);
    });

    it('插件级 ignoreValues 在 key:"deep" 时生效', () => {
        const defaults = { ignoreValues: [null] };
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
        console.log(`  [${r1}] plugin ignoreValues:[null] preserves y:null`);
    });

    it('请求级对象优先于插件级', () => {
        const defaults = { fastMode: false, ignoreKeys: ['plugin-key'] };
        // 请求级 ignoreKeys:['req-key'] 应当完全覆盖插件级（不合并）
        const r = $parse({
            key: { ignoreKeys: ['req-key'] },
            url: '/u', method: 'POST',
            data: { x: 1, 'req-key': null, 'plugin-key': null },
        } as IHttpOptions, defaults);
        // req-key 被保留、plugin-key 被过滤 → 与"只有 req-key 保留"等价
        const expected = $parse({
            key: { ignoreKeys: ['req-key'] },
            url: '/u', method: 'POST',
            data: { x: 1, 'req-key': null },
        } as IHttpOptions);
        expect(r).toBe(expected);
        console.log(`  [${r}] req ignoreKeys overrides plugin ignoreKeys`);
    });

    it('请求级未指定的字段回退到插件级', () => {
        // 请求 key:{} 既没 fastMode 也没 ignoreKeys → 全用插件级
        const defaults = { fastMode: false, ignoreKeys: ['ts'] };
        const r1 = $parse({
            key: {},
            url: '/u', method: 'POST',
            data: { x: 1, ts: null },
        } as IHttpOptions, defaults);
        const r2 = $parse({
            key: { fastMode: false, ignoreKeys: ['ts'] },
            url: '/u', method: 'POST',
            data: { x: 1, ts: null },
        } as IHttpOptions);
        expect(r1).toBe(r2);
    });

    it('无 defaults 时行为与之前一致（向后兼容）', () => {
        const r1 = $parse({ ...reqWithTs });
        const r2 = $parse({ ...reqWithTs }, undefined);
        const r3 = $parse({ ...reqWithTs }, {});
        expect(r1).toBe(r2);
        expect(r2).toBe(r3);
    });
});
