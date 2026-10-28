import { create as createAxios } from "axios";
import { expect, it } from "vitest";
import axpEnvs from "../../src/plugins/envs";
import { createTestClient } from "../helpers/client";

/** 安装前的服务地址。 */
const ORIGINAL_BASE_URL = "/original";

it.each([{}, { timeout: 0 }, { responseType: "text" as const }])(
  "[envs.opt.config] 无 baseURL、空配置和零值精确保留，卸载不还原 %j",
  /** 原有字段只被显式值覆盖。 */ (config) => {
    const { api } = createTestClient([axpEnvs({ rules: [{ rule: /** 命中本配置。 */ () => true, config }] })]);
    for (const [key, value] of Object.entries(config)) expect((api.axios.defaults as Record<string, unknown>)[key]).toBe(value);
    api.eject("axp:envs");
    api.dispose();
    for (const [key, value] of Object.entries(config)) expect((api.axios.defaults as Record<string, unknown>)[key]).toBe(value);
  },
);
it("[envs.cb.error] rule 抛错时原样中断 setup，不写入 defaults", /** 安装错误不能应用未命中配置。 */ () => {
  const axios = createAxios({ baseURL: ORIGINAL_BASE_URL });
  const bug = new Error("env rule");
  expect(
    /** 构造时中断安装。 */ () =>
      createTestClient(
        [
          axpEnvs([
            { rule: /** 前置规则未命中。 */ () => false, config: { baseURL: "/skip" } },
            {
              rule: /** 判定故障。 */ () => {
                throw bug;
              },
              config: { baseURL: "/wrong" },
            },
          ]),
        ],
        { axios },
      ),
  ).toThrow(bug);
  expect(axios.defaults.baseURL).toBe(ORIGINAL_BASE_URL);
});
it("[envs.opt.empty] 省略、空数组和无规则对象均不修改 defaults", /** 兼容数组入口与总开关对象入口。 */ () => {
  for (const plugin of [axpEnvs(), axpEnvs([]), axpEnvs({})]) {
    const { api } = createTestClient([plugin]);
    expect(api.inspect()).toEqual([]);
    expect(api.axios.defaults.baseURL).toBeUndefined();
    api.dispose();
  }
});
