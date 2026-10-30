/** 跨入口共享的响应品牌，叶子模块可由 Node 原生加载。 */
export const AXP_RESPONSE = Symbol.for("axp.response");

/** 跨入口共享的内核失败事实标记。 */
export const AXP_FAILURE = Symbol.for("axp.failure");

/** 内核失败事实的固定类别。
 * @example `failureOf(response)?.type === AXP_FAILURES.NETWORK`
 */
export const AXP_FAILURES = {
  /** 连接失败、响应断流等非取消、超时、解析错误的 AxiosError。 */
  NETWORK: "network",
  /** AxiosError 为 ETIMEDOUT，或 ECONNABORTED 且消息指示超时。 */
  TIMEOUT: "timeout",
  /** axios 取消或名称为 AbortError 的用户取消异常。 */
  CANCEL: "cancel",
  /** JSON 解析失败、maxContentLength 超限，或 expectJson 检出 JSON/HTML 非空未解析文本。 */
  PARSE: "parse",
  /** 凭证插件主动构造的鉴权失败，传输不自动推断。 */
  AUTH: "auth",
  /** 非 AxiosError 的程序异常，或内核捕获的用户回调异常。 */
  INTERNAL: "internal",
} as const;
