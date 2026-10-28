import type { AxpResponse } from "../../src/response";
import { create as createAxios } from "axios";
import { expect, it, vi } from "vitest";
import axpEnvs from "../../src/plugins/envs";
import { createTestClient } from "../helpers/client";

/** 首个命中的服务地址。 */
const SELECTED_BASE_URL = "/selected";
/** 内置环境插件名。 */
const NAME = "axp:envs";

it("[envs.opt.rules][envs.prop.name] 第一个命中配置浅合并，不再读取后续规则，不进链", /** 环境选择只发生在 setup。 */ () => {
  const axios = createAxios({ baseURL: "/original", timeout: 10 });
  const later = vi.fn(/** 不应读取的后续规则。 */ () => true);
  const headers = { common: { "X-Env": "test" } };
  const plugin = axpEnvs<AxpResponse>([
    { rule: /** 跳过第一条。 */ () => false, config: { timeout: 100 } },
    { rule: /** 首个命中。 */ () => true, config: { baseURL: SELECTED_BASE_URL, headers } },
    { rule: later, config: { baseURL: "/later" } },
  ]);
  const { api } = createTestClient<AxpResponse>([plugin], { axios });
  expect(plugin.name).toBe(NAME);
  expect(axios.defaults.baseURL).toBe(SELECTED_BASE_URL);
  expect(axios.defaults.timeout).toBe(10);
  expect(axios.defaults.headers).toEqual(headers);
  expect(axios.defaults.headers).not.toBe(headers);
  expect(later).not.toHaveBeenCalled();
  expect(api.inspect()).toEqual([]);
  expect(api.eject(plugin.name)).toBe(true);
  expect(axios.defaults.baseURL).toBe(SELECTED_BASE_URL);
  api.use(plugin);
  api.dispose();
  expect(axios.defaults.headers).toEqual(headers);
  expect(axios.defaults.headers).not.toBe(headers);
});
it("[envs.opt.enable][envs.cb.noMatch] 插件关闭不求值，未命中不修改 defaults", /** 总开关和未匹配。 */ () => {
  const rule = vi.fn(/** 不应求值的规则。 */ () => true);
  const { api } = createTestClient<AxpResponse>([axpEnvs<AxpResponse>({ enable: false, rules: [{ rule, config: { baseURL: "/disabled" } }] })]);
  expect(rule).not.toHaveBeenCalled();
  api.eject(NAME);
  api.use(axpEnvs<AxpResponse>([{ rule: /** 不匹配。 */ () => false, config: { baseURL: "/unused" } }]));
  expect(api.axios.defaults.baseURL).toBeUndefined();
  api.dispose();
});
