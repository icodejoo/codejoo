/**
 * @codejoo/overlaymanager — 框架无关的 headless overlay 队列管理器。
 *
 * 只负责「活跃 id + phase + 排序 + 门控 + 冷却 + 数据驱动」，**不碰任何 DOM/UI/动画**。
 * 渲染、蒙层、动画、z-index 全部由宿主完成；本包对外暴露响应式状态（`subscribe` +
 * `getSnapshot` + `get`），宿主据此渲染 `active` 列表即可。零运行时依赖。
 */

/* ────────────────────────────── 公共类型 ────────────────────────────── */

/** 时长（天/时/分/秒，四者可选，叠加求和）。例：`{ days: 1, hours: 1 }` = 1 天 1 小时。 */
export interface Duration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
}

/**
 * 冷却配置。出现的字段全部 **AND**（同时满足才允许显示），计数在真正 open 时 +1。
 * - `session`：本会话最多 N 次（仅内存，不持久化）。
 * - `total`：累计最多 N 次（持久化）。
 * - `day`/`hour`/`minute`：每自然日/时/分最多 N 次（按本地自然边界对齐，持久化）。
 * - `minGap`：距上次展示的最小间隔（滚动，持久化 lastShownAt）。
 */
export interface Cooldown {
  session?: number;
  total?: number;
  day?: number;
  hour?: number;
  minute?: number;
  minGap?: Duration;
}

/** 条件谓词上下文。保留键 `route`/`auth` 供内置糖使用，其余键自由，由宿主经 `setContext` 推入。 */
export interface OverlayContext {
  route?: string;
  auth?: boolean;
  [key: string]: unknown;
}

/** overlay 配置（`open` 的入参）。`id` 必传且唯一；`data` 对本包完全不透明。 */
export interface OverlayConfig<TData = unknown> {
  /** 唯一键。用于队列追踪、事件标识、冷却持久化。 */
  id: string;
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
   * 重叠显示。因为它不入队，条件/冷却在 open 时作一次性发射门：当下不满足则**直接丢弃**（result
   * 兑现 `{ dismissed: true }`），不会被保留到条件满足（「要么现在，要么不弹」；见 README）。
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

/** 被动关闭（未经 `resolve`/`reject`）时 result 的兑现值。 */
export interface DismissResult {
  dismissed: true;
}

/** `open` 的返回句柄。 */
export interface OverlayHandle<TResult = unknown> {
  id: string;
  /** await 拿结果；宿主经 `resolve(id, v)` 投递；被动关闭则以 `{ dismissed: true }` 兑现。 */
  result: Promise<TResult | DismissResult>;
}

/** 可注入存储（get/set 可同步可异步，兼容 localStorage 与 RN AsyncStorage）。 */
export interface AsyncableStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
}

/** `createOverlayManager` 配置。 */
export interface OverlayManagerOptions {
  /** 全局转场间隔毫秒，默认 0。 */
  gap?: number;
  /** 关闭后自动移除：`true`（=300ms）| 数字（自定毫秒）| `false`（纯手动）。默认 `true`。 */
  autoRemove?: boolean | number;
  /** 冷却持久化存储；默认有 `localStorage` 用它，否则纯内存。 */
  storage?: AsyncableStorage;
  /** 存储/广播键，默认 `overlay-manager:v1`。 */
  storageKey?: string;
  /** 时间源，默认 `Date.now`（供测试）。 */
  now?: () => number;
  /** 开启事件日志。 */
  debug?: boolean;
  /** 自定义日志输出，默认 `console.log`。 */
  logger?: (message: string) => void;
  /** 跨标签页同步冷却计数；浏览器有 `BroadcastChannel` 时默认 `true`。 */
  crossTab?: boolean;
}

/** 管理器实例接口。 */
export interface OverlayManager {
  open<TData = unknown, TResult = unknown>(config: OverlayConfig<TData>): OverlayHandle<TResult>;
  resolve(id: string, value: unknown): void;
  reject(id: string, error: unknown): void;
  /** 就地更新某条目 data（对象浅合并，否则替换），不触发队列变更。 */
  update(id: string, patch: unknown): void;
  close(id: string): void;
  remove(id: string): void;
  /** 清空。传选择器 `(ctx, records) => id[]` 精确清理（非数组=全部）；或 `{ closeActive }` 传统清队列。 */
  clear(arg?: ClearSelector | { closeActive?: boolean }): void;
  pauseAll(): void;
  resumeAll(): void;
  pause(id: string): void;
  resume(id: string): void;
  setContext(partial: Partial<OverlayContext>): void;
  subscribe(listener: (state: OverlayState) => void, options?: { immediate?: boolean }): () => void;
  getSnapshot(): OverlayState;
  getServerSnapshot(): OverlayState;
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

/** 冷却持久化记录（每 id 一条）。 */
interface CooldownRecord {
  total: number;
  dayBucket: string;
  dayCount: number;
  hourBucket: string;
  hourCount: number;
  minuteBucket: string;
  minuteCount: number;
  lastShownAt: number;
}

/** 内部队列/活跃条目。 */
interface Entry {
  cfg: OverlayConfig;
  id: string;
  slot: string;
  priority: number;
  instanceKey: number;
  seq: number;
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
  durationTimer?: Timer;
  durationEndsAt?: number;
  durationRemaining?: number;
  autoRemoveTimer?: Timer;
  paused: boolean;
  abort?: AbortController;
}

const DEFAULT_AUTO_REMOVE_MS = 300;
const EMPTY_STATE: OverlayState = Object.freeze({ active: Object.freeze([]) as readonly OverlayInstance[], queued: Object.freeze([]) as readonly string[] });

/** 队列排序：先判 replace(jumped)，再比 priority(降序)，最后 FIFO(seq)。 */
function cmpEntry(a: Entry, b: Entry): number {
  if (a.replaceJumped !== b.replaceJumped) return a.replaceJumped ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.seq - b.seq;
}

function durationToMs(d: Duration): number {
  return ((d.days ?? 0) * 24 * 60 * 60 + (d.hours ?? 0) * 60 * 60 + (d.minutes ?? 0) * 60 + (d.seconds ?? 0)) * 1000;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 本地自然日/时/分的桶标识。 */
function dayBucketOf(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function hourBucketOf(t: number): string {
  return `${dayBucketOf(t)}T${pad(new Date(t).getHours())}`;
}
function minuteBucketOf(t: number): string {
  return `${hourBucketOf(t)}:${pad(new Date(t).getMinutes())}`;
}

function defaultStorage(): AsyncableStorage | undefined {
  try {
    if (typeof localStorage !== "undefined") {
      return {
        get: (k) => localStorage.getItem(k),
        set: (k, v) => {
          localStorage.setItem(k, v);
        },
      };
    }
  } catch {
    /* 访问 localStorage 可能抛（隐私模式等）——退化为内存 */
  }
  return undefined;
}

/** 冷却存储：hydrate 一次后运行时全同步，写回 write-through。 */
class CooldownStore {
  private persisted = new Map<string, CooldownRecord>();
  private session = new Map<string, number>();
  private storage: AsyncableStorage | undefined;
  private storageKey: string;

  constructor(storage: AsyncableStorage | undefined, storageKey: string) {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  async hydrate(): Promise<void> {
    if (!this.storage) return;
    let raw: string | null;
    try {
      raw = await this.storage.get(this.storageKey);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, CooldownRecord>;
      for (const id of Object.keys(parsed)) this.persisted.set(id, parsed[id]);
    } catch {
      /* 坏数据忽略 */
    }
  }

  private flush(): void {
    if (!this.storage) return;
    const obj: Record<string, CooldownRecord> = {};
    for (const [id, rec] of this.persisted) obj[id] = rec;
    try {
      void this.storage.set(this.storageKey, JSON.stringify(obj));
    } catch {
      /* 写失败忽略 */
    }
  }

  canShow(id: string, cd: Cooldown, now: number): boolean {
    if (cd.session != null && (this.session.get(id) ?? 0) >= cd.session) return false;
    const rec = this.persisted.get(id);
    if (cd.total != null && (rec?.total ?? 0) >= cd.total) return false;
    if (cd.day != null) {
      const c = rec && rec.dayBucket === dayBucketOf(now) ? rec.dayCount : 0;
      if (c >= cd.day) return false;
    }
    if (cd.hour != null) {
      const c = rec && rec.hourBucket === hourBucketOf(now) ? rec.hourCount : 0;
      if (c >= cd.hour) return false;
    }
    if (cd.minute != null) {
      const c = rec && rec.minuteBucket === minuteBucketOf(now) ? rec.minuteCount : 0;
      if (c >= cd.minute) return false;
    }
    if (cd.minGap != null && rec?.lastShownAt != null && now - rec.lastShownAt < durationToMs(cd.minGap)) return false;
    return true;
  }

  /** 记一次展示（open 时调用）。返回持久化记录（用于跨标签页广播），无持久化字段时返回 undefined。 */
  record(id: string, cd: Cooldown, now: number): CooldownRecord | undefined {
    if (cd.session != null) this.session.set(id, (this.session.get(id) ?? 0) + 1);
    const needsPersist = cd.total != null || cd.day != null || cd.hour != null || cd.minute != null || cd.minGap != null;
    if (!needsPersist) return undefined;
    const rec = this.bump(id, now);
    this.flush();
    return rec;
  }

  private bump(id: string, now: number): CooldownRecord {
    const dayB = dayBucketOf(now);
    const hourB = hourBucketOf(now);
    const minuteB = minuteBucketOf(now);
    const prev = this.persisted.get(id);
    const rec: CooldownRecord = {
      total: (prev?.total ?? 0) + 1,
      dayBucket: dayB,
      dayCount: (prev && prev.dayBucket === dayB ? prev.dayCount : 0) + 1,
      hourBucket: hourB,
      hourCount: (prev && prev.hourBucket === hourB ? prev.hourCount : 0) + 1,
      minuteBucket: minuteB,
      minuteCount: (prev && prev.minuteBucket === minuteB ? prev.minuteCount : 0) + 1,
      lastShownAt: now,
    };
    this.persisted.set(id, rec);
    return rec;
  }

  /** 合并来自其他标签页的记录（取更大计数 / 更新的时间戳）。 */
  mergeRemote(id: string, remote: CooldownRecord): void {
    const prev = this.persisted.get(id);
    if (!prev) {
      this.persisted.set(id, remote);
      return;
    }
    this.persisted.set(id, {
      total: Math.max(prev.total, remote.total),
      dayBucket: remote.dayBucket,
      dayCount: prev.dayBucket === remote.dayBucket ? Math.max(prev.dayCount, remote.dayCount) : remote.dayCount,
      hourBucket: remote.hourBucket,
      hourCount: prev.hourBucket === remote.hourBucket ? Math.max(prev.hourCount, remote.hourCount) : remote.hourCount,
      minuteBucket: remote.minuteBucket,
      minuteCount: prev.minuteBucket === remote.minuteBucket ? Math.max(prev.minuteCount, remote.minuteCount) : remote.minuteCount,
      lastShownAt: Math.max(prev.lastShownAt, remote.lastShownAt),
    });
  }
}

class OverlayManagerImpl implements OverlayManager {
  private gap: number;
  private autoRemoveDefault: boolean | number;
  private now: () => number;
  private debug: boolean;
  private logger: (message: string) => void;
  private storageKey: string;

  private cooldown: CooldownStore;
  private context: OverlayContext = {};

  private queues = new Map<string, Entry[]>();
  private serial = new Map<string, Entry>(); // 每 slot 的占用者（resolving/open/closing）
  private overlapping: Entry[] = [];
  private pendingOverlaps: Entry[] = []; // 暂停期间被冻结、待 resume 放行的 overlap
  private byId = new Map<string, Entry>();
  private lastClosedAt = new Map<string, number>();
  private openTimers = new Map<string, Timer>();

  private startedAt: number;
  private seqCounter = 0;
  private keyCounter = 0;
  private paused = false;

  private subscribers = new Set<(state: OverlayState) => void>();
  private snap: OverlayState = EMPTY_STATE;

  private channel?: BroadcastChannel;
  private readyPromise: Promise<void>;

  constructor(options: OverlayManagerOptions = {}) {
    this.gap = options.gap ?? 0;
    this.autoRemoveDefault = options.autoRemove ?? true;
    this.now = options.now ?? Date.now;
    this.debug = options.debug ?? false;
    this.logger = options.logger ?? ((m) => console.log(m));
    this.storageKey = options.storageKey ?? "overlay-manager:v1";
    this.startedAt = this.now();

    const storage = options.storage ?? defaultStorage();
    this.cooldown = new CooldownStore(storage, this.storageKey);
    this.readyPromise = this.cooldown.hydrate();

    const wantCrossTab = options.crossTab ?? typeof BroadcastChannel !== "undefined";
    if (wantCrossTab && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`${this.storageKey}:sync`);
      this.channel.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { id?: string; rec?: CooldownRecord } | null;
        if (msg && typeof msg.id === "string" && msg.rec) {
          this.cooldown.mergeRemote(msg.id, msg.rec);
          for (const slot of this.queues.keys()) this.schedule(slot);
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

  ready(): Promise<void> {
    return this.readyPromise;
  }

  /* ── 日志 ── */
  private log(id: string, state: LogState): void {
    if (this.debug) this.logger(`[overlays-manager]:${id}:${state}`);
  }

  /* ── 入口：open ── */
  open<TData = unknown, TResult = unknown>(config: OverlayConfig<TData>): OverlayHandle<TResult> {
    if (!config.id) throw new Error("[overlay-manager] overlay.id is required");
    const slot = config.slot ?? "";
    const entry = this.createEntry(config as OverlayConfig, slot);
    const handle: OverlayHandle<TResult> = {
      id: entry.id,
      result: new Promise<TResult | DismissResult>((res, rej) => {
        entry.settle = (v) => res(v as TResult | DismissResult);
        entry.fail = rej;
      }),
    };

    const existing = this.byId.get(entry.id);
    if (existing) {
      if (this.isActive(existing)) {
        // 正在展示 → 直接 replace，旧的丢弃不回队列
        this.discardActive(existing);
        entry.replaceJumped = true;
        entry.skipGap = true;
      } else {
        // 在队列 → 覆盖旧的那条
        this.removeFromQueue(existing);
        this.byId.delete(existing.id);
        this.finalizeRemoved(existing);
      }
    }

    this.byId.set(entry.id, entry);
    this.log(entry.id, LOG_STATE.pending);

    if (config.overlap) {
      if (this.conditionsPass(entry) && this.cooldownPass(entry)) {
        if (this.paused)
          this.pendingOverlaps.push(entry); // 暂停中：冻结，resume 时再叠加
        else this.openOverlap(entry);
      } else {
        this.byId.delete(entry.id);
        this.settleDismiss(entry);
      }
      return handle;
    }

    // replace 仅在替换者「当下就够资格显示」且未暂停时才生效；否则不该顶掉当前活跃者，
    // 退化为普通排队等待（避免「把当前弹窗顶掉、自己却因条件/冷却/暂停显示不出来」）。
    if (!this.paused && config.replace && this.conditionsPass(entry) && this.cooldownPass(entry)) {
      const cur = this.serial.get(slot);
      entry.skipGap = true;
      if (cur && this.isActive(cur)) {
        entry.replaceJumped = true;
        if (!cur.affix) this.displace(cur);
      }
    }

    this.enqueue(entry);
    this.schedule(slot);
    if (entry.phase === LOG_STATE.pending) this.emit(); // 仍在排队 → 让 queued 变化可观测
    return handle;
  }

  private createEntry(cfg: OverlayConfig, slot: string): Entry {
    return {
      cfg,
      id: cfg.id,
      slot,
      priority: cfg.priority ?? 0,
      instanceKey: ++this.keyCounter,
      seq: ++this.seqCounter,
      overlapping: false,
      affix: cfg.affix ?? false,
      replaceJumped: false,
      skipGap: false,
      exemptCooldown: false,
      phase: LOG_STATE.pending,
      settled: false,
      settle: () => {},
      fail: () => {},
      paused: false,
    };
  }

  private isActive(e: Entry): boolean {
    return e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing || e.phase === LOG_STATE.resolving;
  }

  /* ── 队列操作 ── */
  private enqueue(entry: Entry): void {
    const q = this.queues.get(entry.slot);
    if (q) q.push(entry);
    else this.queues.set(entry.slot, [entry]);
  }

  private removeFromQueue(entry: Entry): void {
    const q = this.queues.get(entry.slot);
    if (!q) return;
    const i = q.indexOf(entry);
    if (i >= 0) q.splice(i, 1);
  }

  /* ── 条件 & 冷却 ── */
  private conditionsPass(entry: Entry): boolean {
    const cfg = entry.cfg;
    if (cfg.when) return cfg.when(this.context);
    if (cfg.route != null && !OverlayManagerImpl.routeMatch(cfg.route, this.context.route)) return false;
    if (cfg.requiresAuth != null && cfg.requiresAuth !== !!this.context.auth) return false;
    return true;
  }

  private static routeMatch(pattern: string | string[] | RegExp, route: string | undefined): boolean {
    if (route == null) return false;
    if (typeof pattern === "string") return route === pattern;
    if (Array.isArray(pattern)) return pattern.includes(route);
    return pattern.test(route);
  }

  private cooldownPass(entry: Entry): boolean {
    if (!entry.cfg.cooldown) return true;
    return this.cooldown.canShow(entry.id, entry.cfg.cooldown, this.now());
  }

  /* ── 调度（每 slot 独立；等待期不锁定候选） ── */
  private schedule(slot: string): void {
    if (this.paused) return;
    if (this.serial.has(slot)) return; // 槽被占用（resolving/open/closing）
    const t = this.openTimers.get(slot);
    if (t != null) {
      clearTimeout(t);
      this.openTimers.delete(slot);
    }
    const q = this.queues.get(slot);
    if (!q || q.length === 0) return;

    const sorted = q.slice().sort(cmpEntry);
    let front: Entry | undefined;
    for (const e of sorted) {
      if (this.conditionsPass(e) && this.cooldownPass(e)) {
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

  private activate(entry: Entry): void {
    this.removeFromQueue(entry);
    if (entry.cfg.resolve) {
      entry.phase = LOG_STATE.resolving;
      this.serial.set(entry.slot, entry); // 占位，resolving 期间不被插队打断
      this.log(entry.id, LOG_STATE.resolving);
      const ac = new AbortController();
      entry.abort = ac;
      const run = entry.cfg.resolve;
      Promise.resolve()
        .then(() => run(ac.signal))
        .then(
          (data) => this.onResolved(entry, data),
          () => this.onResolved(entry, null),
        );
      return;
    }
    this.doOpen(entry);
  }

  private onResolved(entry: Entry, data: unknown): void {
    // resolving 期间被 displace/clear → 不再是槽占用者，丢弃本次结果
    if (this.serial.get(entry.slot) !== entry || entry.phase !== LOG_STATE.resolving) return;
    if (data === null || data === undefined) {
      this.serial.delete(entry.slot);
      this.byId.delete(entry.id);
      this.finalizeRemoved(entry);
      this.emit();
      this.schedule(entry.slot);
      return;
    }
    entry.cfg = { ...entry.cfg, data };
    this.doOpen(entry);
  }

  private doOpen(entry: Entry): void {
    this.serial.set(entry.slot, entry);
    entry.phase = LOG_STATE.open;
    if (!entry.exemptCooldown && entry.cfg.cooldown) {
      const rec = this.cooldown.record(entry.id, entry.cfg.cooldown, this.now());
      if (rec && this.channel) this.channel.postMessage({ id: entry.id, rec });
    }
    entry.exemptCooldown = false;
    this.log(entry.id, LOG_STATE.open);
    entry.cfg.onShow?.();
    if (entry.cfg.duration != null) this.startDuration(entry);
    this.emit();
  }

  private openOverlap(entry: Entry): void {
    entry.overlapping = true;
    entry.phase = LOG_STATE.open;
    this.overlapping.push(entry);
    if (!entry.exemptCooldown && entry.cfg.cooldown) {
      const rec = this.cooldown.record(entry.id, entry.cfg.cooldown, this.now());
      if (rec && this.channel) this.channel.postMessage({ id: entry.id, rec });
    }
    this.log(entry.id, LOG_STATE.open);
    entry.cfg.onShow?.();
    if (entry.cfg.duration != null) this.startDuration(entry);
    this.emit();
  }

  /** 被 replace 顶掉的活跃者退回队列（按 priority 重排；从 open 态退回则重开豁免冷却）。 */
  private displace(cur: Entry): void {
    this.clearTimers(cur);
    if (cur.abort) cur.abort.abort();
    cur.exemptCooldown = cur.phase === LOG_STATE.open;
    this.serial.delete(cur.slot);
    if (cur.overlapping) {
      cur.overlapping = false;
      this.overlapping = this.overlapping.filter((x) => x !== cur);
    }
    const wasOpen = cur.phase === LOG_STATE.open;
    cur.phase = LOG_STATE.pending;
    cur.replaceJumped = false;
    cur.skipGap = false;
    this.enqueue(cur);
    if (wasOpen) cur.cfg.onClose?.();
    this.log(cur.id, LOG_STATE.pending);
  }

  /** 同 id 重开时，丢弃正在展示的旧实例（不回队列）。 */
  private discardActive(existing: Entry): void {
    this.clearTimers(existing);
    if (existing.abort) existing.abort.abort();
    if (this.serial.get(existing.slot) === existing) this.serial.delete(existing.slot);
    if (existing.overlapping) this.overlapping = this.overlapping.filter((x) => x !== existing);
    this.byId.delete(existing.id);
    this.finalizeRemoved(existing);
  }

  /* ── 关闭握手（两阶段） ── */
  close(id: string): void {
    const e = this.byId.get(id);
    if (!e || e.phase !== LOG_STATE.open) return;
    const guard = e.cfg.beforeClose;
    if (guard) {
      // beforeClose 关闭守卫：返回（或 Promise resolve）`false` 则取消本次关闭；其余值放行。
      Promise.resolve(guard()).then(
        (ok) => {
          if (ok !== false && this.byId.get(id) === e && e.phase === LOG_STATE.open) this.doClose(e);
        },
        () => {
          /* 守卫抛错 → 视为取消关闭 */
        },
      );
      return;
    }
    this.doClose(e);
  }

  private doClose(e: Entry): void {
    e.phase = LOG_STATE.closing;
    this.clearDuration(e);
    this.log(e.id, LOG_STATE.closing);
    e.cfg.onClose?.();
    this.emit();
    this.scheduleAutoRemove(e);
  }

  private scheduleAutoRemove(e: Entry): void {
    const ar = e.cfg.autoRemove ?? this.autoRemoveDefault;
    if (ar === false) return;
    const ms = ar === true ? DEFAULT_AUTO_REMOVE_MS : ar;
    e.autoRemoveTimer = setTimeout(() => this.remove(e.id), ms);
  }

  remove(id: string): void {
    const e = this.byId.get(id);
    if (!e) return;
    this.clearTimers(e);
    if (e.abort) e.abort.abort();
    this.byId.delete(id);
    const wasSerial = this.serial.get(e.slot) === e;
    if (wasSerial) {
      this.serial.delete(e.slot);
      this.lastClosedAt.set(e.slot, this.now());
    }
    if (e.overlapping) this.overlapping = this.overlapping.filter((x) => x !== e);
    this.removeFromQueue(e);
    this.finalizeRemoved(e);
    this.emit();
    // 无论移除的是活跃者还是队列项，都重评该 slot：
    // 移除队首候选后需重新挑选，并清掉可能残留的过期 open 定时器。
    this.schedule(e.slot);
  }

  private finalizeRemoved(e: Entry): void {
    this.log(e.id, LOG_STATE.closed);
    e.cfg.onRemove?.();
    this.settleDismiss(e);
  }

  private settleDismiss(e: Entry): void {
    if (e.settled) return;
    e.settled = true;
    e.settle({ dismissed: true });
  }

  /* ── result 投递 ── */
  resolve(id: string, value: unknown): void {
    const e = this.byId.get(id);
    if (!e || e.settled) return;
    e.settled = true;
    e.settle(value);
  }

  reject(id: string, error: unknown): void {
    const e = this.byId.get(id);
    if (!e || e.settled) return;
    e.settled = true;
    e.fail(error);
  }

  /** 就地更新某条目的 `data`（对象则浅合并，否则替换）并通知渲染；不触发队列变更（区别于 replace）。 */
  update(id: string, patch: unknown): void {
    const e = this.byId.get(id);
    if (!e) return;
    const prev = e.cfg.data;
    const next = prev && typeof prev === "object" && patch && typeof patch === "object" ? { ...(prev as object), ...(patch as object) } : patch;
    e.cfg = { ...e.cfg, data: next };
    this.emit();
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
  clear(arg?: ClearSelector | { closeActive?: boolean }): void {
    if (typeof arg === "function") {
      // 选择器模式：select(ctx, records) 返回要清理的 id 数组；返回非数组 → 全部清理。
      const picked = arg(this.context, this.records());
      const ids = Array.isArray(picked) ? picked : this.records().map((r) => r.id);
      for (const id of ids) this.remove(id);
      return;
    }
    // 传统模式：清空各 slot 等待队列 + 冻结的 overlap；closeActive 时连活跃一起关。
    const options = arg ?? {};
    for (const q of this.queues.values()) {
      for (const e of q) {
        this.byId.delete(e.id);
        this.finalizeRemoved(e);
      }
      q.length = 0;
    }
    for (const e of this.pendingOverlaps) {
      this.byId.delete(e.id);
      this.finalizeRemoved(e);
    }
    this.pendingOverlaps = [];
    if (options.closeActive) {
      for (const e of Array.from(this.byId.values())) this.remove(e.id);
    }
    this.emit();
  }

  /* ── 上下文（push 模型，触发重评） ── */
  setContext(partial: Partial<OverlayContext>): void {
    this.context = { ...this.context, ...partial };
    // 已展示(open/closing)但条件不再满足者：dismissWhenUnmet(默认 true) 时自动撤下并推进下一个。
    for (const e of [...this.serial.values(), ...this.overlapping]) {
      if ((e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing) && e.cfg.dismissWhenUnmet !== false && !this.conditionsPass(e)) {
        this.remove(e.id);
      }
    }
    for (const slot of this.queues.keys()) this.schedule(slot);
  }

  /* ── 暂停 / 恢复 ── */
  pauseAll(): void {
    if (this.paused) return;
    this.paused = true;
    for (const [slot, t] of this.openTimers) {
      clearTimeout(t);
      this.openTimers.delete(slot);
    }
    for (const e of this.byId.values()) this.freezeDuration(e);
  }

  resumeAll(): void {
    if (!this.paused) return;
    this.paused = false;
    // 放行暂停期间被冻结的 overlap（仍在册且仍合格才叠加）
    const pend = this.pendingOverlaps;
    this.pendingOverlaps = [];
    for (const e of pend) {
      if (this.byId.get(e.id) === e && this.conditionsPass(e) && this.cooldownPass(e)) this.openOverlap(e);
      else if (this.byId.get(e.id) === e) {
        this.byId.delete(e.id);
        this.settleDismiss(e);
      }
    }
    for (const e of this.byId.values()) this.thawDuration(e);
    for (const slot of this.queues.keys()) this.schedule(slot);
  }

  pause(id: string): void {
    const e = this.byId.get(id);
    if (!e || e.paused) return;
    e.paused = true;
    this.freezeDuration(e);
  }

  resume(id: string): void {
    const e = this.byId.get(id);
    if (!e || !e.paused) return;
    e.paused = false;
    this.thawDuration(e);
  }

  private startDuration(e: Entry): void {
    const ms = e.cfg.duration;
    if (ms == null) return;
    if (this.paused || e.paused) {
      e.durationRemaining = ms;
      return;
    }
    e.durationEndsAt = this.now() + ms;
    e.durationTimer = setTimeout(() => this.close(e.id), ms);
  }

  private freezeDuration(e: Entry): void {
    if (e.durationTimer == null) return;
    clearTimeout(e.durationTimer);
    e.durationTimer = undefined;
    e.durationRemaining = Math.max(0, (e.durationEndsAt ?? this.now()) - this.now());
  }

  private thawDuration(e: Entry): void {
    if (this.paused || e.paused) return;
    if (e.durationRemaining == null || e.phase !== LOG_STATE.open) return;
    const ms = e.durationRemaining;
    e.durationRemaining = undefined;
    e.durationEndsAt = this.now() + ms;
    e.durationTimer = setTimeout(() => this.close(e.id), ms);
  }

  private clearDuration(e: Entry): void {
    if (e.durationTimer != null) {
      clearTimeout(e.durationTimer);
      e.durationTimer = undefined;
    }
    e.durationRemaining = undefined;
  }

  private clearTimers(e: Entry): void {
    this.clearDuration(e);
    if (e.autoRemoveTimer != null) {
      clearTimeout(e.autoRemoveTimer);
      e.autoRemoveTimer = undefined;
    }
  }

  /* ── 快照 & 订阅 ── */
  private emit(): void {
    const actives: Entry[] = [];
    for (const e of this.serial.values()) {
      if (e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing) actives.push(e);
    }
    for (const e of this.overlapping) {
      if (e.phase === LOG_STATE.open || e.phase === LOG_STATE.closing) actives.push(e);
    }
    actives.sort((a, b) => a.instanceKey - b.instanceKey);
    // stackIndex = 叠加渲染层序（入场序），isTopmost = 最上层。headless 不设 z-index，
    // 只把层序喂给宿主，由宿主算 z-index / 给非顶层加 pointer-events:none。
    const last = actives.length - 1;
    const active = actives.map((e, i) => OverlayManagerImpl.toInstance(e, i, i === last));

    const queued: string[] = [];
    for (const q of this.queues.values()) for (const e of q) queued.push(e.id);

    this.snap = { active, queued };
    for (const listener of this.subscribers) listener(this.snap);
  }

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

  subscribe(listener: (state: OverlayState) => void, options: { immediate?: boolean } = {}): () => void {
    this.subscribers.add(listener);
    if (options.immediate) listener(this.snap);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  getSnapshot(): OverlayState {
    return this.snap;
  }

  getServerSnapshot(): OverlayState {
    return EMPTY_STATE;
  }

  get(id: string): OverlayInstance | undefined {
    return this.snap.active.find((o) => o.id === id);
  }

  /* ── 释放 ── */
  destroy(): void {
    for (const t of this.openTimers.values()) clearTimeout(t);
    this.openTimers.clear();
    for (const e of this.byId.values()) this.clearTimers(e);
    this.clear({ closeActive: true });
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = undefined;
    }
    this.subscribers.clear();
  }
}

/** 创建一个 overlay 管理器实例。`await manager.ready()` 后开始工作（等冷却状态 hydrate）。 */
export function createOverlayManager(options?: OverlayManagerOptions): OverlayManager {
  return new OverlayManagerImpl(options);
}
