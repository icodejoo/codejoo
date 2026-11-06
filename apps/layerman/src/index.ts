/**
 * @codejoo/layerman — 框架无关的 headless overlay 队列管理器。
 *
 * 只负责「活跃 id + phase + 排序 + 门控 + 冷却 + 数据驱动」，**不碰任何 DOM/UI/动画**。
 * 渲染、蒙层、动画、z-index 全部由宿主完成；本包对外暴露响应式状态（`subscribe` +
 * `getSnapshot` + `get`），宿主据此渲染 `active` 列表即可。零运行时依赖。
 */

import { CooldownStore, defaultStorage } from "./cooldown.ts";
import type { AsyncableStorage, Cooldown, CooldownRecord } from "./cooldown.ts";

export type { AsyncableStorage, Cooldown, Duration } from "./cooldown.ts";

/* ────────────────────────────── 公共类型 ────────────────────────────── */

/** 条件谓词上下文。保留键 `route`/`auth` 供内置糖使用，其余键自由，由宿主经 `setContext` 推入。 */
export interface OverlayContext {
  route?: string;
  auth?: boolean;
  [key: string]: unknown;
}

/** overlay 配置（`open` 的入参）。`id` 唯一；`data` 对本包完全不透明。 */
export interface OverlayConfig<TData = unknown> {
  /** 唯一键。用于队列追踪、事件标识、冷却持久化。不传则内部自动生成并直接入队（保证唯一，跳过同 id 覆盖判定）。 */
  id?: string;
  /** 不透明载荷（宿主渲染所需；声明式自渲染组件可不传）。 */
  data?: TData;
  /** 命名 slot：每个 slot 一条独立串行队列。不填进默认队列。 */
  slot?: string;
  /** 优先级，默认 0；降序 + 同级 FIFO。 */
  priority?: number;
  /** 出现前等待毫秒，覆盖全局 `gap`。 */
  delay?: number;
  /** 显示 N 毫秒后自动 `close`；不填=常驻。 */
  duration?: number;
  /** 覆盖全局 `autoRemove`。 */
  autoRemove?: boolean | number;
  /**
   * 叠加(overlap)显示：**不遵守「一次只显示一个」的规则**——绕过串行队列与 gap，立即与当前弹窗
   * 重叠显示。暂停或持久化冷却尚未 hydrate 时先持有；放行时条件/冷却不满足即丢弃，reason 为
   * 'unmet'；session/total 永久耗尽则以 'capped' 兑现，不等待条件或额度恢复（见 README）。
   */
  overlap?: boolean;
  /** 替换本 slot 当前活跃者（被替换者退回队列），跳过 gap。 */
  replace?: boolean;
  /** 固定展示：不会被 `replace` 顶掉（仅挡 replace，不挡显式 close/remove/clear）。 */
  affix?: boolean;
  /** 内置条件糖：仅在匹配路由时显示（匹配 `ctx.route`）。 */
  route?: string | string[] | RegExp;
  /** 内置条件糖：`true` 仅登录、`false` 仅未登录（读 `ctx.auth`）。 */
  requiresAuth?: boolean;
  /** 覆盖式谓词，最高优先：配了它就忽略 `route`/`requiresAuth`。 */
  when?: (ctx: OverlayContext) => boolean;
  /** 已展示时若条件(route/requiresAuth/when)在 setContext 后不再满足，是否自动撤下并推进下一个。默认 `true`。 */
  dismissWhenUnmet?: boolean;
  /** 冷却配置。 */
  cooldown?: Cooldown;
  /** 后端数据驱动：轮到它当 front 且通过同步条件/冷却后才调用；返回 `null` = 本轮不显示。 */
  resolve?: (signal: AbortSignal) => Promise<TData | null>;
  /** 关闭守卫：`close` 前调用；返回（或 Promise resolve）`false` 则取消本次关闭，其余值放行。 */
  beforeClose?: () => boolean | Promise<boolean>;
  /** 生命周期钩子（副作用用，如埋点）。 */
  onShow?: () => void;
  onClose?: () => void;
  onRemove?: () => void;
}

/** overlay 的渲染阶段（对外契约仅两态）。 */
export const OverlayPhase = {
  open: "open",
  closing: "closing",
} as const;
export type OverlayPhase = (typeof OverlayPhase)[keyof typeof OverlayPhase];

/** 对外暴露的活跃实例（供宿主渲染）。 */
export interface OverlayInstance<TData = unknown> {
  id: string;
  data: TData;
  slot: string;
  phase: OverlayPhase;
  priority: number;
  /** 是否为 overlap（叠加/并发）弹窗——绕过串行、与其他弹窗同时显示。 */
  overlapping: boolean;
  /** 叠加渲染层序（入场序，从 0）；宿主据此算 z-index / 给非顶层加 pointer-events:none。 */
  stackIndex: number;
  /** 是否为最上层（stackIndex 最大）。 */
  isTopmost: boolean;
  /** 每次 open 递增；宿主当 render key，治「同 id 重开不重挂」。 */
  instanceKey: number;
}

/** `clear` 选择器看到的受管条目（含队列中与活跃的）。 */
export interface OverlayRecord {
  id: string;
  data: unknown;
  slot: string;
  /** pending / resolving / open / closing。 */
  phase: string;
  active: boolean;
}

/** `clear` 选择器：收到上下文 + 全部条目，返回要清理的 id 数组；返回非数组（如 void）→ 全部清理。 */
export type ClearSelector = (ctx: OverlayContext, records: OverlayRecord[]) => string[] | void;

/** subscribe/getSnapshot 的状态形状。 */
export interface OverlayState {
  /** 当前该渲染的实例（各 slot 串行槽 + overlap 叠加），phase ∈ {open, closing}。 */
  active: readonly OverlayInstance[];
  /** 等待中的 id（只读，供观测/调试）。 */
  queued: readonly string[];
}

/** 被动结束原因；对象值与同名联合类型供宿主共用。 */
export const DismissReason = {
  removed: "removed",
  closed: "closed",
  cleared: "cleared",
  replaced: "replaced",
  unmet: "unmet",
  capped: "capped",
  destroyed: "destroyed",
  empty: "empty",
} as const;
export type DismissReason = (typeof DismissReason)[keyof typeof DismissReason];

/** 被动关闭（未经 `resolve`/`reject`）时 result 的兑现值。 */
export interface DismissResult {
  dismissed: true;
  /** 被动关闭的原因；各路径取值见 `DismissReason`，旧代码只判断 `dismissed` 不受影响。 */
  reason?: DismissReason;
}

/** `open` 的返回句柄。 */
export interface OverlayHandle<TResult = unknown> {
  id: string;
  /** await 拿结果；宿主经 `resolve(id, v)` 投递；被动关闭则以 `{ dismissed: true, reason }` 兑现（reason 见 `DismissReason`）。 */
  result: Promise<TResult | DismissResult>;
}

/** `createLayerman` 配置。 */
export interface LayermanOptions {
  /** 全局转场间隔毫秒，默认 0。 */
  gap?: number;
  /** 关闭后自动移除：`true`（=300ms）| 数字（自定毫秒）| `false`（纯手动）。默认 `true`。 */
  autoRemove?: boolean | number;
  /** 冷却持久化存储；默认有 `localStorage` 用它，否则纯内存。 */
  storage?: AsyncableStorage;
  /** 存储/广播键，默认 `layerman:v1`。 */
  storageKey?: string;
  /** 时间源，默认 `Date.now`（供测试）。 */
  now?: () => number;
  /** 开启事件日志。 */
  debug?: boolean;
  /** 自定义日志输出，默认 `console.log`。 */
  logger?: (message: string) => void;
  /** 跨标签页同步冷却计数；具有 window 与 BroadcastChannel 的环境默认开启。 */
  crossTab?: boolean;
}

/** 管理器实例接口。 */
export interface Layerman {
  open<TData = unknown, TResult = unknown>(config: OverlayConfig<TData>): OverlayHandle<TResult>;
  /** 向曾展示的条目投递成功值；未展示或已兑现时忽略。 */
  resolve(id: string, value: unknown): void;
  /** 拒绝曾展示条目的结果；未展示或已兑现时忽略。 */
  reject(id: string, error: unknown): void;
  /** 就地更新某条目 data（对象浅合并，否则替换），不触发队列变更。 */
  update(id: string, patch: unknown): void;
  /** 仅 open 项请求进入 closing；有 beforeClose 时先过守卫，其余阶段无操作。 */
  close(id: string): void;
  remove(id: string): void;
  /** 清空。传选择器 `(ctx, records) => id[]` 精确清理（非数组=全部）；或 `{ closeActive }` 传统清队列。 */
  clear(arg?: ClearSelector | { closeActive?: boolean }): void;
  pauseAll(): void;
  resumeAll(): void;
  pause(id: string): void;
  resume(id: string): void;
  /** 推入上下文并重评：撤下条件不再满足的已展示项，再重新调度各 slot。 */
  setContext(partial: Partial<OverlayContext>): void;
  /** 订阅状态变化，返回取消订阅函数；`immediate` 为 true 时立即推送一次当前快照。 */
  subscribe(listener: (state: OverlayState) => void, options?: { immediate?: boolean }): () => void;
  getSnapshot(): OverlayState;
  getServerSnapshot(): OverlayState;
  /** 按 id 取活跃实例，没有则 undefined。 */
  get(id: string): OverlayInstance | undefined;
  /** 等待冷却状态从存储 hydrate 完成（异步存储也 OK）。 */
  ready(): Promise<void>;
  /** 释放：清空、断开跨标签页广播、销毁定时器。 */
  destroy(): void;
}

/* ────────────────────────────── 内部实现 ────────────────────────────── */

/** 日志用生命周期跃迁（比对外 phase 更细）。 */
const LOG_STATE = {
  pending: "pending",
  resolving: "resolving",
  open: "open",
  closing: "closing",
  closed: "closed",
} as const;
type LogState = (typeof LOG_STATE)[keyof typeof LOG_STATE];

type Timer = ReturnType<typeof setTimeout>;

/** 内部资格判断结果；永久耗尽与暂时等待分开。 */
const ELIGIBILITY = { pass: "pass", wait: "wait", drop: "drop" } as const;

/** 内部队列/活跃条目。 */
interface Entry {
  cfg: OverlayConfig;
  id: string;
  slot: string;
  priority: number;
  instanceKey: number;
  seq: number;
  /** 最近一次真正入场的顺序，与实例标识独立。 */
  enteredSeq: number;
  /** 当前展示或请求的代次。 */
  epoch: number;
  overlapping: boolean;
  affix: boolean;
  /** 因 affix 被拦而入队的 replace 项，整体排在普通项之前。 */
  replaceJumped: boolean;
  /** 跳过 gap 等待（replace / 同 id 重开）。 */
  skipGap: boolean;
  /** 本次 open 是否豁免冷却计数（被 replace 从 open 态退回后重开）。 */
  exemptCooldown: boolean;
  phase: LogState;
  /** result 是否已兑现（resolve/reject/dismiss 任一）。 */
  settled: boolean;
  settle: (value: unknown) => void;
  fail: (error: unknown) => void;
  /** 条目倒计时及单条暂停状态。 */
  timers: {
    /** 展示时长计时器。 */
    durationTimer?: Timer;
    /** 展示倒计时截止时间。 */
    durationEndsAt?: number;
    /** 暂停时保留的展示剩余时长。 */
    durationRemaining?: number;
    /** 关闭后的自动移除计时器。 */
    autoRemoveTimer?: Timer;
    /** 自动移除截止时间。 */
    autoRemoveEndsAt?: number;
    /** 暂停时保留的自动移除剩余时长。 */
    autoRemoveRemaining?: number;
    /** 是否单独冻结该条目的倒计时。 */
    paused: boolean;
  };
  /** 本轮请求、中止身份与暂停期间的缓存。 */
  resolveState: {
    /** 暂停期间是否已有请求结果等待落地。 */
    hasPendingResolve: boolean;
    /** 暂停期间缓存的请求结果。 */
    pendingResolveData?: unknown;
    /** 本轮请求期间的数据补丁，落地时依次应用。 */
    resolvePatches: unknown[];
    /** 当前请求的中止身份。 */
    abort?: AbortController;
  };
  /** 关闭守卫状态，决议代次由 epoch 校验。 */
  close: {
    /** 是否正在等待守卫决议，避免重复调用。 */
    pending: boolean;
  };
}

const DEFAULT_AUTO_REMOVE_MS = 300;
/** 单次最外层批次最多发布的通知轮数，防止订阅者不收敛重入阻塞主线程。 */
const MAX_NOTIFY_ROUNDS = 100;
const EMPTY_STATE: OverlayState = Object.freeze({ active: Object.freeze([]) as readonly OverlayInstance[], queued: Object.freeze([]) as readonly string[] });

/** 队列排序：先判 replace(jumped)，再比 priority(降序)，最后 FIFO(seq)。 */
function cmpEntry(a: Entry, b: Entry): number {
  if (a.replaceJumped !== b.replaceJumped) return a.replaceJumped ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.seq - b.seq;
}

/** 管理串行槽、叠加条目和批次内生命周期。 */
class LayermanImpl implements Layerman {
  /** 嵌套变更深度，排空期间保持为一。 */
  private depth = 0;
  /** 等待重评的槽。 */
  private dirtySlots = new Set<string>();
  /** 已提交状态对应的宿主副作用。 */
  private effects: Array<() => void> = [];
  /** 批次末需要刷新快照。 */
  private needEmit = false;
  /** 当前快照尚未通知的订阅者，重入排空后接续。 */
  private pendingListeners: Array<(state: OverlayState) => void> = [];
  /** 条件求值深度，期间禁止变更。 */
  private judging = 0;
  /** 正在释放，禁止回调重新登记条目。 */
  private destroying = false;
  /** 已完成释放。 */
  private destroyed = false;

  /** 合并嵌套变更，先稳定调度，再执行副作用，最后通知。 */
  private batch<T>(fn: () => T): T {
    this.depth++;
    try {
      return fn();
    } finally {
      if (this.depth === 1) {
        try {
          let notifyRounds = 0;
          let notificationsStopped = false;
          let finalFanoutPending = false;
          while (this.dirtySlots.size || this.effects.length || this.needEmit || this.pendingListeners.length || finalFanoutPending) {
            while (this.dirtySlots.size) {
              const slots = [...this.dirtySlots];
              this.dirtySlots.clear();
              for (const slot of slots) this.scheduleNow(slot);
            }
            const effect = this.effects.shift();
            if (effect) this.safeInvoke(effect);
            else if (this.needEmit || this.pendingListeners.length) {
              if (this.needEmit && !notificationsStopped) {
                if (notifyRounds >= MAX_NOTIFY_ROUNDS) {
                  notificationsStopped = true;
                  finalFanoutPending = true;
                  this.reportNotifyLimit();
                } else notifyRounds++;
              }
              this.emitNow(!notificationsStopped);
            } else if (finalFanoutPending) {
              finalFanoutPending = false;
              const snapshot = this.snap;
              // 固定快照和名单；回调内的变更留给后续静默排空，不再补发。
              const listeners = [...this.subscribers];
              for (const listener of listeners) {
                if (this.subscribers.has(listener)) this.safeInvoke(() => listener(snapshot));
              }
            }
          }
          if (this.destroyed) this.subscribers.clear();
        } finally {
          this.depth--;
        }
      } else this.depth--;
    }
  }

  /** 条件求值期间拒绝任何变更，且不触碰状态。 */
  private assertMutable(): void {
    if (this.judging) throw new Error("[layerman] 条件求值期间禁止修改管理器");
  }

  private gap: number;
  private autoRemoveDefault: boolean | number;
  private now: () => number;
  private debug: boolean;
  private logger?: (message: string) => void;
  private storageKey: string;

  private cooldown: CooldownStore;
  private context: OverlayContext = {};

  private queues = new Map<string, Entry[]>();
  private serial = new Map<string, Entry>(); // 每 slot 的占用者（resolving/open/closing）
  private overlapping: Entry[] = [];
  private pendingOverlaps: Entry[] = []; // 因暂停或异步 hydrate 持有的 overlap
  private byId = new Map<string, Entry>();
  private lastClosedAt = new Map<string, number>();
  private openTimers = new Map<string, Timer>();

  private startedAt: number;
  private seqCounter = 0;
  private keyCounter = 0;
  /** 真正进入展示态时递增的层序计数。 */
  private enteredCounter = 0;
  private idCounter = 0;
  private paused = false;

  private subscribers = new Set<(state: OverlayState) => void>();
  private snap: OverlayState = EMPTY_STATE;

  private channel?: BroadcastChannel;
  private readyPromise: Promise<void>;

  /** 读取配置、初始化冷却存储与跨标签页广播，并绑定可裸引用的方法。 */
  constructor(options: LayermanOptions = {}) {
    this.gap = options.gap ?? 0;
    this.autoRemoveDefault = options.autoRemove ?? true;
    this.now = options.now ?? Date.now;
    this.debug = options.debug ?? false;
    this.logger = options.logger;
    this.storageKey = options.storageKey ?? "layerman:v1";
    this.startedAt = this.now();

    const storage = options.storage ?? defaultStorage();
    this.cooldown = new CooldownStore(storage, this.storageKey);
    this.readyPromise = this.cooldown.hydrate().then(() => {
      if (this.destroying || this.destroyed) return;
      this.batch(() => {
        for (const slot of this.queues.keys()) this.schedule(slot);
        this.removeCappedOverlaps();
        this.resumePending();
      });
    });

    const wantCrossTab = options.crossTab ?? (typeof BroadcastChannel !== "undefined" && typeof window !== "undefined");
    if (wantCrossTab && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`${this.storageKey}:sync`);
      (this.channel as BroadcastChannel & { /** Node 中释放事件循环引用。 */ unref?: () => void }).unref?.();
      this.channel.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { id?: string; rec?: CooldownRecord } | null;
        if (msg && typeof msg.id === "string" && msg.rec) {
          if (this.destroying || this.destroyed) return;
          this.batch(() => {
            this.cooldown.mergeRemote(msg.id!, msg.rec!);
            this.removeCappedOverlaps();
            for (const slot of this.queues.keys()) this.schedule(slot);
          });
        }
      };
    }

    // 绑定对外「可作裸引用传递」的方法（React useSyncExternalStore 会直接传 m.subscribe/m.getSnapshot，
    // 类方法裸引用会丢 this）。绑定后任意消费者都可安全解构/传引用。
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.getServerSnapshot = this.getServerSnapshot.bind(this);
    this.get = this.get.bind(this);
  }

  /** 等冷却状态 hydrate 完成。 */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /* ── 日志 ── */
  /** 开启 debug 时输出状态跃迁日志。 */
  private log(id: string, state: LogState): void {
    this.logMessage(`[layerman]:${id}:${state}`);
  }

  /** 通过统一日志通道输出调试消息，隔离宿主日志异常。 */
  private logMessage(message: string): void {
    try {
      if (this.debug) {
        if (this.logger) this.logger(message);
        else console.log(message);
      }
    } catch {
      /* 日志异常不影响状态推进。 */
    }
  }

  /** 超限诊断不受 debug 限制，隔离宿主日志异常。 */
  private reportNotifyLimit(): void {
    const message = `[layerman] 订阅者重入通知超过 ${MAX_NOTIFY_ROUNDS} 轮，已停止补发，请确认订阅者里的变更有收敛条件`;
    try {
      if (this.logger) this.logger(message);
      else if (typeof console !== "undefined") console.warn(message);
    } catch {
      /* 日志异常不影响最终扇出和状态推进。 */
    }
  }

  /** 安全调用宿主回调：抛错不应打断内部状态推进（emit/schedule 等后续步骤仍需执行）。 */
  private safeInvoke(fn?: () => void): void {
    if (!fn) return;
    try {
      fn();
    } catch {
      /* 宿主回调抛错——已忽略，不影响内部状态机推进 */
    }
  }

  /* ── 入口：open ── */
  /** 入口：登记一个 overlay，处理同 id 覆盖 / overlap / replace，返回带 result 的句柄。 */
  open<TData = unknown, TResult = unknown>(config: OverlayConfig<TData>): OverlayHandle<TResult> {
    this.assertMutable();
    if (this.destroying || this.destroyed) return { id: config.id || this.genId(), result: Promise.resolve({ dismissed: true, reason: DismissReason.destroyed }) };
    return this.batch(() => this.openImpl<TData, TResult>(config));
  }

  /** 在批次内提交变更。 */
  private openImpl<TData = unknown, TResult = unknown>(config: OverlayConfig<TData>): OverlayHandle<TResult> {
    const slot = config.slot ?? "";
    const id = config.id || this.genId();
    const entry = this.createEntry(config as OverlayConfig, slot, id) as Entry;
    const handle: OverlayHandle<TResult> = {
      id: entry.id,
      result: new Promise<TResult | DismissResult>((res, rej) => {
        entry.settle = (v) => res(v as TResult | DismissResult);
        entry.fail = rej;
      }),
    };

    const existing = this.byId.get(entry.id);
    let immediateActivate = false;
    if (existing) {
      if (this.isActive(existing)) {
        // 正在展示 → 无条件顶替（自更新语义：同 id 重开 = 用新配置替换当前实例，不受
        // conditions/cooldown 门控——cooldown 会读到该 id 自己首次 open 记的 count，门控会把
        // 「cooldown + 重开更新 data」这个常见写法误拦掉）。旧的丢弃不回队列。
        this.discardActive(existing);
        entry.replaceJumped = true;
        entry.skipGap = true;
        // 自更新语义：同一次连续展示不应重复计冷却（否则 N 次自更新会把 total/day/hour/minute
        // 计到 N 次，可能把与本次展示无关的未来真实展示永久拦死）。
        entry.exemptCooldown = true;
        if (existing.slot !== slot) this.schedule(existing.slot);
        // 目标 slot 当下空闲、未暂停、非 overlap 时直接接管，不经过 schedule() 的逐项资格过滤——
        // 否则会被自身 cooldown/条件拦下，换了 slot 时甚至会落回普通队列后永久卡住（result 都不会
        // settle）。paused 时必须遵守 pauseAll 的「全量冻结」（不变量 5c），退化为正常入队等
        // resume；目标 slot 被别的活跃者占用时也退化为正常排队——那是与「自更新」无关的槽位竞争。
        if (!config.overlap && !this.paused && !this.serial.has(slot)) immediateActivate = true;
      } else {
        // 在队列 → 覆盖旧的那条
        this.removeFromQueue(existing);
        this.byId.delete(existing.id);
        this.finalizeRemoved(existing, DismissReason.replaced);
      }
    }

    this.byId.set(entry.id, entry);
    if (existing) this.emit();
    this.log(entry.id, LOG_STATE.pending);

    if (this.isCapped(entry)) {
      this.removeImpl(entry.id, DismissReason.capped);
      return handle;
    }

    if (immediateActivate && !this.needsHydration(entry)) {
      this.activate(entry);
      return handle;
    }

    if (config.overlap) {
      if (this.needsHydration(entry)) {
        this.pendingOverlaps.push(entry);
      } else if (this.evaluate(entry) === ELIGIBILITY.pass) {
        if (this.paused)
          this.pendingOverlaps.push(entry); // 暂停中：冻结，resume 时再叠加
        else this.openOverlap(entry);
      } else {
        this.byId.delete(entry.id);
        this.finalizeRemoved(entry, DismissReason.unmet);
      }
      // overlap 不占用 serial 槽；若上面的自更新分支刚 discardActive() 腾空了本 slot 的槽位，
      // 必须重新调度，否则该 slot 队列里排在后面的条目会一直卡住，直到某个不相关事件碰到这个 slot。
      this.schedule(slot);
      return handle;
    }

    // replace 仅在替换者「当下就够资格显示」且未暂停时才生效；否则不该顶掉当前活跃者，
    // 退化为普通排队等待（避免「把当前弹窗顶掉、自己却因条件/冷却/暂停显示不出来」）。
    if (!this.paused && config.replace && this.evaluate(entry) === ELIGIBILITY.pass) {
      const cur = this.serial.get(slot);
      entry.skipGap = true;
      if (cur && this.isActive(cur)) {
        entry.replaceJumped = true;
        // closing 态的已经在走关闭流程：直接丢弃，别退回队列把它复活
        if (!cur.affix) {
          if (cur.phase === LOG_STATE.closing) this.discardActive(cur);
          else this.displace(cur);
        }
      }
    }

    this.enqueue(entry);
    this.schedule(slot);
    this.emit(); // 批次排空前仍在排队，让 queued 变化可观测
    return handle;
  }

  /** 生成自动 id；跳过已被占用的（用户可能显式用了同名 id）。 */
  private genId(): string {
    let id: string;
    do {
      id = `__layerman_auto_${++this.idCounter}`;
    } while (this.byId.has(id));
    return id;
  }

  /** 由配置创建一个内部条目（初始 pending）。 */
  private createEntry(cfg: OverlayConfig, slot: string, id: string): Omit<Entry, "settle" | "fail"> {
    return {
      cfg,
      id,
      slot,
      priority: cfg.priority ?? 0,
      instanceKey: ++this.keyCounter,
      seq: ++this.seqCounter,
      enteredSeq: 0,
      epoch: 0,
      overlapping: false,
      affix: cfg.affix ?? false,
      replaceJumped: false,
      skipGap: false,
      exemptCooldown: false,
      resolveState: { hasPendingResolve: false, resolvePatches: [] },
      phase: LOG_STATE.pending,
      settled: false,
      timers: { paused: false },
      close: { pending: false },
    }; // 唯一调用方立即在 Promise 同步执行器内补齐 settle/fail。
  }

  /** 条目是否处于活跃态（resolving/open/closing）。 */
  private isActive(e: Entry): boolean {
    return e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing || e.phase === LOG_STATE.resolving;
  }

  /* ── 队列操作 ── */
  /** 放进所属 slot 的等待队列。 */
  private enqueue(entry: Entry): void {
    const q = this.queues.get(entry.slot);
    if (q) q.push(entry);
    else this.queues.set(entry.slot, [entry]);
  }

  /** 从等待队列摘掉（不在队列里则什么都不做）。 */
  private removeFromQueue(entry: Entry): void {
    const q = this.queues.get(entry.slot);
    this.pendingOverlaps = this.pendingOverlaps.filter((e) => e !== entry);
    this.schedule(entry.slot);
    if (!q) return;
    const i = q.indexOf(entry);
    if (i >= 0) q.splice(i, 1);
  }

  /* ── 条件 & 冷却 ── */
  /** 条件门控：when 优先，否则看 route / requiresAuth；when 抛错按不满足处理。 */
  private conditionsPass(entry: Entry): boolean {
    const cfg = entry.cfg;
    this.judging++;
    try {
      if (cfg.when) return cfg.when(this.context);
      if (cfg.route != null && !LayermanImpl.routeMatch(cfg.route, this.context.route)) return false;
      if (cfg.requiresAuth != null && cfg.requiresAuth !== !!this.context.auth) return false;
      return true;
    } catch {
      // 宿主 when() 抛错——视为条件不满足，不让异常打断 setContext/schedule 的整轮推进
      this.log(entry.id, entry.phase);
      return false;
    } finally {
      this.judging--;
    }
  }

  /** 路由匹配：字符串全等、数组包含、正则 test（先重置 lastIndex，避免 g/y 标志让结果交替）。 */
  private static routeMatch(pattern: string | string[] | RegExp, route: string | undefined): boolean {
    if (route == null) return false;
    if (typeof pattern === "string") return route === pattern;
    if (Array.isArray(pattern)) return pattern.includes(route);
    pattern.lastIndex = 0;
    return pattern.test(route);
  }

  /** 只读评估资格，按调用场景保留条件与冷却的短路顺序，不推进条目状态。 */
  private evaluate(
    entry: Entry,
    options: {
      /** 已展示项只复检条件，不重新扣算冷却资格。 */
      conditionsOnly?: boolean;
      /** 请求落地时允许按配置忽略条件，冷却仍复检。 */
      ignoreConditions?: boolean;
    } = {},
  ): (typeof ELIGIBILITY)[keyof typeof ELIGIBILITY] {
    if (!options.conditionsOnly) {
      if (this.needsHydration(entry)) return ELIGIBILITY.wait;
      if (this.isCapped(entry)) return ELIGIBILITY.drop;
    }
    if (!options.ignoreConditions && !this.conditionsPass(entry)) return ELIGIBILITY.wait;
    if (!options.conditionsOnly && entry.cfg.cooldown && !entry.exemptCooldown && !this.cooldown.canShow(entry.id, entry.cfg.cooldown, this.now())) return ELIGIBILITY.wait;
    return ELIGIBILITY.pass;
  }

  /** 历史未读取时，带持久化冷却的条目必须等待。 */
  private needsHydration(entry: Entry): boolean {
    return !!entry.cfg.cooldown && this.cooldown.needsHydration(entry.cfg.cooldown);
  }

  /** 只读判断永久受阻，保留连续展示的冷却豁免。 */
  private isCapped(entry: Entry): boolean {
    return !entry.exemptCooldown && !!entry.cfg.cooldown && !this.needsHydration(entry) && this.cooldown.isCapped(entry.id, entry.cfg.cooldown);
  }

  /** 立即清理暂停或 hydrate 期间持有的永久耗尽叠加项。 */
  private removeCappedOverlaps(): void {
    for (const entry of this.pendingOverlaps) {
      if (this.isCapped(entry)) this.removeImpl(entry.id, DismissReason.capped);
    }
  }

  /* ── 调度（每 slot 独立；等待期不锁定候选） ── */
  /** 重评某 slot：槽空闲时挑出第一个合格候选，按 gap/delay 等待或直接激活。 */
  private schedule(slot: string): void {
    this.dirtySlots.add(slot);
    if (!this.depth) this.batch(() => {});
  }

  /** 实际重评槽并清除失效开场计时器。 */
  private scheduleNow(slot: string): void {
    // 槽被占用（resolving/open/closing）
    const t = this.openTimers.get(slot);
    if (t != null) {
      clearTimeout(t);
      this.openTimers.delete(slot);
    }
    if (this.destroying || this.destroyed) return;
    for (const entry of (this.queues.get(slot) ?? []).slice()) {
      if (this.isCapped(entry)) this.removeImpl(entry.id, DismissReason.capped);
    }
    if (this.paused || this.serial.has(slot)) return;
    const q = this.queues.get(slot);
    if (!q || q.length === 0) return;

    const sorted = q.slice().sort(cmpEntry);
    let front: Entry | undefined;
    for (const e of sorted) {
      if (this.evaluate(e) === ELIGIBILITY.pass) {
        front = e;
        break;
      }
    }
    if (!front) return;

    const base = this.lastClosedAt.get(slot) ?? this.startedAt;
    const wait = front.skipGap ? 0 : Math.max(0, (front.cfg.delay ?? this.gap) - (this.now() - base));
    if (wait > 0) {
      const timer = setTimeout(() => {
        this.openTimers.delete(slot);
        this.schedule(slot);
      }, wait);
      this.openTimers.set(slot, timer);
      return;
    }
    this.activate(front);
  }

  /** 让条目进入展示流程：有 resolve 先占槽请求数据，否则直接 open。 */
  private activate(entry: Entry): void {
    this.removeFromQueue(entry);
    if (entry.cfg.resolve) {
      entry.resolveState.resolvePatches = [];
      entry.epoch++;
      entry.phase = LOG_STATE.resolving;
      this.serial.set(entry.slot, entry); // 占位，resolving 期间不被插队打断
      this.log(entry.id, LOG_STATE.resolving);
      const ac = new AbortController();
      entry.resolveState.abort = ac;
      const run = entry.cfg.resolve;
      // 本次请求已被 abort（被顶掉/移除，甚至同一条目重新激活了）就丢弃结果，别污染新一轮
      const land = (data: unknown): void => {
        if (ac.signal.aborted || entry.resolveState.abort !== ac) return;
        this.batch(() => this.onResolved(entry, data));
      };
      Promise.resolve()
        .then(() => run(ac.signal))
        .then(
          (data) => land(data),
          () => land(null),
        );
      return;
    }
    this.doOpen(entry);
  }

  /** resolve 请求落地（身份已由 land 校验）：暂停中先缓存，否则收尾。 */
  private onResolved(entry: Entry, data: unknown): void {
    if (this.paused) {
      // 暂停期间不得变为活跃（pauseAll 是全量冻结）：记下结果，resumeAll 时再处理。
      entry.resolveState.hasPendingResolve = true;
      entry.resolveState.pendingResolveData = data;
      return;
    }
    this.finishResolve(entry, data);
  }

  /** resolve 结果的收尾：空数据则移除；请求期间条件/冷却变了就退回队列重排，否则展示。 */
  private finishResolve(entry: Entry, data: unknown): void {
    const patches = entry.resolveState.resolvePatches;
    entry.resolveState.resolvePatches = [];
    if (data === null || data === undefined) {
      this.serial.delete(entry.slot);
      this.byId.delete(entry.id);
      this.finalizeRemoved(entry, DismissReason.empty);
      this.emit();
      this.schedule(entry.slot);
      return;
    }
    // 条件不满足仅在 dismissWhenUnmet !== false 时退回（与 setContext 对已展示项的语义一致）；冷却始终复检
    const verdict = this.evaluate(entry, { ignoreConditions: entry.cfg.dismissWhenUnmet === false });
    if (verdict === ELIGIBILITY.drop) {
      this.removeImpl(entry.id, DismissReason.capped);
      return;
    }
    if (verdict === ELIGIBILITY.wait) {
      // 请求期间 setContext 改了 route/auth 等：不展示，退回队列等再次合格（该项不合格，schedule 不会空转）
      this.serial.delete(entry.slot);
      entry.resolveState.abort = undefined;
      entry.phase = LOG_STATE.pending;
      this.enqueue(entry);
      this.log(entry.id, LOG_STATE.pending);
      this.emit();
      this.schedule(entry.slot);
      return;
    }
    for (const patch of patches) data = LayermanImpl.mergeData(data, patch);
    entry.cfg = { ...entry.cfg, data };
    this.doOpen(entry);
  }

  /** 串行展示：占槽、置 open 并走统一的展示后流程。 */
  private doOpen(entry: Entry): void {
    this.serial.set(entry.slot, entry);
    entry.epoch++;
    entry.resolveState.abort = undefined;
    entry.phase = LOG_STATE.open;
    this.markShown(entry);
  }

  /** 叠加展示：不占串行槽，登记进 overlapping 后走统一的展示后流程。 */
  private openOverlap(entry: Entry): void {
    entry.overlapping = true;
    entry.epoch++;
    entry.resolveState.abort = undefined;
    entry.phase = LOG_STATE.open;
    this.overlapping.push(entry);
    this.markShown(entry);
  }

  /** 展示后记冷却并启动倒计时，再登记展示钩子与通知。 */
  private markShown(entry: Entry): void {
    entry.enteredSeq = ++this.enteredCounter;
    if (!entry.exemptCooldown && entry.cfg.cooldown) {
      const rec = this.cooldown.record(entry.id, entry.cfg.cooldown, this.now());
      if (rec && this.channel) this.channel.postMessage({ id: entry.id, rec });
    }
    entry.exemptCooldown = false;
    this.log(entry.id, LOG_STATE.open);
    if (entry.cfg.duration != null) this.startDuration(entry);
    this.effects.push(() => this.safeInvoke(entry.cfg.onShow));
    this.emit();
  }

  /** 把条目从活跃态拆下来：清定时器、中止 resolve、让出串行槽、退出 overlap 列表。返回它是否占着串行槽。 */
  private detach(e: Entry): boolean {
    this.clearTimers(e);
    const abort = e.resolveState.abort;
    e.resolveState.abort = undefined;
    e.resolveState.hasPendingResolve = false;
    e.resolveState.pendingResolveData = undefined;
    e.resolveState.resolvePatches = [];
    e.close.pending = false;
    if (abort) this.effects.push(() => abort.abort());
    const wasSerial = this.serial.get(e.slot) === e;
    if (wasSerial) this.serial.delete(e.slot);
    if (e.overlapping) {
      this.overlapping = this.overlapping.filter((x) => x !== e);
      e.overlapping = false;
    }
    return wasSerial;
  }

  /** 被 replace 顶掉的活跃者退回队列（按 priority 重排；从 open 态退回则重开豁免冷却）。 */
  private displace(cur: Entry): void {
    const wasOpen = cur.phase === LOG_STATE.open;
    this.detach(cur);
    cur.exemptCooldown ||= wasOpen; // 保留尚未消费的豁免
    cur.phase = LOG_STATE.pending;
    cur.replaceJumped = false;
    cur.skipGap = false;
    this.enqueue(cur);
    if (wasOpen) this.effects.push(() => this.safeInvoke(cur.cfg.onClose));
    this.log(cur.id, LOG_STATE.pending);
  }

  /** 同 id 重开时，丢弃正在展示的旧实例（不回队列）。 */
  private discardActive(existing: Entry): void {
    const wasOpen = existing.phase === LOG_STATE.open;
    this.detach(existing);
    this.byId.delete(existing.id);
    if (wasOpen) this.effects.push(() => this.safeInvoke(existing.cfg.onClose));
    this.finalizeRemoved(existing, DismissReason.replaced);
  }

  /* ── 关闭握手（两阶段） ── */
  /** 请求关闭；设计取舍，已文档化：有守卫时通过后统一在微任务内进入 closing。 */
  close(id: string): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.closeImpl(id));
  }

  /** 仅展示项执行关闭守卫，其余阶段保持不变。 */
  private closeImpl(id: string): void {
    const e = this.byId.get(id);
    if (!e || e.phase !== LOG_STATE.open || e.close.pending) return;
    const epoch = e.epoch;
    const guard = e.cfg.beforeClose;
    if (guard) {
      // beforeClose 关闭守卫：返回（或 Promise resolve）`false` 则取消本次关闭；其余值放行。
      // guard() 本身可能同步抛错——放进 try 里，视同守卫拒绝，不让异常穿透 close()。
      // close.pending 挡掉守卫决议期间的重复 close() 调用（如双击）——否则每次调用都会重新触发一次
      // 可能带副作用（确认弹窗/埋点/网络请求）的宿主守卫。
      e.close.pending = true;
      let result: boolean | Promise<boolean>;
      try {
        result = guard();
      } catch {
        e.close.pending = false;
        return;
      }
      Promise.resolve(result).then(
        (ok) =>
          this.batch(() => {
            if (e.epoch !== epoch) return;
            e.close.pending = false;
            if (ok !== false && this.byId.get(id) === e && e.phase === LOG_STATE.open) this.doClose(e);
          }),
        () => {
          if (e.epoch !== epoch) return;
          /* 守卫抛错 → 视为取消关闭 */
          e.close.pending = false;
        },
      );
      return;
    }
    this.doClose(e);
  }

  /** 进入 closing：清 duration、触发 onClose，再按需安排自动移除。 */
  private doClose(e: Entry): void {
    e.close.pending = false;
    e.phase = LOG_STATE.closing;
    this.clearDuration(e);
    this.log(e.id, LOG_STATE.closing);
    this.effects.push(() => this.safeInvoke(e.cfg.onClose));
    this.emit();
    this.scheduleAutoRemove(e);
  }

  /** 安排关闭后的自动移除；暂停期间只记剩余时长，恢复时再启动。 */
  private scheduleAutoRemove(e: Entry): void {
    const ar = e.cfg.autoRemove ?? this.autoRemoveDefault;
    if (ar === false) return;
    const ms = ar === true ? DEFAULT_AUTO_REMOVE_MS : ar;
    if (this.paused || e.timers.paused) {
      e.timers.autoRemoveRemaining = ms;
      return;
    }
    this.armAutoRemove(e, ms);
  }

  /** 启动自动移除定时器；触发时确认仍是 byId 里的那个实例才移除。 */
  private armAutoRemove(e: Entry, ms: number): void {
    e.timers.autoRemoveEndsAt = this.now() + ms;
    e.timers.autoRemoveTimer = setTimeout(() => {
      e.timers.autoRemoveTimer = undefined;
      if (this.byId.get(e.id) === e) this.remove(e.id);
    }, ms);
  }

  /** 启动 duration 定时器；触发时确认仍是 byId 里的那个实例才 close。 */
  private armDuration(e: Entry, ms: number): void {
    const epoch = e.epoch;
    e.timers.durationEndsAt = this.now() + ms;
    e.timers.durationTimer = setTimeout(() => {
      if (e.epoch !== epoch) return;
      e.timers.durationTimer = undefined;
      if (this.byId.get(e.id) === e) this.close(e.id);
    }, ms);
  }

  /** 彻底移除一个条目（活跃或排队皆可），兑现 result 并重评所在 slot。 */
  remove(id: string): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.removeImpl(id));
  }

  /** 原子摘除并按显式原因或当前关闭阶段兑现结果。 */
  private removeImpl(id: string, reason?: DismissReason): void {
    const e = this.byId.get(id);
    if (!e) return;
    this.byId.delete(id);
    if (this.detach(e)) this.lastClosedAt.set(e.slot, this.now());
    this.removeFromQueue(e);
    this.finalizeRemoved(e, reason ?? (e.phase === LOG_STATE.closing ? DismissReason.closed : DismissReason.removed));
    this.emit();
    // 无论移除的是活跃者还是队列项，都重评该 slot：
    // 移除队首候选后需重新挑选，并清掉可能残留的过期 open 定时器。
    this.schedule(e.slot);
  }

  /** 条目离场的统一收尾：记日志、触发 onRemove、兑现 result。 */
  private finalizeRemoved(e: Entry, reason: DismissReason): void {
    this.log(e.id, LOG_STATE.closed);
    this.effects.push(() => this.safeInvoke(e.cfg.onRemove));
    this.settleDismiss(e, reason);
  }

  /** 尚未兑现时附上被动结束原因并兑现结果。 */
  private settleDismiss(e: Entry, reason: DismissReason): void {
    if (e.settled) return;
    e.settled = true;
    e.settle({ dismissed: true, reason });
  }

  /* ── result 投递 ── */
  /** 向曾展示的条目投递成功值；未展示或已兑现时忽略。 */
  resolve(id: string, value: unknown): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.resolveImpl(id, value));
  }

  /** 仅向曾经展示且尚未兑现的条目投递成功值。 */
  private resolveImpl(id: string, value: unknown): void {
    const e = this.byId.get(id);
    if (!e || e.settled || e.enteredSeq === 0) return;
    e.settled = true;
    e.settle(value);
  }

  /** 拒绝曾展示条目的结果；未展示或已兑现时忽略。 */
  reject(id: string, error: unknown): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.rejectImpl(id, error));
  }

  /** 仅向曾经展示且尚未兑现的条目投递错误。 */
  private rejectImpl(id: string, error: unknown): void {
    const e = this.byId.get(id);
    if (!e || e.settled || e.enteredSeq === 0) return;
    e.settled = true;
    e.fail(error);
  }

  /** 就地更新数据，仅展示或关闭中的条目通知渲染，不触发队列变更。 */
  update(id: string, patch: unknown): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.updateImpl(id, patch));
  }

  /** 在批次内提交变更。 */
  private updateImpl(id: string, patch: unknown): void {
    const e = this.byId.get(id);
    if (!e) return;
    const active = e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing;
    if (active && LayermanImpl.isUnchangedPatch(e.cfg.data, patch)) return;
    e.cfg = { ...e.cfg, data: LayermanImpl.mergeData(e.cfg.data, patch) };
    if (e.phase === LOG_STATE.resolving) e.resolveState.resolvePatches.push(patch);
    if (active) this.emit();
  }

  /** 按浅合并的可枚举键判断补丁是否保持原值，兼顾符号键与 Object.is 语义。 */
  private static isUnchangedPatch(prev: unknown, patch: unknown): boolean {
    if (prev && typeof prev === "object" && patch && typeof patch === "object") {
      return Reflect.ownKeys(patch)
        .filter((key) => Object.prototype.propertyIsEnumerable.call(patch, key))
        .every((key) => Object.is(Reflect.get(prev, key), Reflect.get(patch, key)));
    }
    return Object.is(prev, patch);
  }

  /** 对象浅合并，其余数据按补丁整体替换。 */
  private static mergeData(prev: unknown, patch: unknown): unknown {
    return prev && typeof prev === "object" && patch && typeof patch === "object" ? { ...(prev as object), ...(patch as object) } : patch;
  }

  /** 全部受管条目的轻量快照（供 clear 选择器判断）。 */
  private records(): OverlayRecord[] {
    const recs: OverlayRecord[] = [];
    for (const e of this.byId.values()) {
      recs.push({ id: e.id, data: e.cfg.data, slot: e.slot, phase: e.phase, active: this.isActive(e) });
    }
    return recs;
  }

  /* ── 清空 ── */
  /** 清理：传选择器精确清理，否则清空等待队列（可选连活跃一起关）。 */
  clear(arg?: ClearSelector | { closeActive?: boolean }): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.clearImpl(arg));
  }

  /** 在批次内提交变更。 */
  private clearImpl(arg?: ClearSelector | { closeActive?: boolean }): void {
    const records = this.records();
    const picked = typeof arg === "function" ? arg(this.context, records) : undefined;
    const ids = typeof arg === "function" ? (Array.isArray(picked) ? picked : records.map((r) => r.id)) : records.filter((r) => arg?.closeActive || r.phase === LOG_STATE.pending).map((r) => r.id);
    for (const id of ids) this.removeImpl(id, this.destroying ? DismissReason.destroyed : DismissReason.cleared);
  }

  /* ── 上下文（push 模型，触发重评） ── */
  /** 推入上下文并重评：撤下条件不再满足的已展示项，再重新调度各 slot。 */
  setContext(partial: Partial<OverlayContext>): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.setContextImpl(partial));
  }

  /** 在批次内提交变更。 */
  private setContextImpl(partial: Partial<OverlayContext>): void {
    this.context = { ...this.context, ...partial };
    // 已展示(open/closing)但条件不再满足者：dismissWhenUnmet(默认 true) 时自动撤下并推进下一个。
    for (const e of [...this.serial.values(), ...this.overlapping]) {
      if ((e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing) && e.cfg.dismissWhenUnmet !== false && this.evaluate(e, { conditionsOnly: true }) === ELIGIBILITY.wait) {
        this.removeImpl(e.id, DismissReason.unmet);
      }
    }
    for (const slot of this.queues.keys()) this.schedule(slot);
  }

  /* ── 暂停 / 恢复 ── */
  /** 全量冻结：停掉开场计时与所有倒计时，期间不放行任何新展示。 */
  pauseAll(): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.pauseAllImpl());
  }

  /** 在批次内提交变更。 */
  private pauseAllImpl(): void {
    if (this.paused) return;
    this.paused = true;
    for (const [slot, t] of this.openTimers) {
      clearTimeout(t);
      this.openTimers.delete(slot);
    }
    for (const e of this.byId.values()) {
      this.freezeDuration(e);
      this.freezeAutoRemove(e);
    }
  }

  /** 解除全量冻结，放行暂停期间积压的 overlap / resolve 结果并恢复倒计时。 */
  resumeAll(): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.resumeAllImpl());
  }

  /** 在批次内提交变更。 */
  private resumeAllImpl(): void {
    if (!this.paused) return;
    this.paused = false;
    this.resumePending();
  }

  /** 逐个放行，前一项钩子执行后重新检查暂停与身份。 */
  private resumePending(): void {
    if (this.paused || this.destroying || this.destroyed) return;
    const index = this.pendingOverlaps.findIndex((entry) => !this.needsHydration(entry));
    const e = index < 0 ? undefined : this.pendingOverlaps.splice(index, 1)[0];
    if (e) {
      if (this.evaluate(e) === ELIGIBILITY.pass) this.openOverlap(e);
      else {
        this.byId.delete(e.id);
        this.finalizeRemoved(e, this.isCapped(e) ? DismissReason.capped : DismissReason.unmet);
      }
      this.effects.push(() => this.resumePending());
      return;
    }
    const resolved = [...this.serial.values()].find((entry) => entry.resolveState.hasPendingResolve);
    if (resolved) {
      resolved.resolveState.hasPendingResolve = false;
      const data = resolved.resolveState.pendingResolveData;
      resolved.resolveState.pendingResolveData = undefined;
      this.finishResolve(resolved, data);
      this.effects.push(() => this.resumePending());
      return;
    }
    for (const entry of this.byId.values()) {
      this.thawDuration(entry);
      this.thawAutoRemove(entry);
    }
    for (const slot of this.queues.keys()) this.schedule(slot);
  }

  /** 暂停单个条目的倒计时。 */
  pause(id: string): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.pauseImpl(id));
  }

  /** 在批次内提交变更。 */
  private pauseImpl(id: string): void {
    const e = this.byId.get(id);
    if (!e || e.timers.paused) return;
    e.timers.paused = true;
    this.freezeDuration(e);
    this.freezeAutoRemove(e);
  }

  /** 恢复单个条目的倒计时。 */
  resume(id: string): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.resumeImpl(id));
  }

  /** 在批次内提交变更。 */
  private resumeImpl(id: string): void {
    const e = this.byId.get(id);
    if (!e || !e.timers.paused) return;
    e.timers.paused = false;
    this.thawDuration(e);
    this.thawAutoRemove(e);
  }

  /** 开始 duration 倒计时；暂停期间只记剩余时长。 */
  private startDuration(e: Entry): void {
    const ms = e.cfg.duration!;
    if (this.paused || e.timers.paused) {
      e.timers.durationRemaining = ms;
      return;
    }
    this.armDuration(e, ms);
  }

  /** 冻结 duration 倒计时，记下剩余毫秒。 */
  private freezeDuration(e: Entry): void {
    if (e.timers.durationTimer == null) return;
    clearTimeout(e.timers.durationTimer);
    e.timers.durationTimer = undefined;
    e.timers.durationRemaining = Math.max(0, e.timers.durationEndsAt! - this.now());
  }

  /** 恢复 duration 倒计时（仍暂停或不在 open 态则不动）。 */
  private thawDuration(e: Entry): void {
    if (this.paused || e.timers.paused) return;
    if (e.timers.durationRemaining == null || e.phase !== LOG_STATE.open) return;
    const ms = e.timers.durationRemaining;
    e.timers.durationRemaining = undefined;
    this.armDuration(e, ms);
  }

  /** 冻结「关闭后自动移除」的倒计时（pause/pauseAll）——否则 closing 期间暂停的弹窗仍会被
   * 未被冻结的 autoRemove 定时器如期移除，与「暂停」的直觉矛盾。 */
  private freezeAutoRemove(e: Entry): void {
    if (e.timers.autoRemoveTimer == null) return;
    clearTimeout(e.timers.autoRemoveTimer);
    e.timers.autoRemoveTimer = undefined;
    e.timers.autoRemoveRemaining = Math.max(0, e.timers.autoRemoveEndsAt! - this.now());
  }

  /** 恢复自动移除倒计时（仍暂停则不动）。 */
  private thawAutoRemove(e: Entry): void {
    if (this.paused || e.timers.paused) return;
    if (e.timers.autoRemoveRemaining == null) return;
    const ms = e.timers.autoRemoveRemaining;
    e.timers.autoRemoveRemaining = undefined;
    this.armAutoRemove(e, ms);
  }

  /** 清掉 duration 定时器和剩余时长。 */
  private clearDuration(e: Entry): void {
    if (e.timers.durationTimer != null) {
      clearTimeout(e.timers.durationTimer);
      e.timers.durationTimer = undefined;
    }
    e.timers.durationRemaining = undefined;
  }

  /** 清掉条目上所有计时（duration + 自动移除）。 */
  private clearTimers(e: Entry): void {
    this.clearDuration(e);
    e.timers.autoRemoveRemaining = undefined;
    if (e.timers.autoRemoveTimer != null) {
      clearTimeout(e.timers.autoRemoveTimer);
      e.timers.autoRemoveTimer = undefined;
    }
  }

  /* ── 快照 & 订阅 ── */
  /** 标记批次末需要刷新快照。 */
  private emit(): void {
    this.needEmit = true;
  }

  /** 发布或接续快照通知；超限时仅刷新快照并清理待通知项。 */
  private emitNow(notify = true): void {
    if (this.needEmit) {
      this.needEmit = false;
      const actives: Entry[] = [];
      for (const e of this.serial.values()) {
        if (e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing) actives.push(e);
      }
      for (const e of this.overlapping) {
        actives.push(e);
      }
      actives.sort((a, b) => a.enteredSeq - b.enteredSeq);
      // stackIndex = 叠加渲染层序（入场序），isTopmost = 最上层。headless 不设 z-index，
      // 只把层序喂给宿主，由宿主算 z-index / 给非顶层加 pointer-events:none。
      const last = actives.length - 1;
      const active = actives.map((e, i) => LayermanImpl.toInstance(e, i, i === last));

      const queued: string[] = [];
      for (const q of this.queues.values()) for (const e of q) queued.push(e.id);

      this.snap = { active, queued };
      this.pendingListeners = notify ? [...this.subscribers] : [];
    }
    if (!notify) this.pendingListeners = [];
    // 只有可见变更才开启新一轮；仅调度或副作用时接续剩余订阅者。
    while (this.pendingListeners.length) {
      const listener = this.pendingListeners.shift()!;
      if (this.subscribers.has(listener)) this.safeInvoke(() => listener(this.snap));
      if (this.needEmit || this.dirtySlots.size || this.effects.length) break;
    }
  }

  /** 内部条目转对外的活跃实例。 */
  private static toInstance(e: Entry, stackIndex: number, isTopmost: boolean): OverlayInstance {
    return {
      id: e.id,
      data: e.cfg.data,
      slot: e.slot,
      phase: e.phase === LOG_STATE.closing ? OverlayPhase.closing : OverlayPhase.open,
      priority: e.priority,
      overlapping: e.overlapping,
      instanceKey: e.instanceKey,
      stackIndex,
      isTopmost,
    };
  }

  /** 订阅状态变化，返回取消订阅函数；`immediate` 为 true 时立即推送一次当前快照。 */
  subscribe(listener: (state: OverlayState) => void, options: { immediate?: boolean } = {}): () => void {
    this.subscribers.add(listener);
    if (options.immediate) listener(this.snap);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /** 当前状态快照（引用稳定，仅在变化时更换）。 */
  getSnapshot(): OverlayState {
    return this.snap;
  }

  /** 服务端渲染用的空快照。 */
  getServerSnapshot(): OverlayState {
    return EMPTY_STATE;
  }

  /** 按 id 取活跃实例，没有则 undefined。 */
  get(id: string): OverlayInstance | undefined {
    return this.snap.active.find((o) => o.id === id);
  }

  /* ── 释放 ── */
  /** 只读校验稳定边界的内部状态；不求值宿主谓词，也不触发通知或调度。 */
  // @ts-expect-error TS6133：诊断入口仅由测试经内部视图调用，生产路径刻意不引用。
  private checkInvariants(): void {
    /** 统一输出不变量编号及可定位的条目或槽位。 */
    const fail = (code: string, id: string, detail: string): never => {
      throw new Error(`[layerman] invariant ${code}: id=${id} ${detail}`);
    };
    const memberships = new Map<Entry, number>();
    const active: Entry[] = [];
    const destroyed = this.destroyed;
    if (destroyed) {
      const residual = this.byId.values().next().value ?? this.serial.values().next().value ?? this.overlapping[0] ?? this.pendingOverlaps[0];
      const queued = Array.from(this.queues.values()).flat();
      if (residual || queued.length || this.openTimers.size) fail("h", residual?.id ?? queued[0]?.id ?? this.openTimers.keys().next().value!, "销毁后仍有条目或计时器");
    }
    /** 统计容器成员并校验身份、阶段与串行槽归属。 */
    const visit = (e: Entry, kind: "queue" | "serial" | "overlap" | "pending", slot?: string): void => {
      if (this.byId.get(e.id) !== e) fail("b", e.id, "容器条目不属于 byId");
      memberships.set(e, (memberships.get(e) ?? 0) + 1);
      if (kind === "serial" && e.slot !== slot) fail("d", e.id, `串行槽不匹配 ${slot}`);
      const visible = e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing;
      if (kind === "queue" || kind === "pending") {
        if (e.phase !== LOG_STATE.pending) fail("c", e.id, "等待容器中的条目不是 pending");
        if (this.isCapped(e)) fail("i", e.id, "永久耗尽条目仍在等待容器");
        if (kind === "pending" && !this.paused && !this.needsHydration(e)) fail("j", e.id, "叠加等待项缺少暂停或 hydrate 原因");
      } else if (kind === "serial") {
        if (!visible && e.phase !== LOG_STATE.resolving) fail("c", e.id, "串行容器阶段非法");
        if (visible) active.push(e);
      } else {
        if (!visible || !e.overlapping) fail("c", e.id, "叠加容器阶段或标记非法");
        active.push(e);
      }
    };
    for (const q of this.queues.values()) for (const e of q) visit(e, "queue");
    for (const [slot, e] of this.serial) visit(e, "serial", slot);
    for (const e of this.overlapping) visit(e, "overlap");
    for (const e of this.pendingOverlaps) visit(e, "pending");
    for (const [id, e] of this.byId) {
      if (id !== e.id || memberships.get(e) !== 1) fail("a", id, "条目必须恰好属于一个容器");
      const paused = this.paused || e.timers.paused;
      if (e.timers.durationTimer != null && (e.phase !== LOG_STATE.open || paused)) fail("e", id, "durationTimer 要求 open 且未暂停");
      if (e.timers.autoRemoveTimer != null && (e.phase !== LOG_STATE.closing || paused)) fail("e", id, "autoRemoveTimer 要求 closing 且未暂停");
      if ((e.timers.durationRemaining != null || e.timers.autoRemoveRemaining != null) && !paused) fail("e", id, "剩余时长要求暂停");
      if (e.resolveState.abort != null && e.phase !== LOG_STATE.resolving) fail("e", id, "abort 要求 resolving");
      if (e.close.pending && e.phase !== LOG_STATE.open) fail("e", id, "closePending 要求 open");
      if (e.resolveState.hasPendingResolve && e.phase !== LOG_STATE.resolving) fail("e", id, "hasPendingResolve 要求 resolving");
    }
    for (const slot of this.openTimers.keys()) {
      if (this.paused || this.serial.has(slot) || !this.queues.get(slot)?.length) fail("f", this.queues.get(slot)?.[0]?.id ?? slot, "开场计时器没有合法等待队列");
    }
    active.sort((a, b) => a.enteredSeq - b.enteredSeq);
    const length = Math.max(active.length, this.snap.active.length);
    for (let i = 0; i < length; i++) {
      const expected = active[i];
      const actual = this.snap.active[i];
      if (!expected || !actual || expected.id !== actual.id || expected.instanceKey !== actual.instanceKey) fail("g", expected?.id ?? actual!.id, "活跃快照身份或顺序不一致");
    }
  }

  /** 释放：清定时器、清空条目、断开跨标签页广播、清订阅者。 */
  destroy(): void {
    this.assertMutable();
    if (this.destroying || this.destroyed) return;
    this.batch(() => this.destroyImpl());
  }

  /** 在批次内提交变更。 */
  private destroyImpl(): void {
    this.destroying = true;
    for (const t of this.openTimers.values()) clearTimeout(t);
    this.openTimers.clear();
    for (const e of this.byId.values()) this.clearTimers(e);
    this.clearImpl({ closeActive: true });
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = undefined;
    }
    this.destroyed = true;
    this.destroying = false;
  }
}

/** 创建一个 overlay 管理器实例。`await manager.ready()` 后开始工作（等冷却状态 hydrate）。 */
export function createLayerman(options?: LayermanOptions): Layerman {
  return new LayermanImpl(options);
}
