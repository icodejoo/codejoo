/** 跨入口共享的响应品牌，叶子模块可由 Node 原生加载。 */
export const AXP_RESPONSE = Symbol.for("axp.response");

/** 归一化响应的固定类别。 */
export const AXP_KINDS = {
  /** HTTP 为 2xx 且业务成功判定通过。 */
  OK: "ok",
  /** 收到响应但 HTTP 状态不在 2xx。 */
  HTTP: "http",
  /** HTTP 为 2xx，但业务成功判定未通过。 */
  BIZ: "biz",
  /** 非取消、超时、解析错误的其它 AxiosError。 */
  NETWORK: "network",
  /** AxiosError 为 ETIMEDOUT，或 ECONNABORTED 且消息指示超时。 */
  TIMEOUT: "timeout",
  /** axios 取消或名称为 AbortError 的用户取消异常。 */
  CANCEL: "cancel",
  /** ERR_BAD_RESPONSE，或 expectJson 检出 JSON/HTML 非空未解析文本。 */
  PARSE: "parse",
  /** 凭证插件主动构造的鉴权失败，传输不自动推断。 */
  AUTH: "auth",
  /** 非 AxiosError 的程序异常，或内核捕获的用户回调异常。 */
  INTERNAL: "internal",
} as const;
