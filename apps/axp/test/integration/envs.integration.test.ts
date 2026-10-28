import { AxiosHeaders } from "axios";
import { expect, it, vi } from "vitest";
import axpEnvs from "../../src/plugins/envs";
import { wireClient } from "../helpers/wire";

/** 继承插件写入的默认环境地址。 */
const ENV_URL = "/api";
/** 显式指定的子环境地址。 */
const CHILD_URL = "/other";
/** 规则模板中保存的父环境凭证。 */
const PARENT_AUTH = "parent-token";
/** 子环境的显式凭证。 */
const CHILD_AUTH = "child-token";
/** 父环境租户。 */
const PARENT_TENANT = "tenant-a";
/** 子环境租户。 */
const CHILD_TENANT = "tenant-b";
/** 原样传递数据的转换器，用来检查转换器数组是否被复制。 */
function transform(data: unknown): unknown {
  return data;
}

it("[envs.method.setup][core.method.extend] 继承 envs.setup 完成后显式 overrides 最后生效且容器独立", /** setup 不得覆盖明确指定的子环境。 */ () => {
  const overrides = {
    /** 显式覆盖继承插件的地址。 */ baseURL: CHILD_URL,
    /** 使用公开头容器表达方法分组。 */ headers: {
      common: new AxiosHeaders({ Authorization: CHILD_AUTH }),
    },
    /** 子环境租户。 */ params: { tenant: CHILD_TENANT },
  };
  const plugin = axpEnvs([
    {
      /** 固定命中默认环境。 */ rule: () => true,
      /** 插件安装时写入的父环境。 */ config: {
        baseURL: ENV_URL,
        headers: { common: { Authorization: PARENT_AUTH } },
        params: { tenant: PARENT_TENANT },
      },
    },
  ]);
  const setup = vi.spyOn(plugin, "setup");
  const h = wireClient({}, [plugin]);
  const child = h.api.extend(overrides);
  expect(setup).toHaveBeenCalledTimes(2);
  expect(child.axios.defaults.baseURL).toBe(CHILD_URL);
  expect(h.axios.defaults.baseURL).toBe(ENV_URL);
  expect(child.axios.defaults.params.tenant).toBe(CHILD_TENANT);
  child.axios.defaults.headers.common.Authorization = "changed child";
  child.axios.defaults.params.tenant = "changed tenant";
  expect(overrides.headers.common.Authorization).toBe(CHILD_AUTH);
  expect(overrides.params.tenant).toBe(CHILD_TENANT);
  expect(h.axios.defaults.headers.common.Authorization).toBe(PARENT_AUTH);
  child.dispose();
  h.api.dispose();
});

it("[envs.method.setup][envs.opt.config] 父子及规则模板的 headers、嵌套 params、转换器和 transitional 互不污染", /** setup 写入的配置不是规则模板引用。 */ () => {
  const config = {
    /** 父环境凭证。 */ headers: { common: { Authorization: PARENT_AUTH } },
    /** 含嵌套对象及数组的查询参数。 */ params: {
      scope: { tenant: PARENT_TENANT },
      values: [{ tenant: PARENT_TENANT }],
    },
    /** 可变的转换器数组。 */ transformRequest: [transform],
    /** 可变的 axios 兼容配置。 */ transitional: { clarifyTimeoutError: false },
  };
  const plugin = axpEnvs([{ rule: /** 固定匹配环境规则。 */ () => true, config }]);
  const h = wireClient({}, [plugin]);
  const child = h.api.extend();
  child.axios.defaults.headers.common.Authorization = CHILD_AUTH;
  child.axios.defaults.params.scope.tenant = CHILD_TENANT;
  child.axios.defaults.params.values[0].tenant = CHILD_TENANT;
  child.axios.defaults.params.values.push({ tenant: CHILD_TENANT });
  (child.axios.defaults.transformRequest as unknown[]).push(transform);
  child.axios.defaults.transitional!.clarifyTimeoutError = true;
  expect(h.axios.defaults.headers.common.Authorization).toBe(PARENT_AUTH);
  expect(config.headers.common.Authorization).toBe(PARENT_AUTH);
  expect(h.axios.defaults.params).toEqual(config.params);
  expect(config.params.values).toEqual([{ tenant: PARENT_TENANT }]);
  expect(h.axios.defaults.params.scope.tenant).toBe(PARENT_TENANT);
  expect(h.axios.defaults.transformRequest).toEqual([transform]);
  expect(config.transformRequest).toEqual([transform]);
  expect(h.axios.defaults.transitional!.clarifyTimeoutError).toBe(false);
  expect(config.transitional.clarifyTimeoutError).toBe(false);
  child.dispose();
  h.api.dispose();
});
