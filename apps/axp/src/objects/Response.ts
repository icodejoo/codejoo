/**
 * 归一化后的接口响应对象，把 axios 原始响应统一整理成规整结构并附带成功/失败判定。
 *
 * A normalized API response object, reshaping axios's raw response into one predictable structure with a computed success/failure verdict.
 */
export default class AxpResponse<T extends any = any> {
  /** HTTP 状态码 / the HTTP status code. */
  declare status: number;
  /** 业务信封中的 code；无信封时保持构造时的默认值 / the business code; keeps the constructor default when there's no envelope. */
  declare code: number | string;
  /** 业务信封中的 message，缺失为 null / the business message, null when absent. */
  declare message: string | null;
  /** 业务信封中的 data 载荷，缺失为 null / the business data payload, null when absent. */
  declare data: T | null;
  /** 由 isSuccessful(status, code) 在构造时算出的判定结果 / the verdict computed at construction via isSuccessful(status, code). */
  declare successful: boolean;

  /**
   * 构造一个 AxpResponse；successful 在构造时依据 status/code 立即算好。
   *
   * Constructs an AxpResponse; `successful` is computed immediately from status/code.
   *
   * @param status HTTP 状态码，默认 0 / defaults to 0
   * @param code 业务 code，默认 0 / defaults to 0
   * @param message 业务 message，默认 null / defaults to null
   * @param data 业务 data 载荷，默认 null / defaults to null
   */
  constructor(status: number = 0, code: number | string = 0, message: string | null = null, data: T | null = null) {
    this.status = status;
    this.code = code;
    this.message = message;
    this.data = data;
    this.successful = AxpResponse.isSuccessful(status, code);
  }

  /**
   * 成功判定钩子（可整体覆盖）。默认约定：
   *   - HTTP 2xx 且业务 code 为 `'0000'`/`0` → 成功
   *   - 无业务 code（非信封式接口，code 为 null/undefined）→ 退化为纯 HTTP 语义
   * 接入方若使用不同的成功码，赋值 `ApiResponse.isSuccessful = (status, code) => ...` 即可。
   *
   * Success-verdict hook (can be overridden wholesale). Default convention:
   *   - HTTP 2xx and business code `'0000'`/`0` → success
   *   - No business code (non-envelope API) → falls back to plain HTTP semantics
   * Consumers with a different success code can assign `ApiResponse.isSuccessful = (status, code) => ...`.
   *
   * @param status HTTP 状态码 / the HTTP status code
   * @param code 业务 code，可能为 null/undefined / the business code; may be null/undefined
   * @returns 是否判定为成功 / whether the response is deemed successful
   */
  static isSuccessful(status: number, code: number | string | null | undefined): boolean {
    const httpOk = status >= 200 && status < 300;
    if (code === null || code === undefined) return httpOk;
    return httpOk && (code === "0000" || code === 0);
  }

  /**
   * 从 axios 响应安全地构造 ApiResponse；对 data 为 null/非对象/缺失做防御 —— 旧实现
   * `data: { code } = {}` 的默认值只在 undefined 时生效，遇到 null（204/网络错误占位）会解构抛错。
   *
   * Safely constructs an ApiResponse from an axios response; guards against `data`
   * being null/non-object/missing — the old `data: { code } = {}` default only
   * covered `undefined` and threw on `null` (a 204/network-error placeholder).
   *
   * @param response 原始 axios 响应对象（或相似形状的对象） / the raw axios response (or similarly shaped object)
   * @returns 归一化后的 AxpResponse 实例 / the normalized AxpResponse instance
   */
  static fromResponse(response: any): AxpResponse {
    const status: number = response?.status ?? 0;
    const body = response?.data;
    const envelope = body && typeof body === "object" ? body : {};
    return new AxpResponse(status, envelope.code, envelope.message ?? null, envelope.data ?? null);
  }
}

/**
 * 携带 `ApiResponse` 的业务错误。`normalize` 在业务判定失败时 reject 此对象，下游
 * `catch (e)` 可用 `e instanceof ApiError` 判别，并经 `e.response` 拿到结构化信息 ——
 * 相比旧版直接 `reject(response)`（非 Error、无 stack、无法 instanceof）更可控。
 *
 * A business error carrying an ApiResponse. `normalize` rejects with this when
 * the business verdict fails; `catch (e)` can discriminate via `instanceof
 * ApiError` and reach structured info via `e.response` — more controllable
 * than the old `reject(response)` (not an Error, no stack, no instanceof).
 */
export class AxpError<T = any> extends Error {
  /** 触发本次错误的结构化响应对象 / the structured response that triggered this error. */
  declare readonly response: AxpResponse<T>;

  /**
   * 用一个已归一化的 AxpResponse 构造 ApiError；message 优先取响应自带的 message，
   * 否则回退为包含 status/code 的默认文案。
   *
   * Constructs an ApiError from a normalized AxpResponse; `message` prefers the
   * response's own message, else falls back to a default text with status/code.
   *
   * @param response 归一化后的响应对象 / the normalized response object
   */
  constructor(response: AxpResponse<T>) {
    super(response.message ?? `request failed (status=${response.status}, code=${response.code})`);
    this.name = "ApiError";
    this.response = response;
  }
}
