import type { AxiosResponse } from "axios";
import { AXP_FAILURES } from "./brand";
import { requestKey, type IKeyOptions } from "./key";
import { type AxpResponse, type AxpResponseInit, type IAxpResponse, type IAxpResponseFactory } from "./response";
import type { AxpClient, AxpLogger, AxpRequestConfig, AxpRequestPatch } from "./types";

/** debug 关闭时丢弃日志，不为每个客户端创建闭包。 */
function noop(): void {}
/** 所有关闭 debug 的客户端与测试共享日志空对象。 */
export const NO_LOG: AxpLogger = { log: noop, warn: noop, error: noop };

/** 状态键的编译期类型品牌。 */
declare const STATE_TYPE: unique symbol;
/** 基于 Symbol 的逻辑请求状态键。 */
export type AxpStateKey<T> = symbol & {
  /** 只用于类型隔离。 */ readonly [STATE_TYPE]: T;
};

/** 创建互不冲突的类型化状态键。
 * @param description 仅用于调试的说明。
 * @returns 全新的 Symbol 键。
 * @example `const attempt = stateKey<number>('attempt')`
 */
export function stateKey<T>(description: string): AxpStateKey<T> {
  return Symbol(description) as AxpStateKey<T>;
}

/** 复制可枚举头字段，保留 undefined 删除指令和 false 禁用值；入参按对象字段读取，AxiosHeaders 的头字段即自有属性。 */
function mergeHeaders(base: object | undefined, patch: object | undefined): Record<string, unknown> {
  const headers: Record<string, unknown> = { ...base };
  const updates: Record<string, unknown> = { ...patch };
  for (const name of Object.keys(updates)) {
    const value = updates[name];
    const lowerName = name.toLowerCase();
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === lowerName) delete headers[existing];
    }
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}

/** 浅合并请求补丁；undefined 删除字段，headers 按不区分大小写的字段合并。
 * @param request 本层基准请求。
 * @param patch 只影响内层的新字段。
 * @returns 新请求视图，不修改输入。
 * @example `mergePatch(request, { timeout: undefined, headers: { Authorization: 'token' } })`
 */
export function mergePatch(request: Readonly<AxpRequestConfig>, patch: AxpRequestPatch): AxpRequestConfig {
  const merged = { ...request } as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) delete merged[key];
    else merged[key] = key === "headers" ? mergeHeaders(request.headers, value as object | undefined) : value;
  }
  return merged as AxpRequestConfig;
}

/** 构建逻辑请求上下文的依赖。 */
export interface IAxpContextInit<R extends IAxpResponse<unknown, string | number>> {
  /** 请求序号。 */
  id: number;
  /** 所属客户端。 */
  client: AxpClient<unknown, R>;
  /** 初始请求视图。 */
  request: AxpRequestConfig;
  /** 逻辑请求取消信号。 */
  signal: AbortSignal;
  /** 当前日志器。 */
  log: AxpLogger;
  /** 响应构造服务。 */
  factory: IAxpResponseFactory<R>;
  /** key 配置。 */
  key?: IKeyOptions;
  /** 合并 defaults 之前的原始请求级配置；省略时视为与 request 相同。 */
  origin?: AxpRequestConfig;
}
/** 最近一次传输尝试的只读原生数据快照。 */
export interface IAxpNative {
  /** 完整的原始传输响应。 */ readonly response?: AxiosResponse;
  /** 原始传输异常，成功时为 undefined。 */ readonly error?: unknown;
}
/** 请求各层共享的状态容器。 */
interface IAxpContextState<R> {
  /** 最近一次传输尝试的原生数据及响应配对，落定后禁止写入。 */
  native: {
    /** 配对的业务响应。 */ for: R | undefined;
    /** 原始传输响应。 */ raw: AxiosResponse | undefined;
    /** 原始传输异常。 */ error: unknown;
    /** 逻辑请求是否已经落定。 */ settled: boolean;
  };
  /** 类型化插件状态。 */
  values?: Map<symbol, unknown>;
  /** 是否需要重放保护。 */
  replayable: boolean;
  /** 已经交给传输层的一次性请求体，派生层共享。 */
  sentBodies?: WeakSet<object>;
  /** 补丁触及的字段，包括删除；重放时仍从当前视图取值。 */
  touched?: Set<string>;
  /** 合并 defaults 之前的原始请求级配置，传输层以它为底交给 axios。 */
  readonly origin: Readonly<AxpRequestConfig>;
}

/** 每层保持固定实例形状，逻辑请求状态通过同一容器共享。
 * @example `ctx.set(key, 1); return next({ headers: { Authorization: 'token' } })`
 */
export class AxpContext<R extends IAxpResponse<unknown, string | number> = AxpResponse> {
  /** 逻辑请求序号。 */
  readonly id: number;
  /** 所属客户端。 */
  readonly client: AxpClient<unknown, R>;
  /** 本层请求视图。 */
  readonly request: Readonly<AxpRequestConfig>;
  /** 本层的取消信号：根层是用户取消与 cancelAll 的合并信号，派生层若被补丁换了 signal 则以补丁为准。 */
  readonly signal: AbortSignal;
  /** debug 关闭时所有方法为空函数。 */
  readonly log: AxpLogger;
  /** 响应工厂。 */
  private readonly factory: IAxpResponseFactory<R>;
  /** 指纹配置。 */
  private readonly keyOptions: IKeyOptions | undefined;
  /** 同一逻辑请求的各层共享的可变状态。 */
  private readonly state: IAxpContextState<R>;
  /** 本层请求视图的惰性指纹；undefined 表示尚未计算，null 表示不可哈希。 */
  private keyValue: string | null | undefined;

  /** 建立一个逻辑请求的根上下文，或从外层上下文派生请求视图不同的内层上下文。
   * @param init 请求及内核服务；传入既有上下文时沿用其服务与共享状态。
   * @param request 本层请求视图，默认取 init.request。
   * @param patch 派生本层的补丁，用于记录传输差量；补丁带 signal 时本层取消信号以它为准。
   * @example `new AxpContext({ id, client, request, signal, log, factory })`
   */
  constructor(init: IAxpContextInit<R> | AxpContext<R>, request = init.request, patch?: AxpRequestPatch) {
    this.id = init.id;
    this.client = init.client;
    this.request = request;
    this.signal = patch?.signal ?? init.signal;
    this.log = init.log;
    if (init instanceof AxpContext) {
      this.factory = init.factory;
      this.keyOptions = init.keyOptions;
      this.state = init.state;
      if (patch) {
        const touched = (this.state.touched ??= new Set());
        for (const key of Object.keys(patch)) touched.add(key);
      }
    } else {
      this.factory = init.factory;
      this.keyOptions = init.key;
      this.state = { replayable: false, origin: init.origin ?? request, native: { for: undefined, raw: undefined, error: undefined, settled: false } };
    }
  }
  /** 按本层请求视图惰性缓存指纹；有补丁必派生新层，指纹随新层重算。
   * @returns 指纹或不可哈希时的 null。
   * @example `const key = ctx.key()`
   */
  key(): string | null {
    if (this.keyValue === undefined) this.keyValue = requestKey(this.request, this.keyOptions);
    return this.keyValue;
  }
  /** 读取同一逻辑请求的类型化状态。
   * @param key 状态键。
   * @returns 值或 undefined。
   * @example `ctx.get(attempt)`
   */
  get<T>(key: AxpStateKey<T>): T | undefined {
    return this.state.values?.get(key) as T | undefined;
  }
  /** 写入同一逻辑请求的状态。
   * @param key 状态键。
   * @param value 与键匹配的值。
   * @example `ctx.set(attempt, 1)`
   */
  set<T>(key: AxpStateKey<T>, value: T): void {
    (this.state.values ??= new Map()).set(key, value);
  }
  /** 经工厂构造失败或派生响应，确保扩展字段存在。
   * from 为当前配对响应时，配对随之转移到派生出的新响应。
   * @param init 分类和覆盖字段。
   * @returns 当前客户端的响应类型。
   * @example `ctx.fail({ failure: 'auth', reason: 'expired' })`
   */
  fail(init: AxpResponseInit<R>): R;
  /** 泛型插件仅提供基础字段时，无需证明尚未确定的扩展键。 */
  fail(init: AxpResponseInit<IAxpResponse<unknown, string | number>>): R;
  /** 扩展字段只在工厂边界收窄，运行期保持原样。 */
  fail(init: AxpResponseInit<R> | AxpResponseInit<IAxpResponse<unknown, string | number>>): R {
    const response = this.factory.fail(init as AxpResponseInit<R>, this);
    if (init.from !== undefined && init.from === this.state.native.for) this.state.native.for = response;
    return response;
  }
  /** 读取最近一次传输尝试的原生数据，与管线最终返回的响应未必配对。
   * 传输前提前返回的尝试不会刷新它，可能仍是上一次尝试的数据，不保证与当前响应配对；需要配对结果请由内核处理。
   * @returns 只读数据快照，落定后字段均为 undefined。
   * @example `const raw = ctx.native.response`
   */
  get native(): IAxpNative {
    return { response: this.state.native.raw, error: this.state.native.error };
  }
  /** 写入一次传输结果，落定后忽略迟到结果。
   * @internal
   * @param response 本次构造的业务响应。
   * @param raw 原始传输响应。
   * @param error 原始异常，成功时传 undefined 清除旧异常。
   * @returns 无返回值。
   * @example `ctx.setNative(response, raw, undefined)`
   */
  setNative(response: R, raw: AxiosResponse | undefined, error: unknown): void {
    const slot = this.state.native;
    if (slot.settled) return;
    slot.for = response;
    slot.raw = raw;
    slot.error = error;
  }
  /** 仅为身份配对的响应读取原生数据。
   * @internal
   * @param response 待落定的业务响应。
   * @returns 配对的数据快照，错配时为 undefined。
   * @example `const native = ctx.nativeFor(response)`
   */
  nativeFor(response: R): IAxpNative | undefined {
    return response === this.state.native.for ? this.native : undefined;
  }
  /** 清空原生数据并永久关闭本次逻辑请求的数据槽。
   * @internal
   * @returns 无返回值。
   * @example `ctx.clearNative()`
   */
  clearNative(): void {
    const slot = this.state.native;
    slot.for = undefined;
    slot.raw = undefined;
    slot.error = undefined;
    slot.settled = true;
  }
  /** 标记后续传输需保护可重放的 JSON 请求体。
   * @example `ctx.markReplayable()`
   */
  markReplayable(): void {
    this.state.replayable = true;
  }
  /** 判断本层请求体是否还能发送；已发送的一次性请求体不能重放。
   * @returns 当前 data 未发送过或可重复发送时为 true。
   * @example `const r = await next(); return ctx.canReplay() ? next() : r`
   */
  canReplay(): boolean {
    return !this.state.sentBodies?.has(this.request.data);
  }
  /** 传输前记录一次性请求体；流和异步迭代对象只能发送一次。
   * @internal
   * @param data 即将交给 axios 的请求体。
   * @example `ctx.markBodySent(request.data)`
   */
  markBodySent(data: unknown): void {
    if (!data || typeof data === "string") return;
    const body = data as { /** Node 流入口。 */ pipe?: unknown; /** Web 流入口。 */ getReader?: unknown; /** 异步迭代入口。 */ [Symbol.asyncIterator]?: unknown };
    if (typeof body.pipe === "function" || typeof body.getReader === "function" || typeof body[Symbol.asyncIterator] === "function") (this.state.sentBodies ??= new WeakSet()).add(body);
  }
  /** 传输层读取的重放标记。 */
  get replayable(): boolean {
    return this.state.replayable;
  }
  /** 传输层只遍历补丁触及的字段。
   * @internal
   */
  get touchedFields(): ReadonlySet<string> | undefined {
    return this.state.touched;
  }
  /** 合并 defaults 之前的原始请求级配置；传输层以它为底组装交给 axios 的差量。
   * @internal
   */
  get originRequest(): Readonly<AxpRequestConfig> {
    return this.state.origin;
  }
}

/** 逻辑请求已中止时派生 cancel 响应，否则返回 undefined；各层在 await 之后必须重查，别让已取消的请求继续往下走。
 * @internal
 * @param ctx 当前层上下文。
 * @returns cancel 响应；未中止为 undefined。
 * @example `const cancelled = cancelIfAborted(ctx); if (cancelled) return cancelled`
 */
export function cancelIfAborted<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>): R | undefined {
  return ctx.signal.aborted ? ctx.fail({ failure: AXP_FAILURES.CANCEL }) : undefined;
}

/** 派生固定形状的内层实例，共享逻辑状态与内核服务。
 * @param context 外层上下文。
 * @param request 内层请求视图。
 * @param patch 派生本层的补丁；直接替换视图时以新视图的字段为准。
 * @returns request 独立、状态共享的 AxpContext 实例。
 * @example `requestContext(ctx, mergePatch(ctx.request, patch))`
 */
export function requestContext<R extends IAxpResponse<unknown, string | number>>(context: AxpContext<R>, request: Readonly<AxpRequestConfig>, patch: AxpRequestPatch = request): AxpContext<R> {
  return new AxpContext(context, request, patch);
}
