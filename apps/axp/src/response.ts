import { isAxiosError, type AxiosResponse } from "axios";
import { AXP_FAILURE, AXP_FAILURES, AXP_RESPONSE } from "./brand";
export { AXP_FAILURE, AXP_FAILURES, AXP_RESPONSE } from "./brand";
import type { AxpContext } from "./context";
import { classifyError } from "./transport";
import type { AxpRequestConfig, TAxpArgs, TAxpDefaultResponse } from "./types";
import { isObject, toText } from "./utils";

/** 无业务消息时的默认值。 */
const EMPTY_MESSAGE = "";
/** expectJson 检查的媒体类型。 */
const JSON_CONTENT_TYPE = /json|html/i;
/** HTTP 成功区间的终点（不含）。 */
const HTTP_SUCCESS_END = 300;
/** 内核记录的六种失败类别。
 * @example `const type: AxpFailureType = 'network'`
 */
export type AxpFailureType = (typeof AXP_FAILURES)[keyof typeof AXP_FAILURES];
/** 响应上的不可枚举失败事实，由内核写入。
 * @example `const failure: IAxpFailure | undefined = failureOf(response)`
 */
export interface IAxpFailure {
  /** 失败类别。 */ readonly type: AxpFailureType;
  /** 细分原因。 */ readonly reason?: string;
}
/** 使用者实现的只读响应契约，C 为业务码类型，只有 data 的缺省值为 null。
 * @example `const response: IAxpResponse<null, string> = { ok: false, status: 200, code: 'DENIED', data: null }`
 */
export interface IAxpResponse<D = unknown, C extends string | number = number> {
  /** 是否成功。 */ readonly ok: boolean;
  /** HTTP 状态码，没有响应时为零。 */ readonly status: number;
  /** 业务码，没有转换结果时为零。 */ readonly code: C;
  /** 业务数据，没有数据时为 null。 */ readonly data: D;
  /** 可选业务消息。 */ readonly message?: string | null;
  /** 原始 axios 响应。 */ readonly raw?: AxiosResponse;
  /** 原始异常，internal 落定时原样抛出。 */ readonly error?: unknown;
}
/** 构造与派生共用的基础字段。 */
interface IAxpResponseFields extends Partial<IAxpResponse<unknown, string | number>> {
  /** 实际请求视图。 */ readonly request?: Readonly<AxpRequestConfig>;
  /** debug 调用点。 */ readonly stack?: string;
  /** 插件或内核指定的失败类别。 */ readonly failure?: AxpFailureType;
  /** 细分原因。 */ readonly reason?: string;
}
/** 非接口字段的扩展数据键，函数不属于构造数据。 */
type TExtraFields<R> = { [K in keyof R as K extends keyof IAxpResponseFields ? never : NonNullable<R[K]> extends (...args: any[]) => any ? never : K]?: R[K] };
/** 构造或派生响应的输入，扩展数据字段全部可选，函数不属于扩展数据。
 * @example `const init: AxpResponseInit<MyResponse> = { from: response, traceId: 'trace' }`
 */
export type AxpResponseInit<R extends IAxpResponse<unknown, string | number> = IAxpResponse> = IAxpResponseFields &
  TExtraFields<R> & {
    /** 未覆盖字段及失败事实的来源。 */ readonly from?: R;
  };

/** 默认响应，通过 parse 和 ok 扩展业务协议。
 * 子类不要用字段初始化器重新声明 status、code、data、message，以免覆盖基类解析结果。
 * @example `class Custom extends AxpResponse { override get ok() { return this.code === 200 } }`
 */
export class AxpResponse<D = unknown, C extends string | number = number> implements IAxpResponse<D, C> {
  /** HTTP 状态码。 */ readonly status: number;
  /** 业务码。 */ readonly code: C;
  /** 业务数据，无数据为 null。 */ readonly data: D;
  /** 业务消息，默认空串。 */ readonly message: string | null;
  /** 当前请求视图。 */ readonly request: Readonly<AxpRequestConfig>;
  /** debug 调用点。 */ readonly stack?: string;
  /** axios 原始响应。 */ readonly raw?: AxiosResponse;
  /** 原始异常。 */ readonly error?: unknown;

  /** 构造响应，仅未显式提供业务字段的原始响应调用 parse。
   * @param init 响应字段或派生来源。
   * @param request 缺省请求视图。
   * @example `new AxpResponse({ status: 200, data: 'ok' })`
   */
  constructor(init: AxpResponseInit<IAxpResponse<unknown, string | number>> = {}, request?: Readonly<AxpRequestConfig>) {
    const fields = resolveInit(init);
    const parsed = fields.raw && !("code" in fields || "data" in fields || "message" in fields) ? this.parse(fields.raw.data, fields.raw) : fields;
    this.status = fields.status ?? fields.raw?.status ?? 0;
    this.code = (parsed.code ?? 0) as C;
    this.data = (parsed.data ?? null) as D;
    this.message = parsed.message === undefined ? EMPTY_MESSAGE : parsed.message;
    this.request = fields.request ?? request ?? {};
    this.stack = fields.stack;
    this.raw = fields.raw;
    this.error = fields.error;
  }
  /** HTTP 2xx 且业务码为数字零或字符串 0000 时成功。 */
  get ok(): boolean {
    return isHttpOk(this.status) && (this.code === 0 || this.code === "0000");
  }
  /** 解析信封，只返回结果，不写实例字段。
   * @param body 原始响应体。
   * @param _raw 原始响应，供子类读取头。
   * @returns 可选业务字段，缺省由基类补齐。
   * @example `protected override parse(body: unknown) { return { data: body as D } }`
   */
  protected parse(body: unknown, _raw: AxiosResponse): { /** 业务码。 */ code?: C; /** 业务数据。 */ data?: D | null; /** 消息。 */ message?: string | null } {
    if (isObject(body) && "code" in body && ("data" in body || "message" in body)) return { code: body.code as C, data: (body.data ?? null) as D | null, message: body.message as string | null | undefined };
    return { code: 0 as C, data: (body ?? null) as D | null, message: EMPTY_MESSAGE };
  }
  /** 序列化字段和失败事实，省略 raw/error，请求仅保留 method/url。
   * @returns 可序列化的业务与诊断字段。
   * @example `JSON.stringify(response)`
   */
  toJSON(): object {
    const { raw: _raw, error: _error, ...fields } = this;
    const failure = failureOf(this);
    return { ...fields, ok: this.ok, ...(failure ? { failure } : {}), request: { method: this.request.method, url: this.request.url } };
  }
}
Object.defineProperty(AxpResponse.prototype, AXP_RESPONSE, { value: true });

/** 每客户端的响应构造入口。 */
export interface IAxpResponseFactory<R extends IAxpResponse<unknown, string | number> = AxpResponse> {
  /** 从收到的 axios 响应构造业务响应。
   * @param res axios 原始响应。
   * @param ctx 当前请求上下文。
   * @returns 使用者定义的响应，成功与否由它的 ok 决定。
   * @example `factory.fromResponse(raw, ctx)`
   */
  fromResponse(res: AxiosResponse, ctx: AxpContext<R>): R;
  /** 构造异常响应，最终分类由内核保护层强制写入。
   * @param error 原始传输异常。
   * @param ctx 当前请求上下文。
   * @returns 失败响应，内核在工厂返回后强制 ok 为 false。
   * @example `factory.fromError(error, ctx)`
   */
  fromError(error: unknown, ctx: AxpContext<R>): R;
  /** 构造或派生响应，失败事实默认继承。
   * @param init 覆盖字段、可选来源与失败类别。
   * @param ctx 当前请求上下文。
   * @returns 独立的响应，不修改 from。
   * @example `factory.fail({ from: response, stack }, ctx)`
   */
  fail(init: AxpResponseInit<R>, ctx: AxpContext<R>): R;
}
/** 默认响应工厂选项。 */
export interface IAxpResponseOptions<R extends IAxpResponse<unknown, string | number>> {
  /** 通过继承默认类解析响应。 */ type?: new (init: AxpResponseInit<R>) => R & AxpResponse<unknown, string | number>;
  /** 接口构造路径，可以返回普通对象。
   * @param init 已合并来源的初始化字段。
   * @param raw 可选 axios 原始响应。
   * @returns 使用者响应，内核补齐缺省业务字段与品牌。
   * @example `create: (init) => new MyResponse(init)`
   */
  create?: (init: AxpResponseInit<R>, raw?: AxiosResponse) => R;
  /** JSON/HTML 的非空未解析文本视为解析失败。 */ expectJson?: boolean;
}
/** 自定义响应必须指定子类或构造回调。 */
type TAxpResponseOptions<R extends IAxpResponse<unknown, string | number>> = IAxpResponseOptions<R> &
  (TAxpDefaultResponse<R> extends true ? unknown : { /** 子类构造器。 */ type: NonNullable<IAxpResponseOptions<R>["type"]> } | { /** 接口构造器。 */ create: NonNullable<IAxpResponseOptions<R>["create"]> });

/** 判断 HTTP 成功区间。 */
function isHttpOk(status: number): boolean {
  return status >= 200 && status < HTTP_SUCCESS_END;
}
/** 扁平化来源，保留扩展字段，显式 undefined 可清除原字段。 */
function resolveInit<R extends IAxpResponse<unknown, string | number>>(init: AxpResponseInit<R>): AxpResponseInit<R> {
  if (!init.from) return init;
  const source = init.from;
  const failure = failureOf(source);
  return { ...source, code: source.code, data: source.data, message: source.message, status: source.status, failure: failure?.type, reason: failure?.reason, ...init };
}
/** 读取内核记录的失败事实。
 * @param response 任意响应或异常。
 * @returns 失败标记，普通收到的响应为 undefined。
 * @example `failureOf(response)?.type === 'network'`
 */
export function failureOf(response: unknown): IAxpFailure | undefined {
  return isObject(response) ? (response as Record<symbol, IAxpFailure | undefined>)[AXP_FAILURE] : undefined;
}
/** 判断是否为内核取消响应。
 * @param error 任意响应或异常。
 * @returns 是否带 cancel 标记。
 * @example `if (isAxpCancel(error)) return`
 */
export function isAxpCancel(error: unknown): boolean {
  return failureOf(error)?.type === AXP_FAILURES.CANCEL;
}
/** 挂不可枚举失败事实并遮住使用者的成功 getter。 */
function markFailure<R extends IAxpResponse<unknown, string | number>>(
  response: R,
  failure: IAxpFailure | undefined,
  init: { /** 原始异常。 */ readonly error?: unknown; /** 派生来源。 */ readonly from?: IAxpResponse<unknown, string | number> },
): R {
  if (failure) {
    // internal 必须抛原始异常，接口实现可以省略 error，内核仍须保留它。
    if (failure.type === AXP_FAILURES.INTERNAL) Object.defineProperty(response, "error", { value: "error" in init ? init.error : init.from?.error, enumerable: true, configurable: true });
    Object.defineProperties(response, { [AXP_FAILURE]: { value: Object.freeze(failure), configurable: true }, ok: { value: false, enumerable: true, configurable: true } });
  }
  return response;
}
/** 检查跨入口共享品牌。
 * @param value 任意被抛出的值。
 * @returns 是否为归一化响应。
 * @example `if (isAxpResponse(error)) console.log(error.status)`
 */
export function isAxpResponse<R extends IAxpResponse<unknown, string | number> = AxpResponse>(value: unknown): value is R {
  return isObject(value) && (value as Record<symbol, unknown>)[AXP_RESPONSE] === true;
}
/** 补齐接口路径的默认值与品牌。 */
function brandResponse<R extends IAxpResponse<unknown, string | number>>(response: R): R {
  if (!isAxpResponse<R>(response)) Object.defineProperty(response, AXP_RESPONSE, { value: true });
  if (response.code === undefined) Object.defineProperty(response, "code", { value: 0, enumerable: true, configurable: true });
  if (response.data === undefined) Object.defineProperty(response, "data", { value: null, enumerable: true, configurable: true });
  if (response.message === undefined) Object.defineProperty(response, "message", { value: EMPTY_MESSAGE, enumerable: true, configurable: true });
  return response;
}
/** 创建响应工厂，支持继承和接口两条路径。
 * @param options 构造器、构造回调和 JSON 守卫。
 * @returns 当前客户端的响应工厂。
 * @example `axpResponse({ type: MyResponse, expectJson: true })`
 */
export function axpResponse<R extends IAxpResponse<unknown, string | number> = AxpResponse>(...[options = {} as TAxpResponseOptions<R>]: TAxpArgs<R, TAxpResponseOptions<R>>): IAxpResponseFactory<R> {
  /** 默认路径避免重复合并和接口保护分支。 */
  function build(init: AxpResponseInit<R>, ctx: AxpContext<R>): R {
    const fields = options.create || options.type ? resolveInit(init) : init;
    let response: R;
    if (options.create) response = brandResponse(options.create(fields.request === undefined ? { ...fields, request: ctx.request } : fields, fields.raw));
    else if (options.type) response = new options.type(fields.request === undefined ? { ...fields, request: ctx.request } : fields);
    else response = new AxpResponse(fields, ctx.request) as unknown as R;
    const inherited = init.from && failureOf(init.from);
    return markFailure(response, init.failure ? { type: init.failure, reason: init.reason } : inherited ? { type: inherited.type, reason: init.reason ?? inherited.reason } : undefined, init);
  }
  return {
    /** 原始响应交给 parse/create，守卫失败在构造后强制标记。 */
    fromResponse(raw, ctx) {
      const init = { raw, status: raw.status, request: raw.config as AxpRequestConfig } as AxpResponseInit<R>;
      if (options.expectJson && isHttpOk(raw.status)) {
        const body = raw.data as unknown;
        if (typeof body === "string" && body.trim() !== "" && JSON_CONTENT_TYPE.test(toText(raw.headers?.["content-type"] ?? "")))
          return build({ ...init, failure: AXP_FAILURES.PARSE, data: body, message: "Invalid JSON response" }, ctx);
      }
      return build(init, ctx);
    },
    /** 默认构造也使用内核分类规则。 */
    fromError(error, ctx) {
      return build(
        {
          failure: classifyError(error),
          error,
          request: isAxiosError(error) ? (error.config as AxpRequestConfig | undefined) : undefined,
          message: error instanceof Error ? error.message : String(error),
        } as AxpResponseInit<R>,
        ctx,
      );
    },
    /** 合成与派生共用构造入口。 */
    fail:
      options.type || options.create ? build : /** 普通缓存快照直接构造，失败和派生才进入标记路径。 */ (init, ctx) => (init.from || init.failure ? build(init, ctx) : (new AxpResponse(init, ctx.request) as unknown as R)),
  };
}
/** 无配置工厂共享。 */
export const DEFAULT_RESPONSE_FACTORY = axpResponse();

/** 保护完整自定义工厂并强制内核分类和继承。
 * @internal
 * @param factory 当前构造服务。
 * @returns 不向管线抛错的构造服务。
 * @example `guardFactory(customResponse())`
 */
export function guardFactory<R extends IAxpResponse<unknown, string | number>>(factory: IAxpResponseFactory<R>): IAxpResponseFactory<R> {
  const directFail = (factory as unknown) === DEFAULT_RESPONSE_FACTORY;
  /** 工厂失败时用默认实现保留原始程序异常。 */
  function recover(error: unknown, ctx: AxpContext<R>, init?: AxpResponseInit<R>): R {
    return DEFAULT_RESPONSE_FACTORY.fail(
      { failure: AXP_FAILURES.INTERNAL, error: init?.failure === AXP_FAILURES.INTERNAL ? init.error : error, request: ctx.request },
      ctx as unknown as AxpContext<AxpResponse>,
    ) as unknown as R;
  }
  return {
    /** 保护收到响应后的构造。 */
    fromResponse(raw, ctx) {
      try {
        return brandResponse(factory.fromResponse(raw, ctx));
      } catch (error) {
        return recover(error, ctx);
      }
    },
    /** 构造后强制传输分类，使用者无法改写。 */
    fromError(error, ctx) {
      try {
        return markFailure(brandResponse(factory.fromError(error, ctx)), { type: classifyError(error) }, { error });
      } catch (cause) {
        return recover(cause, ctx);
      }
    },
    /** 构造后写入指定或继承的失败事实。 */
    fail: directFail
      ? factory.fail.bind(factory)
      : /** 自定义工厂返回后补齐事实，默认快照跳过此保护层。 */ (init, ctx) => {
          try {
            const inherited = init.from && failureOf(init.from);
            return markFailure(
              brandResponse(factory.fail(init, ctx)),
              init.failure ? { type: init.failure, reason: init.reason } : inherited ? { type: inherited.type, reason: init.reason ?? inherited.reason } : undefined,
              init,
            );
          } catch (error) {
            return recover(error, ctx, init);
          }
        },
  };
}
