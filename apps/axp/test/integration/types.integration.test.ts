import { describe, expect, expectTypeOf, it } from 'vitest';
import { Axp, type IHttpOptions, type IMethodOptions } from '../../src';
import type { AxiosRequestConfig } from 'axios';
import { readFileSync } from 'node:fs';

/** 类型回归使用的生成路径。 */
const PETS_BY_STATUS = '/pet/findByStatus';
/** 无请求参数的生成路径。 */
const INVENTORY = '/store/inventory';
/** 带路径参数的生成路径。 */
const PET_BY_ID = '/pet/{petId}';
/** loading 类型回归路径。 */
const LOADING = '/loading';
/** 模板新增的 POST 路径。 */
const PET_DRAFT = '/pet/draft';

/** 仅供编译器检查真实生成接口；不发送网络请求。 */
function checkGeneratedSchema() {
  const api = Axp.create<model.MethodRefs>();
  const pets = api.get(PETS_BY_STATUS)({ status: 'available' });
  expectTypeOf(pets).toEqualTypeOf<Promise<model.Pet[]>>();
  expectTypeOf(api.get(INVENTORY)()).toEqualTypeOf<Promise<Record<string, number>>>();
  expectTypeOf(api.get(PET_BY_ID)({ petId: 1 }, { wrap: true })).toEqualTypeOf<Promise<import('../../src').AxpResponse<model.Pet>>>();
  expectTypeOf(api.get(PET_BY_ID)({ petId: 1 }, { raw: true })).toEqualTypeOf<Promise<{
    /** 业务状态。 */
    code: number | string;
    /** 宠物数据。 */
    data: model.Pet;
    /** 业务消息。 */
    message?: string;
  }>>();
  // @ts-expect-error 不存在的路径必须报错。
  api.get('/not-real');
  // @ts-expect-error 方法不支持该路径。
  api.post(INVENTORY);
  // @ts-expect-error 状态必须为生成的枚举字符串。
  api.get(PETS_BY_STATUS)({ status: 1 });
  // @ts-expect-error 缺少必填参数。
  api.get(PET_BY_ID)();
  // @ts-expect-error petId 类型错误。
  api.get(PET_BY_ID)({ petId: '1' });
  // @ts-expect-error 无请求体接口不能传入数据。
  api.get(INVENTORY)({ extra: true });
  const loose = Axp.create();
  expectTypeOf(loose.get('/anything')()).toEqualTypeOf<Promise<unknown>>();
}

/** 检查 Core 两层选项均保留 axios 的完整 loading 增强。 */
function checkLoadingOptions() {
  const api = Axp.create();
  api.get(LOADING, { loading: { delay: 10 } })(undefined, {
    loading: (visible) => { expectTypeOf(visible).toEqualTypeOf<boolean>(); },
  });
  api.get(LOADING, { loading: () => {} })(undefined, {
    loading: { delay: 10, delayClose: 20, enable: true, loading: () => {} },
  });
  expectTypeOf<IMethodOptions['loading']>().toEqualTypeOf<AxiosRequestConfig['loading']>();
  expectTypeOf<IHttpOptions['loading']>().toEqualTypeOf<AxiosRequestConfig['loading']>();
  // @ts-expect-error delay 必须是数字。
  api.get(LOADING, { loading: { delay: '10' } });
}

/** 验证按模板复制的本地 schema 同时推断新增接口和原有生成接口。 */
function checkLocalSchema() {
  const api = Axp.create<model.LocalMethodRefs>();
  const draft: model.req.AddPet = { name: 'draft', photoUrls: [] };
  expectTypeOf(api.post(PET_DRAFT)(draft)).toEqualTypeOf<Promise<model.Pet>>();
  expectTypeOf(api.get('/experimental/whatever')()).toEqualTypeOf<Promise<unknown>>();
  expectTypeOf(api.get(PET_BY_ID)({ petId: 1 })).toEqualTypeOf<Promise<model.Pet>>();
  // @ts-expect-error 新路径也要求正确请求参数。
  api.post(PET_DRAFT)({ name: 1 });
  // @ts-expect-error 本地扩展不允许不存在的路径。
  api.get('/local-not-real');
}

describe('Core 类型契约', () => {
  it('[public.fn.Axp.create] 类型回归用例由 tsgo 检查且不会发出网络请求', () => {
    for (const check of [checkGeneratedSchema, checkLoadingOptions, checkLocalSchema]) {
      expect(check).toBeTypeOf('function');
    }
  });
  it('[public.fn.Axp.create] 本地类型测试使用与模板完全一致的声明', () => {
    const template = readFileSync(new URL('../../types/local/example.d.ts.template', import.meta.url), 'utf8');
    const fixture = readFileSync(new URL('../helpers/local-schema.d.ts', import.meta.url), 'utf8');
    expect(fixture).toBe(template);
  });
});
