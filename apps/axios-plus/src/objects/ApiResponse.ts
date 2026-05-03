/**
 * normalize 插件在合成失败响应时使用的特殊 code 常量。
 * 暴露出去，方便 notification / retry / rethrow / 业务 caller 用 `===` 精确比对。
 */
export const ERR_CODES = {
  /** HTTP 4xx/5xx 但服务端没有给 envelope 数据时，normalize 用这个占位 */
  HTTP: "HTTP_ERR",
  /** 网络错误（断网 / DNS / 拒连），无 HTTP 响应 */
  NETWORK: "NETWORK_ERR",
  /** axios timeout（ETIMEDOUT / ECONNABORTED） */
  TIMEOUT: "TIMEOUT_ERR",
  /** 用户主动 cancel（AbortController.abort 或 cancelToken） */
  CANCEL: "CANCEL",
} as const;

/**
 * 归一化响应封装 —— 全链路统一形态。
 *
 * 整个插件链下游（notification / retry / rethrow / 业务 caller）都看到这一种结构，
 * 不需要再对 `AxiosError` / `AxiosResponse` / `CanceledError` 等多种形态做区分。
 *
 *   - `status`：HTTP 状态码（0 表示无 HTTP 响应：网络错误 / 超时 / cancel）
 *   - `code`：业务码（成功一般 `'0000'`；失败可能是后端业务码 / `HTTP_ERR` / `NETWORK_ERR` / `TIMEOUT_ERR` / `CANCEL`）
 *   - `message`：人类可读的错误消息
 *   - `data`：成功时是业务数据；失败时一般是 `null`
 *   - `success`：等价于 "可视为成功响应"，由 `normalize` 在构造时根据用户配置算好
 *
 * 通过 `code` + `status` 已经能区分以下所有场景：
 *
 *   | 场景 | status | code (默认) | success |
 *   |---|---|---|---|
 *   | HTTP 2xx + biz '0000' | 200 | '0000' | true |
 *   | HTTP 2xx + biz 失败    | 200 | 'BIZ_ERR' / 业务码 | false |
 *   | HTTP 4xx/5xx (有 envelope) | 4xx/5xx | 业务码 / 'HTTP_ERR' | false |
 *   | HTTP 4xx/5xx (无 envelope) | 4xx/5xx | 'HTTP_ERR' | false |
 *   | 网络错误（断网 / DNS） | 0 | 'NETWORK_ERR' | false |
 *   | 请求超时               | 0 | 'TIMEOUT_ERR' | false |
 *   | 用户取消（AbortController） | 0 | 'CANCEL' | false |
 */
export default class ApiResponse<T extends any = any> {
  static ERR_CODES = ERR_CODES;
  /** 默认的 http 状态码 */
  static DEFALUT_STATUS = 0;
  /** 默认的 "成功业务码" */
  static DEFALUT_ERR_CODE = 0;
  /** 默认的 "成功业务码" */
  static DEFAULT_SUCCESS_CODE: string | number = 200;
  /**http状态码 */
  declare status: number;
  /** 业务状态码 */
  declare code: number | string;
  /**
   *   消息文本
   * - 对于异常http请求，它是http错误文本；
   * - 对于业务错误，它是业务错误文本；
   * - 对于业务成功，它是成功文本。
   * - 注意：具体取决于业务后台如何返回。
   * */
  declare message: string | null;
  /** 业务数据 */
  declare data: T | null;
  /** 成功状态 */
  declare success: boolean;

  constructor(
    status: number = ApiResponse.DEFALUT_STATUS,
    code: number | string = ApiResponse.DEFALUT_ERR_CODE,
    data?: T,
    message?: string | null,
    success?: boolean,
  ) {
    this.status = status;
    this.code = code;
    this.message = message ?? null;
    // 注意：用 `??` 而不是 `||` —— 后者会把 0 / false / '' 都误转 null，丢失业务真实值
    this.data = data ?? null;
    this.success =
      success ??
      (status >= 200 &&
        status < 300 &&
        code === ApiResponse.DEFAULT_SUCCESS_CODE);
  }

  /** 旧路径保留 —— 为了向后兼容 normalize 之外的 ad-hoc 用法 */
  static fromResponse(response: any): ApiResponse {
    const { status, data: { code, message, data } = {} } = response;
    return new ApiResponse(status, code, message, data);
  }
}
