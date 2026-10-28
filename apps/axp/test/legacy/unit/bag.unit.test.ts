import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { setInternal, getInternal, delInternal } from '../../../src/bag';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bag — 私有数据生命周期', () => {
    it('[bag.getInternal][bag.setInternal][bag.delInternal] 读删不存在的 bag 不创建任何属性', () => {
        const config = {};
        expect(getInternal(config, 'x')).toBeUndefined();
        delInternal(config, 'x');
        expect(Reflect.ownKeys(config)).toEqual([]);
    });
    it('[bag.getInternal][bag.setInternal][bag.delInternal] 覆写与删除只影响对应 config，枚举、展开与 axios 合并均不可见', () => {
        const a = { url: '/a' };
        const b = { url: '/b' };
        setInternal(a, 'x', 1);
        setInternal(a, 'y', 2);
        setInternal(a, 'x', 3);
        expect(getInternal(a, 'x')).toBe(3);
        expect(getInternal(b, 'x')).toBeUndefined();
        expect(Object.keys(a)).toEqual(['url']);
        expect(JSON.stringify(a)).toBe('{"url":"/a"}');
        expect(getInternal({ ...a }, 'x')).toBeUndefined();
        expect(getInternal(axios.mergeConfig({}, a), 'x')).toBeUndefined();
        delInternal(a, 'x');
        expect(getInternal(a, 'x')).toBeUndefined();
        expect(getInternal(a, 'y')).toBe(2);
    });
});
