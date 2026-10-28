import type { AxpContext } from "../context";
import { normalizeMethod } from "../methods";
import { resolveOption, type AxpOption, type IPluginSwitch } from "../options";
import { AXP_KINDS, type IAxpResponse } from "../response";
import type { AxpNext, AxpPlugin, AxpRequestPatch } from "../types";
import { isPlainObject } from "../utils";

/** 内置共享插件名称。 */
const NAME = "axp:share";
/** AbortSignal 的标准事件名。 */
const ABORT_EVENT = "abort";
/** 取消 axios 层超时，把超时完全交给各订阅者自己的计时器。 */
const NO_TIMEOUT = 0;

/** 共享策略：首发复用、最新者胜、最先成功者胜。 */
export type SharePolicy = "start" | "end" | "race";

/** 未指定策略时采用首发复用。 */
const DEFAULT_POLICY: SharePolicy = "start";
/** 合法策略名，用于过滤请求级的非法字符串。 */
const POLICIES: ReadonlySet<string> = new Set(["start", "end", "race"]);
/** 默认只共享不改变服务端状态的方法。 */
const DEFAULT_METHODS = ["get", "head"];

/** 共享插件的装配配置。 */
export interface ISharedOptions extends IPluginSwitch {
  /** 默认共享策略，默认 start。 */
  policy?: SharePolicy;
  /** 允许共享的方法，默认 get、head；其它方法即使请求级开启也不共享。 */
  methods?: string[];
}

/** 请求级 share 对象写法。 */
export interface ISharedRequestOptions extends IPluginSwitch {
  /** 本次请求使用的共享策略。 */
  policy?: SharePolicy;
}

/** 内置默认：首发复用，只共享 GET 与 HEAD。 */
const DEFAULTS = {
  /** 默认策略。 */ policy: DEFAULT_POLICY,
  /** 默认方法。 */ methods: DEFAULT_METHODS,
};

/** 合并内置默认之后的共享配置。 */
type TShareConfig = ISharedOptions & Required<Pick<ISharedOptions, "policy" | "methods">>;

/** 一组同 key 并发请求共享的状态。 */
interface IShareEntry<R extends IAxpResponse> {
  /** 共享结果，永不 reject。 */
  promise: Promise<R>;
  /** 落定共享结果。 */
  resolve: (response: R) => void;
  /** 已落定或已被放弃；之后到达的结果一律丢弃。 */
  settled: boolean;
  /** 仍在等待的订阅者数。 */
  subs: number;
  /** start：共享请求的取消控制器。 */
  controller?: AbortController;
  /** end：已发出的请求序号，只有最新序号的结果有效。 */
  seq: number;
  /** race：仍在途的请求数。 */
  inflight: number;
}
/** 同一策略下 key 到共享条目的索引。 */
type TShareTable<R extends IAxpResponse> = Map<string, IShareEntry<R>>;
/** 某个策略处理一次请求的入口。 */
type TShareRunner = <R extends IAxpResponse>(
  ctx: AxpContext<R>,
  next: AxpNext<R>,
  key: string,
  table: TShareTable<R>,
) => Promise<R>;

/** 判断是否为合法策略名。 */
function isPolicy(value: unknown): value is SharePolicy {
  return POLICIES.has(value as string);
}

/** 字符串简写即策略名，非法字符串交回插件级策略。 */
function policyShorthand(value: unknown): Partial<ISharedOptions> | undefined {
  return isPolicy(value) ? { policy: value } : undefined;
}

/** 本次请求生效的策略；null 表示这次不共享。 */
function resolvePolicy(value: unknown, base: TShareConfig): SharePolicy | null {
  if (value === true) return base.policy;
  if (typeof value !== "string" && !isPlainObject(value)) return null;
  const resolved = resolveOption(value, base, DEFAULTS, policyShorthand);
  if (!resolved) return null;
  return isPolicy(resolved.policy) ? resolved.policy : base.policy;
}

/** 新建一个尚未落定的共享条目。 */
function createEntry<R extends IAxpResponse>(): IShareEntry<R> {
  let resolve!: (response: R) => void;
  const promise = new Promise<R>((done) => {
    resolve = done;
  });
  return { promise, resolve, settled: false, subs: 0, seq: 0, inflight: 0 };
}

/** 用共享结果落定条目并摘出索引；已落定或已放弃的条目忽略迟到的结果。 */
function settleEntry<R extends IAxpResponse>(
  table: TShareTable<R>,
  key: string,
  entry: IShareEntry<R>,
  response: R,
): void {
  if (entry.settled) return;
  entry.settled = true;
  if (table.get(key) === entry) table.delete(key);
  entry.resolve(response);
}

/** 读取已含实例 defaults 的有效超时毫秒数；缺省或非法按无超时处理。 */
function timeoutOf<R extends IAxpResponse>(ctx: AxpContext<R>): number {
  return ctx.request.timeout || NO_TIMEOUT;
}

/** 订阅一个共享条目：监听自己的取消与超时，单独离开只结束自己。
 * @param ctx 订阅者自己的上下文。
 * @param entry 共享条目。
 * @param abandon 最后一个订阅者提前离开时调用，用于中止底层请求；落定后订阅者在同一轮微任务内收尾，不会再提前离开。
 * @returns 共享结果，或订阅者自己的取消、超时响应。
 */
function subscribe<R extends IAxpResponse>(
  ctx: AxpContext<R>,
  entry: IShareEntry<R>,
  abandon?: () => void,
): Promise<R> {
  let deliver!: (response: R) => void;
  const result = new Promise<R>((resolve) => {
    deliver = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let left = false;
  /** 离开订阅：先解除监听，再交出结果；提前离开的最后一人负责放弃共享请求。 */
  function leave(response: R, early: boolean): void {
    if (left) return;
    left = true;
    clearTimeout(timer);
    ctx.signal.removeEventListener(ABORT_EVENT, onAbort);
    deliver(response);
    if (early && --entry.subs === 0) abandon?.();
  }
  /** 调用方取消：只让自己以 cancel 告终。 */
  function onAbort(): void {
    leave(ctx.fail({ kind: AXP_KINDS.CANCEL }), true);
  }
  entry.subs++;
  // 首发在订阅前已调用内层，内层若同步取消了调用方，abort 事件已错过，这里补判
  if (ctx.signal.aborted) {
    onAbort();
    return result;
  }
  ctx.signal.addEventListener(ABORT_EVENT, onAbort);
  const limit = timeoutOf(ctx);
  if (limit > 0) {
    timer = setTimeout(
      /** 调用方超时：只让自己以 timeout 告终。 */ () =>
        leave(
          ctx.fail({ kind: AXP_KINDS.TIMEOUT, message: `timeout of ${limit}ms exceeded` }),
          true,
        ),
      limit,
    );
  }
  void entry.promise.then(/** 共享结果到达。 */ (response) => leave(response, false));
  return result;
}

/** start：首发才真正发请求，后到的同 key 订阅者复用其结果。 */
function shareStart<R extends IAxpResponse>(
  ctx: AxpContext<R>,
  next: AxpNext<R>,
  key: string,
  table: TShareTable<R>,
): Promise<R> {
  let entry = table.get(key);
  if (!entry) {
    const created = createEntry<R>();
    entry = created;
    created.controller = new AbortController();
    table.set(key, created);
    // 共享请求用独立信号，超时也交给订阅者自己的计时器，首发的取消和超时都不连累跟随者。
    const patch: AxpRequestPatch = { signal: created.controller.signal };
    if (timeoutOf(ctx) > 0) patch.timeout = NO_TIMEOUT;
    void next(patch).then(
      /** 首发结果分发给所有订阅者。 */ (response) => settleEntry(table, key, created, response),
    );
  }
  const shared = entry;
  return subscribe(
    ctx,
    shared,
    /** 订阅者全部离开：摘除条目并中止底层请求。 */ () => {
      shared.settled = true;
      if (table.get(key) === shared) table.delete(key);
      shared.controller!.abort();
    },
  );
}

/** end：每次调用都发请求，只有最新一次的结果落定共享条目。 */
function shareEnd<R extends IAxpResponse>(
  ctx: AxpContext<R>,
  next: AxpNext<R>,
  key: string,
  table: TShareTable<R>,
): Promise<R> {
  let entry = table.get(key);
  if (!entry) {
    entry = createEntry<R>();
    table.set(key, entry);
  }
  const shared = entry;
  const mine = ++shared.seq;
  void next().then(
    /** 被更新的调用顶替后，这次的结果直接丢弃。 */ (response) =>
      mine === shared.seq ? settleEntry(table, key, shared, response) : undefined,
  );
  return subscribe(ctx, shared);
}

/** race：每次调用都发请求，第一个成功的胜出；全部失败时用最后一个。 */
function shareRace<R extends IAxpResponse>(
  ctx: AxpContext<R>,
  next: AxpNext<R>,
  key: string,
  table: TShareTable<R>,
): Promise<R> {
  let entry = table.get(key);
  if (!entry) {
    entry = createEntry<R>();
    table.set(key, entry);
  }
  const shared = entry;
  shared.inflight++;
  void next().then(
    /** 成功立即胜出；失败要等在途的都落定，最后到达的那个收尾。 */ (response) => {
      shared.inflight--;
      return response.ok || shared.inflight === 0
        ? settleEntry(table, key, shared, response)
        : undefined;
    },
  );
  return subscribe(ctx, shared);
}

/** 策略到处理入口的映射。 */
const RUNNERS: Record<SharePolicy, TShareRunner> = {
  start: shareStart,
  end: shareEnd,
  race: shareRace,
};

/** 合并同 key 的并发请求，按策略决定谁发请求、谁的结果被共享。
 * 请求级 `share` 开启（true、策略名或 `{ policy }`）；key 不可哈希时直接放行。
 * 共享以一次尝试为单位，retry 在外层，每次重试都会重新经过这里。
 * @param options 总开关、默认策略与允许共享的方法。
 * @returns source 阶段内置次序 2 的插件，每个客户端各有一套独立的共享表。
 * @example `axpShare({ policy: 'start' })` 配合 `api.get('/pets')(undefined, { share: true })`
 */
export default function axpShare<R extends IAxpResponse = IAxpResponse>(
  options: ISharedOptions = {},
): AxpPlugin<R> {
  const base = resolveOption<ISharedOptions, typeof DEFAULTS>(undefined, options, DEFAULTS);
  if (!isPolicy(base.policy)) base.policy = DEFAULT_POLICY;
  const methods = new Set(
    base.methods.map(/** 方法名统一小写。 */ (method) => method.toLowerCase()),
  );
  return {
    name: NAME,
    enable: options.enable,
    stage: "source",
    /** 每个客户端各自管理三种策略的共享表。 */
    setup() {
      const tables: Record<SharePolicy, TShareTable<R>> = {
        start: new Map(),
        end: new Map(),
        race: new Map(),
      };
      return {
        /** 只处理开启了 share、方法与 key 都合格的请求。 */
        async handle(ctx, next) {
          const policy = resolvePolicy(ctx.request.share, base);
          if (!policy || !methods.has(normalizeMethod(ctx.request.method))) return next();
          const key = ctx.key();
          if (key === null) return next();
          if (ctx.signal.aborted) return ctx.fail({ kind: AXP_KINDS.CANCEL });
          return RUNNERS[policy](ctx, next, key, tables[policy]);
        },
        /** 卸载后清空共享表，在途订阅者仍按各自结果落定。 */
        dispose() {
          tables.start.clear();
          tables.end.clear();
          tables.race.clear();
        },
      };
    },
  };
}

declare module "../types" {
  interface AxpRequestOptions {
    /** false 关闭；true 沿用插件策略；策略名或 `{ policy }` 只覆盖策略，enable:false 等同 false。 */
    share?: AxpOption<ISharedRequestOptions, SharePolicy>;
  }
}
