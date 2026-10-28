import { assignAxiosDefaults } from "../utils";
import type { CreateAxiosDefaults } from "axios";
import type { IPluginSwitch } from "../options";
import type { AxpResponse, IAxpResponse } from "../response";
import type { AxpPlugin } from "../types";

/** 内置环境插件名称。 */
const NAME = "axp:envs";
/** 顺序匹配的一条环境规则。 */
export interface IEnvRule {
  /** 首个 true 胜出，抛错则中断安装。 */
  rule: () => boolean;
  /** 浅合并到 axios.defaults 的配置。 */
  config: CreateAxiosDefaults;
}
/** 保留数组入口，对象入口提供插件总开关。 */
export interface IEnvOptions extends IPluginSwitch {
  /** 顺序匹配的环境规则。 */ rules?: IEnvRule[];
}
/** 数组写法直接提供规则，对象写法额外提供插件开关。 */
export type IEnvsOptions = IEnvRule[] | IEnvOptions;
/** 安装时浅合并第一个命中的配置，不进链，卸载不还原。
 * @param options 旧数组写法，或包含 rules 和 enable 的对象。
 * @returns 只有 setup 的环境插件。
 * @example `axpEnvs([{ rule: () => true, config: { baseURL: '/api' } }])`
 */
export default function axpEnvs<R extends IAxpResponse = AxpResponse>(options: IEnvsOptions = []): AxpPlugin<R> {
  const config = Array.isArray(options) ? { rules: options } : options;
  const rules = [...(config.rules ?? [])];
  return {
    name: NAME,
    enable: config.enable,
    /** 匹配后不再求值后续规则。 */
    setup(client) {
      const entry = rules.find(/** 只采用第一个命中的环境。 */ (candidate) => candidate.rule());
      if (entry) assignAxiosDefaults(client.axios.defaults, entry.config);
    },
  };
}
