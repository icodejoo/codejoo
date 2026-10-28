import { AXP_KINDS } from "./brand";
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
export interface IAxpContextInit<R extends IAxpResponse> {
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
/** 请求各层共享的状态容器。 */
interface IAxpContextState {
  /** 类型化插件状态。 */
  values?: Map<symbol, unknown>;
  /** 是否需要重放保护。 */
  replayable: boolean;
  /** 补丁触及的字段，包括删除；重放时仍从当前视图取值。 */
  touched?: Set<string>;
  /** 合并 defaults 之前的原始请求级配置，传输层以它为底交给 axios。 */
  readonly origin: Readonly<AxpRequestConfig>;
}

/** 每层保持固定实例形状，逻辑请求状态通过同一容器共享。
 * @example `ctx.set(key, 1); return next({ headers: { Authorization: 'token' } })`
 */
export class AxpContext<R extends IAxpResponse = AxpResponse> {
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
  private readonly state: IAxpContextState;
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
      this.state = { replayable: false, origin: init.origin ?? request };
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
   * @param init 分类和覆盖字段。
   * @returns 当前客户端的响应类型。
   * @example `ctx.fail({ kind: 'auth', reason: 'expired' })`
   */
  fail(init: AxpResponseInit<R>): R {
    return this.factory.fail(init, this);
  }
  /** 标记后续传输需保护可重放的 JSON 请求体。
   * @example `ctx.markReplayable()`
   */
  markReplayable(): void {
    this.state.replayable = true;
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
export function cancelIfAborted<R extends IAxpResponse>(ctx: AxpContext<R>): R | undefined {
  return ctx.signal.aborted ? ctx.fail({ kind: AXP_KINDS.CANCEL }) : undefined;
}

/** 派生固定形状的内层实例，共享逻辑状态与内核服务。
 * @param context 外层上下文。
 * @param request 内层请求视图。
 * @param patch 派生本层的补丁；直接替换视图时以新视图的字段为准。
 * @returns request 独立、状态共享的 AxpContext 实例。
 * @example `requestContext(ctx, mergePatch(ctx.request, patch))`
 */
export function requestContext<R extends IAxpResponse>(context: AxpContext<R>, request: Readonly<AxpRequestConfig>, patch: AxpRequestPatch = request): AxpContext<R> {
  return new AxpContext(context, request, patch);
}
