import { describe, it, expect } from 'vitest';
import { $parse } from '../src/plugins/key';

// Review 修复：#16 特殊类型 / #1 scope

describe('$parse deep — #16 Date / URLSearchParams / 不可序列化类型', () => {
    const k = (data: any) => $parse({ method: 'post', url: '/x', key: 'deep', data } as any);

    it('不同 Date → 不同 key；相同 Date → 同 key', () => {
        expect(k({ d: new Date('2020-01-01') })).not.toBe(k({ d: new Date('2021-01-01') }));
        expect(k({ d: new Date('2020-01-01') })).toBe(k({ d: new Date('2020-01-01') }));
    });
    it('顶层 Date 也区分', () => {
        expect(k(new Date(1))).not.toBe(k(new Date(2)));
    });
    it('URLSearchParams 按内容区分', () => {
        expect(k(new URLSearchParams('a=1'))).not.toBe(k(new URLSearchParams('a=2')));
        expect(k(new URLSearchParams('a=1'))).toBe(k(new URLSearchParams('a=1')));
    });
    it('FormData / Blob / Map / Set 等不可序列化 → 返回 null（宁可不命中）', () => {
        expect(k(new FormData())).toBeNull();
        expect(k({ f: new Blob(['x']) })).toBeNull();
        expect(k({ m: new Map([[1, 2]]) })).toBeNull();
        expect(k({ s: new Set([1]) })).toBeNull();
    });
    it('被 ignores 命中的字段不影响（即便是 Blob）', () => {
        const a = $parse({ url: '/x', key: { ignores: ['file'] }, data: { file: new Blob(['a']), n: 1 } } as any);
        expect(a).not.toBeNull();
    });
});

describe('$parse — #1 scope 并入 key', () => {
    it('scope 不同 → key 不同；相同 → 相同', () => {
        const cfg = { method: 'get', url: '/x', key: true } as any;
        const a = $parse(cfg, { scope: () => 'u1' });
        const b = $parse(cfg, { scope: () => 'u2' });
        expect(a).not.toBe(b);
        expect(a).toBe($parse(cfg, { scope: () => 'u1' }));
    });
    it('scope 对字符串 / 函数 key 也生效；返回空值则不并入', () => {
        expect($parse({ key: 'abc' } as any, { scope: () => 7 })).not.toBe('abc');
        expect($parse({ key: 'abc' } as any, { scope: () => undefined })).toBe('abc');
        expect($parse({ key: () => 'f' } as any, { scope: () => 's' })).not.toBe('f');
    });
    it('请求级 key 对象的 scope 优先于插件级', () => {
        const a = $parse({ url: '/x', key: { scope: 'req' } } as any, { scope: () => 'plug' });
        const b = $parse({ url: '/x', key: { scope: 'req2' } } as any, { scope: () => 'plug' });
        expect(a).not.toBe(b);
    });
});
