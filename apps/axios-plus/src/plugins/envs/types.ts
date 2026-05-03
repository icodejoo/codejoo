import type { CreateAxiosDefaults } from "axios";
import { MaybeFunc } from "../../helper";

type TRule = MaybeFunc<string | number | symbol, any>;

export interface IEnvRule<T = TRule> {
  /**
   * env 标识符或匹配函数：
   *   - **字面量**（`string` / `number` / `symbol`）⇒ 请求级 `config.env` 命中此值时启用，
   *     该规则的 `config` 浅合并到请求 config
   *   - **函数**（`() => boolean`）⇒ install 时求值；返回 `true` 的第一条把其 `config`
   *     浅合并到 `axios.defaults`（用于 dev/prod 环境探测式默认）
   */
  rule: T;
  /** 该规则对应的 axios 配置 */
  config: CreateAxiosDefaults;
}

export interface IEnvsOptions {
  /** 插件级总开关；**必传** */
  enable: boolean;
  /** env 默认规则 */
  default: TRule;
  /** env 规则列表 */
  rules: IEnvRule[];
}
