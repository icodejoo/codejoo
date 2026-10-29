import { cancelIfAborted, type AxpContext } from "../context";
import { methodSet, normalizeMethod, SAFE_METHODS } from "../methods";
import { resolveOption, resolveRequestOption, type AxpOption, type IPluginSwitch } from "../options";
import { failureOf, AXP_FAILURES, type AxpResponse, type IAxpResponse } from "../response";
import type { AxpNext, AxpPlugin, AxpRequestPatch } from "../types";
import { waitAbortable } from "../utils";

/** 内置共享插件名称。 */
const NAME = "axp:share";
/** 取消 axios 层超时，把超时完全交给各订阅者自己的计时器。 */
const NO_TIMEOUT = 0;

/** 共享策略：首发复用、最新者胜、最先成功者胜。 */
export type SharePolicy = "start" | "end" | "race";

/** 未指定策略时采用首发复用。 */
const DEFAULT_POLICY: SharePolicy = "start";
/** 合法策略名，用于过滤请求级的非法值；按 unknown 查询，判定入参本就是未校验的值。 */
const POLICIES: ReadonlySet<unknown> = new Set<SharePolicy>(["start", "end", "race"]);

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
  /** 默认方法。 */ methods: SAFE_METHODS,
};

/** 合并内置默认之后的共享配置。 */
type TShareConfig = ISharedOptions & Required<Pick<ISharedOptions, "policy" | "methods">>;

/** 一组同 key 并发请求共享的状态。 */
interface IShareEntry<R extends IAxpResponse<unknown, string | number>> {
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
  /** end：单调递增的请求序号。 */
  seq: number;
  /** end：仍在途、尚未完成或撤回的请求序号。 */
  pending: Set<number>;
  /** end：序号最大的已完成且未撤回的结果。 */
  completed?: {
    /** 已完成请求的序号。 */ seq: number;
    /** 已完成请求的响应。 */ response: R;
  };
  /** race：仍在途的请求数。 */
  inflight: number;
  /** race：最后到达的未撤回失败。 */
  failure?: R;
}
/** 同一策略下 key 到共享条目的索引。 */
type TShareTable<R extends IAxpResponse<unknown, string | number>> = Map<string, IShareEntry<R>>;
/** 某个策略处理一次请求的入口。 */
type TShareRunner = <R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, next: AxpNext<R>, key: string, table: TShareTable<R>) => Promise<R>;

/** 判断是否为合法策略名。 */
function isPolicy(value: unknown): value is SharePolicy {
  return POLICIES.has(value);
}

/** 字符串简写即策略名，写了非法策略名同样视为开启并交回插件级策略；非字符串不认。 */
function policyShorthand(value: unknown): Partial<ISharedOptions> | undefined {
  if (isPolicy(value)) return { policy: value };
  return typeof value === "string" ? {} : undefined;
}

/** 本次请求生效的策略；null 表示这次不共享（share 必须由请求开启）。 */
function resolvePolicy(value: unknown, base: TShareConfig): SharePolicy | null {
  const resolved = resolveRequestOption(value, base, DEFAULTS, policyShorthand, true);
  return resolved && (isPolicy(resolved.policy) ? resolved.policy : base.policy);
}

/** 新建一个尚未落定的共享条目。 */
function createEntry<R extends IAxpResponse<unknown, string | number>>(): IShareEntry<R> {
  let resolve!: (response: R) => void;
  const promise = new Promise<R>((done) => {
    resolve = done;
  });
  return { promise, resolve, settled: false, subs: 0, seq: 0, pending: new Set(), inflight: 0 };
}

/** 用共享结果落定条目并摘出索引；已落定或已放弃的条目忽略迟到的结果。 */
function settleEntry<R extends IAxpResponse<unknown, string | number>>(table: TShareTable<R>, key: string, entry: IShareEntry<R>, response: R): void {
  if (entry.settled) return;
  entry.settled = true;
  if (table.get(key) === entry) table.delete(key);
  entry.resolve(response);
}

/** 读取已含实例 defaults 的有效超时毫秒数；缺省或非法按无超时处理。 */
function timeoutOf<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>): number {
  return ctx.request.timeout || NO_TIMEOUT;
}

/** 订阅一个共享条目：等共享结果，同时监听自己的取消与超时，单独离开只结束自己。
 * 首发在订阅前已调用内层，内层若同步取消了调用方，abort 事件已错过；等待原语对已中止的信号直接返回，补判由它兜住。
 * @param ctx 订阅者自己的上下文。
 * @param entry 共享条目。
 * @param abandon 最后一个订阅者提前离开时调用，用于中止底层请求；落定后订阅者在同一轮微任务内收尾，不会再提前离开。
 * @returns 共享结果，或订阅者自己的取消、超时响应。
 */
function subscribe<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, entry: IShareEntry<R>, abandon?: () => void): Promise<R> {
  entry.subs++;
  const limit = timeoutOf(ctx);
  return waitAbortable(entry.promise, ctx.signal, limit > 0 ? limit : undefined).then(
    /** 共享结果到达，或订阅者自己提前离开。 */ (response) => {
      if (response) return response;
      // 提前离开只结束自己；最后一个提前离开的负责放弃共享请求。
      if (--entry.subs === 0) abandon?.();
      // 已中止是调用方取消，否则是自己的超时；文案与 axios 的超时一致。
      return cancelIfAborted(ctx) ?? ctx.fail({ failure: AXP_FAILURES.TIMEOUT, message: ctx.request.timeoutErrorMessage || `timeout of ${limit}ms exceeded` });
    },
  );
}

/** 取出同 key 的共享条目，没有就新建并登记。 */
function entryFor<R extends IAxpResponse<unknown, string | number>>(table: TShareTable<R>, key: string): IShareEntry<R> {
  let entry = table.get(key);
  if (!entry) {
    entry = createEntry<R>();
    table.set(key, entry);
  }
  return entry;
}

/** start：首发才真正发请求，后到的同 key 订阅者复用其结果。 */
function shareStart<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, next: AxpNext<R>, key: string, table: TShareTable<R>): Promise<R> {
  let entry = table.get(key);
  if (!entry) {
    const created = createEntry<R>();
    entry = created;
    created.controller = new AbortController();
    table.set(key, created);
    // 共享请求用独立信号，超时也交给订阅者自己的计时器，首发的取消和超时都不连累跟随者。
    const patch: AxpRequestPatch = { signal: created.controller.signal };
    if (timeoutOf(ctx) > 0) patch.timeout = NO_TIMEOUT;
    void next(patch).then(/** 首发结果分发给所有订阅者。 */ (response) => settleEntry(table, key, created, response));
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

/** end：每次调用都发请求，最新的未撤回请求落定共享条目。 */
function shareEnd<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, next: AxpNext<R>, key: string, table: TShareTable<R>): Promise<R> {
  const shared = entryFor(table, key);
  const mine = ++shared.seq;
  shared.pending.add(mine);
  void next().then(
    /** 最新者撤回后，回退到最新的在途请求或已完成结果。 */ (response) => {
      shared.pending.delete(mine);
      const withdrawn = failureOf(response)?.type === AXP_FAILURES.CANCEL && ctx.signal.aborted;
      let latestPending = 0;
      for (const sequence of shared.pending) latestPending = Math.max(latestPending, sequence);
      if (!withdrawn) {
        if (!shared.completed || mine > shared.completed.seq) shared.completed = { seq: mine, response };
        if (mine > latestPending) settleEntry(table, key, shared, response);
      } else if (shared.pending.size === 0) {
        // 没有在途请求才回退已完成结果；全部撤回时用取消结果清表。
        settleEntry(table, key, shared, shared.completed?.response ?? response);
      }
      return undefined;
    },
  );
  return subscribe(ctx, shared);
}

/** race：第一个成功的胜出；否则用最后一个未撤回失败，全部撤回时清表。 */
function shareRace<R extends IAxpResponse<unknown, string | number>>(ctx: AxpContext<R>, next: AxpNext<R>, key: string, table: TShareTable<R>): Promise<R> {
  const shared = entryFor(table, key);
  shared.inflight++;
  void next().then(
    /** 自己取消的响应不能成为其他订阅者的结果，超时仍正常参与。 */ (response) => {
      shared.inflight--;
      const withdrawn = failureOf(response)?.type === AXP_FAILURES.CANCEL && ctx.signal.aborted;
      if (!withdrawn) {
        if (response.ok) return settleEntry(table, key, shared, response);
        shared.failure = response;
      }
      return shared.inflight === 0 ? settleEntry(table, key, shared, shared.failure ?? response) : undefined;
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
export default function axpShare<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: ISharedOptions = {}): AxpPlugin<R> {
  const base = resolveOption<ISharedOptions, typeof DEFAULTS>(undefined, options, DEFAULTS);
  if (!isPolicy(base.policy)) base.policy = DEFAULT_POLICY;
  const methods = methodSet(base.methods);
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
          return cancelIfAborted(ctx) ?? RUNNERS[policy](ctx, next, key, tables[policy]);
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
