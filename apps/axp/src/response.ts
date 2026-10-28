import { isAxiosError, isCancel, type AxiosResponse } from "axios";
import type { AxpContext } from "./context";
import type { AxpRequestConfig, TAxpArgs, TAxpDefaultResponse } from "./types";
import { isObject } from "./utils";

/** 跨入口共享的响应品牌。 */
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
/** 缺少业务消息时的默认值。 */
const EMPTY_MESSAGE = "";
/** expectJson 判断的响应媒体类型。 */
const JSON_CONTENT_TYPE = /json|html/i;
/** HTTP 成功区间的终点（不含）。 */
const HTTP_SUCCESS_END = 300;
/** 业务错误码的起点。 */
const BIZ_STATUS_MIN = 400;
/** 业务错误码上界（不含），保持原数值区间。 */
const BIZ_STATUS_MAX = 600;
/** 未配置 envelope 时识别的信封字段名。 */
const DEFAULT_ENVELOPE: IAxpEnvelope = { code: "code", data: "data", message: "message" };
/** 没有收到响应的类别。 */
const FAILURE_KINDS = new Set<AxpKind>([
  AXP_KINDS.NETWORK,
  AXP_KINDS.TIMEOUT,
  AXP_KINDS.CANCEL,
  AXP_KINDS.PARSE,
  AXP_KINDS.AUTH,
  AXP_KINDS.INTERNAL,
]);

/** 成功或失败的归一化类别。 */
export type AxpKind = (typeof AXP_KINDS)[keyof typeof AXP_KINDS];

/** 管线内唯一的只读响应契约，扩展实现无需继承默认类。 */
export interface IAxpResponse<D = unknown> {
  /** 是否成功。 */
  readonly ok: boolean;
  /** 归一化类别。 */
  readonly kind: AxpKind;
  /** 插件使用的逻辑状态。 */
  readonly status: number;
  /** 原始 HTTP 状态，无响应为零。 */
  readonly httpStatus: number;
  /** 信封业务码。 */
  readonly code?: string | number;
  /** 失败或业务消息。 */
  readonly message: string;
  /** 业务数据。 */
  readonly data: D;
  /** 细分原因。 */
  readonly reason?: string;
  /** 实际发送时的请求视图。 */
  readonly request: Readonly<AxpRequestConfig>;
  /** debug 请求调用点。 */
  readonly stack?: string;
  /** 原始 axios 响应。 */
  readonly raw?: AxiosResponse;
  /** 原始异常，internal 落定时原样抛出。 */
  readonly error?: unknown;
}

/** 构造或派生响应的输入；from 未覆盖的字段沿用。 */
export type AxpResponseInit<R extends IAxpResponse = IAxpResponse> = Partial<IAxpResponse> & {
  /** 派生来源。 */
  readonly from?: R;
};

/** 默认响应；覆盖 ok/status getter 即可改变业务判定。
 * @example `class Custom extends AxpResponse { get ok() { return this.code === 200 } }`
 */
export class AxpResponse<D = unknown> implements IAxpResponse<D> {
  /** 原始 HTTP 状态。 */
  readonly httpStatus: number;
  /** 信封业务码。 */
  readonly code?: string | number;
  /** 业务消息。 */
  readonly message: string;
  /** 业务数据。 */
  readonly data: D;
  /** 细分原因。 */
  readonly reason?: string;
  /** 实际请求。 */
  readonly request: Readonly<AxpRequestConfig>;
  /** 调用点。 */
  readonly stack?: string;
  /** axios 响应。 */
  readonly raw?: AxiosResponse;
  /** 原始异常。 */
  readonly error?: unknown;

  /** 根据字段构造响应；无响应的分类会遮住子类 getter。
   * @param init 响应字段或派生来源。
   * @example `new AxpResponse({ httpStatus: 200, data: 'ok' })`
   */
  constructor(init: AxpResponseInit = {}, request?: Readonly<AxpRequestConfig>) {
    const fields = resolveInit(init);
    this.httpStatus = fields.httpStatus ?? 0;
    this.code = fields.code;
    this.message = fields.message ?? EMPTY_MESSAGE;
    this.data = fields.data as D;
    this.reason = fields.reason;
    this.request = fields.request ?? request ?? {};
    this.stack = fields.stack;
    this.raw = fields.raw;
    this.error = fields.error;
    defineFailure(this, fields.kind, fields.status);
  }

  /** 默认成功：2xx 且无业务码、数字零或字符串 0000。 */
  get ok(): boolean {
    return (
      isHttpOk(this.httpStatus) &&
      (this.code === undefined || this.code === 0 || this.code === "0000")
    );
  }
  /** 2xx 业务失败中的数字 4xx/5xx 映射为逻辑状态。 */
  get status(): number {
    return !this.ok &&
      isHttpOk(this.httpStatus) &&
      typeof this.code === "number" &&
      this.code >= BIZ_STATUS_MIN &&
      this.code < BIZ_STATUS_MAX
      ? this.code
      : this.httpStatus;
  }
  /** 类别跟随可覆盖的成功判定。 */
  get kind(): AxpKind {
    return this.ok ? AXP_KINDS.OK : isHttpOk(this.httpStatus) ? AXP_KINDS.BIZ : AXP_KINDS.HTTP;
  }
  /** 序列化判定字段和可枚举扩展字段，省略 raw/error 并仅保留请求 method/url。
   * @returns 不包含传输引用的字段；业务数据及扩展字段应自行保证可序列化。
   * @example `JSON.stringify(response)`
   */
  toJSON(): object {
    const fields = { ...this } as Record<string, unknown>;
    delete fields.raw;
    delete fields.error;
    return {
      ...fields,
      ok: this.ok,
      status: this.status,
      kind: this.kind,
      request: { method: this.request.method, url: this.request.url },
    };
  }
}
Object.defineProperty(AxpResponse.prototype, AXP_RESPONSE, { value: true });

/** 每客户端的响应构造入口。 */
export interface IAxpResponseFactory<R extends IAxpResponse = AxpResponse> {
  /** 将收到的响应归一化。
   * @param res axios 实际响应。
   * @param ctx 当前请求上下文。
   * @returns 当前客户端约定的响应对象。
   * @example `factory.fromResponse(raw, ctx)`
   */
  fromResponse(res: AxiosResponse, ctx: AxpContext<R>): R;
  /** 将传输异常分类，非 AxiosError 作为 internal。
   * @param error 原始传输或用户代码异常。
   * @param ctx 当前请求上下文。
   * @returns 保留原始异常的归一化响应。
   * @example `factory.fromError(error, ctx)`
   */
  fromError(error: unknown, ctx: AxpContext<R>): R;
  /** 凭空构造或从既有响应派生。
   * @param init 覆盖字段，from 指定派生来源。
   * @param ctx 当前请求上下文。
   * @returns 新的响应对象；不得修改 from。
   * @example `factory.fail({ from: response, stack }, ctx)`
   */
  fail(init: AxpResponseInit<R>, ctx: AxpContext<R>): R;
}

/** 信封字段映射。 */
export interface IAxpEnvelope {
  /** 业务码字段。 */
  code: string;
  /** 数据字段。 */
  data: string;
  /** 消息字段。 */
  message: string;
}
/** 默认响应工厂配置。 */
export interface IAxpResponseOptions<R extends IAxpResponse> {
  /** false 关闭信封识别。 */
  envelope?: false | IAxpEnvelope;
  /** 声明 json/html 的非空文本算解析失败。 */
  expectJson?: boolean;
  /** 自定义构造器，必须为每次调用产出独立响应。 */
  create?: (init: AxpResponseInit<R>, raw?: AxiosResponse) => R;
}
/** 自定义响应类型必须提供构造回调。 */
type TAxpResponseOptions<R extends IAxpResponse> = IAxpResponseOptions<R> &
  (TAxpDefaultResponse<R> extends true
    ? unknown
    : { /** 自定义响应构造器。 */ create: NonNullable<IAxpResponseOptions<R>["create"]> });

/** 判断 HTTP 状态是否成功。 */
function isHttpOk(status: number): boolean {
  return status >= 200 && status < HTTP_SUCCESS_END;
}

/** 将派生来源合并为扁平字段，显式 data/error 的 undefined 仍覆盖来源。 */
function resolveInit<R extends IAxpResponse>(init: AxpResponseInit<R>): AxpResponseInit<R> {
  const source = init.from;
  if (!source) return init;
  return {
    ...init,
    httpStatus: init.httpStatus ?? source.httpStatus,
    code: init.code ?? source.code,
    message: init.message ?? source.message,
    data: "data" in init ? init.data : source.data,
    reason: init.reason ?? source.reason,
    request: init.request ?? source.request,
    stack: init.stack ?? source.stack,
    raw: init.raw ?? source.raw,
    error: "error" in init ? init.error : source.error,
    kind: init.kind ?? source.kind,
    status: init.status ?? source.status,
  };
}

/** 无响应失败通过实例字段遮住判定 getter。 */
function defineFailure(
  target: object,
  kind: AxpKind | undefined,
  status: number | undefined,
): void {
  if (kind !== undefined && FAILURE_KINDS.has(kind)) {
    Object.defineProperties(target, {
      ok: { value: false, enumerable: true, configurable: true },
      status: { value: status ?? 0, enumerable: true, configurable: true },
      kind: { value: kind, enumerable: true, configurable: true },
    });
  }
}

/** 检查跨模块共享品牌，不依赖 instanceof。
 * @param value 任意被抛出的值。
 * @returns 是否为归一化响应。
 * @example `if (isAxpResponse(error)) console.log(error.kind)`
 */
export function isAxpResponse<R extends IAxpResponse = AxpResponse>(value: unknown): value is R {
  return isObject(value) && (value as Record<symbol, unknown>)[AXP_RESPONSE] === true;
}

/** 在响应进入管线前补齐不可枚举品牌。
 * @internal
 * @param response 当前工厂的产出。
 * @returns 保持原对象身份的品牌响应。
 * @example `brandResponse(factory.fail(init, ctx))`
 */
function brandResponse<R extends IAxpResponse>(response: R): R {
  if (!isAxpResponse<R>(response)) Object.defineProperty(response, AXP_RESPONSE, { value: true });
  return response;
}

/** 创建默认响应工厂；自定义 R 必须提供 create。
 * @param options 信封映射、解析守卫及构造器。
 * @returns 用于 createAxp 的响应工厂。
 * @example `axpResponse({ envelope: false, expectJson: true })`
 */
export function axpResponse<R extends IAxpResponse = AxpResponse>(
  ...[options = {} as TAxpResponseOptions<R>]: TAxpArgs<R, TAxpResponseOptions<R>>
): IAxpResponseFactory<R> {
  const envelope = options.envelope ?? DEFAULT_ENVELOPE;
  /** 集中补齐请求、品牌和失败字段。 */
  function build(init: AxpResponseInit<R>, ctx: AxpContext<R>): R {
    if (!options.create) return new AxpResponse(init, ctx.request) as unknown as R;
    let fields = resolveInit(init);
    if (fields.request === undefined) fields = { ...fields, request: ctx.request };
    const response = options.create(fields, fields.raw);
    if (!(response instanceof AxpResponse)) {
      brandResponse(response);
      defineFailure(response, fields.kind, fields.status);
    }
    return response;
  }
  return {
    /** 解析信封，保持非信封数据原样。 */
    fromResponse(res, ctx) {
      const body = res.data as unknown;
      if (
        options.expectJson &&
        isHttpOk(res.status) &&
        typeof body === "string" &&
        body.trim() !== "" &&
        JSON_CONTENT_TYPE.test(String(res.headers?.["content-type"] ?? ""))
      ) {
        return build(
          {
            kind: AXP_KINDS.PARSE,
            status: res.status,
            httpStatus: res.status,
            raw: res,
            data: body,
            message: "Invalid JSON response",
            request: res.config as AxpRequestConfig,
          },
          ctx,
        );
      }
      const wrapped =
        envelope !== false && isObject(body) && envelope.code in body && envelope.data in body;
      const record = body as Record<string, unknown>;
      return build(
        {
          httpStatus: res.status,
          code: wrapped ? (record[envelope.code] as string | number) : undefined,
          data: wrapped ? record[envelope.data] : body,
          message: wrapped ? String(record[envelope.message] ?? EMPTY_MESSAGE) : EMPTY_MESSAGE,
          raw: res,
          request: res.config as AxpRequestConfig,
        },
        ctx,
      );
    },
    /** 分类取消、超时、解析、网络与程序异常。 */
    fromError(error, ctx) {
      let kind: AxpKind;
      if (isCancel(error) || (error instanceof Error && error.name === "AbortError"))
        kind = AXP_KINDS.CANCEL;
      else if (!isAxiosError(error)) kind = AXP_KINDS.INTERNAL;
      else if (
        error.code === "ETIMEDOUT" ||
        (error.code === "ECONNABORTED" && /timeout/i.test(error.message))
      )
        kind = AXP_KINDS.TIMEOUT;
      else if (error.code === "ERR_BAD_RESPONSE") kind = AXP_KINDS.PARSE;
      else kind = AXP_KINDS.NETWORK;
      return build(
        {
          kind,
          error,
          request: isAxiosError(error) ? (error.config as AxpRequestConfig | undefined) : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
        ctx,
      );
    },
    /** 按显式字段覆盖派生来源。 */
    fail: build,
  };
}

/** 无配置的默认工厂无可变状态，客户端与兜底路径共享。 */
export const DEFAULT_RESPONSE_FACTORY = axpResponse();

/** 在客户端装配期统一保护工厂三个入口并补齐品牌。
 * @internal
 * @param factory 用户提供或默认的响应工厂。
 * @returns 工厂异常始终转为保留原异常的 internal，产出均带品牌。
 * @example `guardFactory(customResponse())`
 */
export function guardFactory<R extends IAxpResponse>(
  factory: IAxpResponseFactory<R>,
): IAxpResponseFactory<R> {
  const fallback = DEFAULT_RESPONSE_FACTORY as unknown as IAxpResponseFactory<R>;
  /** 工厂抛错时用默认工厂造 internal；fail 入口本就是 internal 时沿用它携带的原异常。 */
  function recover(error: unknown, ctx: AxpContext<R>, init?: AxpResponseInit<R>): R {
    const cause = init?.kind === AXP_KINDS.INTERNAL ? init.error : error;
    return fallback.fail({ kind: AXP_KINDS.INTERNAL, error: cause, request: ctx.request }, ctx);
  }
  return {
    /** 保护收到响应后的归一化。 */
    fromResponse(response, ctx) {
      try {
        return brandResponse(factory.fromResponse(response, ctx));
      } catch (error) {
        return recover(error, ctx);
      }
    },
    /** 保护传输异常的分类。 */
    fromError(error, ctx) {
      try {
        return brandResponse(factory.fromError(error, ctx));
      } catch (factoryError) {
        return recover(factoryError, ctx);
      }
    },
    /** 保护合成响应与派生响应的构造。 */
    fail(init, ctx) {
      try {
        return brandResponse(factory.fail(init, ctx));
      } catch (error) {
        return recover(error, ctx, init);
      }
    },
  };
}
