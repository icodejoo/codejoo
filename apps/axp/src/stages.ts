/** 按名字定位内置插件的固定阶段与阶段内次序。 */
export const STAGE_BUILTINS = {
  /** 用户可见的显示与通知层。 */
  outer: ["axp:loading", "axp:notify"],
  /** 每个逻辑请求只准备一次的请求层。 */
  prepare: ["axp:repath", "axp:filter"],
  /** 每次尝试的重试层。 */
  attempt: ["axp:retry"],
  /** 为每次尝试提供凭证的层。 */
  credential: ["axp:auth"],
  /** 可短路实际网络的数据源层。 */
  source: ["axp:mock", "axp:share", "axp:cache"],
} as const;
