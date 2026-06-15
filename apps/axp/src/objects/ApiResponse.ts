export default class ApiResponse<T extends any = any> {
  declare status: number;
  declare code: number | string;
  declare message: string | null;
  declare data: T | null;
  declare successful: boolean;

  constructor(status: number = 0, code: number | string = 0, message: string | null = null, data: T | null = null) {
    this.status = status;
    this.code = code;
    this.message = message;
    this.data = data;
    this.successful = ApiResponse.isSuccessful(status, code);
  }

  /**
   * 成功判定钩子（可整体覆盖）。默认约定：
   *   - HTTP 2xx 且业务 code 为 `'0000'`/`0` → 成功
   *   - 无业务 code（非信封式接口，code 为 null/undefined）→ 退化为纯 HTTP 语义
   * 接入方若使用不同的成功码，赋值 `ApiResponse.isSuccessful = (status, code) => ...` 即可。
   */
  static isSuccessful(status: number, code: number | string | null | undefined): boolean {
    const httpOk = status >= 200 && status < 300;
    if (code === null || code === undefined) return httpOk;
    return httpOk && (code === "0000" || code === 0);
  }

  /**
   * 从 axios 响应安全地构造 ApiResponse。
   * 对 `data` 为 `null`/非对象/缺失的情况做防御 —— 旧实现 `data: { code } = {}`
   * 的默认值只在 `undefined` 时生效，遇到 `null`(204/网络错误占位) 会解构抛错。
   */
  static fromResponse(response: any): ApiResponse {
    const status: number = response?.status ?? 0;
    const body = response?.data;
    const envelope = body && typeof body === "object" ? body : {};
    return new ApiResponse(status, envelope.code, envelope.message ?? null, envelope.data ?? null);
  }
}

/**
 * 携带 `ApiResponse` 的业务错误。`normalize-response` 在业务判定失败时 reject 此对象，
 * 下游 `catch (e)` 可用 `e instanceof ApiError` 判别，并经 `e.response` 拿到结构化信息
 * —— 相比旧版直接 `reject(response)`(非 Error、无 stack、无法 instanceof) 更可控。
 */
export class ApiError<T = any> extends Error {
  declare readonly response: ApiResponse<T>;

  constructor(response: ApiResponse<T>) {
    super(response.message ?? `request failed (status=${response.status}, code=${response.code})`);
    this.name = "ApiError";
    this.response = response;
  }
}
