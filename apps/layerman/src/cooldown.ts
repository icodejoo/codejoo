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

/** 可注入存储（get/set 可同步可异步，兼容 localStorage 与 RN AsyncStorage）。 */
export interface AsyncableStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
}

/** 冷却持久化记录（每 id 一条）。 */
export interface CooldownRecord {
  total: number;
  dayBucket: string;
  dayCount: number;
  hourBucket: string;
  hourCount: number;
  minuteBucket: string;
  minuteCount: number;
  lastShownAt: number;
}

/** 把 Duration 折算成毫秒。 */
function durationToMs(d: Duration): number {
  return ((d.days ?? 0) * 24 * 60 * 60 + (d.hours ?? 0) * 60 * 60 + (d.minutes ?? 0) * 60 + (d.seconds ?? 0)) * 1000;
}

/** 个位数补前导 0。 */
function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 一个时间点对应的本地自然日/时/分桶标识。 */
interface Buckets {
  /** 日桶，如 `2026-01-02`。 */
  day: string;
  /** 小时桶，如 `2026-01-02T03`。 */
  hour: string;
  /** 分钟桶，如 `2026-01-02T03:04`。 */
  minute: string;
}

/** 用同一个本地 `Date` 一次性算出日/时/分桶；桶格式只在这里定义，`canShow` 与 `bump` 共用，避免两处漂移。 */
function bucketsOf(t: number): Buckets {
  const d = new Date(t);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hour = `${day}T${pad(d.getHours())}`;
  return { day, hour, minute: `${hour}:${pad(d.getMinutes())}` };
}

/** 校验桶标签的格式与真实日历日期。 */
function validateBucket(value: unknown, pattern: RegExp): value is string {
  if (typeof value !== "string" || !pattern.test(value)) return false;
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** 丢弃字段类型、计数或桶标签损坏的单条记录。 */
function validateRecord(value: unknown): value is CooldownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as CooldownRecord;
  const counts = [rec.total, rec.dayCount, rec.hourCount, rec.minuteCount];
  return (
    counts.every((count) => Number.isFinite(count) && Number.isInteger(count) && count >= 0) &&
    Number.isFinite(rec.lastShownAt) &&
    rec.lastShownAt >= 0 &&
    validateBucket(rec.dayBucket, /^\d{4}-\d{2}-\d{2}$/) &&
    validateBucket(rec.hourBucket, /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/) &&
    validateBucket(rec.minuteBucket, /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  );
}

/** 默认存储：有 localStorage 就用，拿不到（SSR/隐私模式）返回 undefined 退化为内存。 */
export function defaultStorage(): AsyncableStorage | undefined {
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
export class CooldownStore {
  private persisted = new Map<string, CooldownRecord>();
  private session = new Map<string, number>();
  private storage: AsyncableStorage | undefined;
  private storageKey: string;
  /** 当前是否有写入在途。 */
  private writing = false;
  /** 内存是否有尚未提交的变动。 */
  private dirty = false;
  /** 历史读取结束后才允许提交内存快照。 */
  private hydrated = false;

  /** 初始化冷却持久化存储及存储键。 */
  constructor(storage: AsyncableStorage | undefined, storageKey: string) {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  /** 同步存储立即落地，异步读取完成后再开放资格与写回。 */
  hydrate(): Promise<void> {
    try {
      const raw = this.storage?.get(this.storageKey);
      if (raw != null && typeof raw !== "string") {
        return Promise.resolve(raw)
          .then(
            (value) => this.load(value),
            () => {},
          )
          .then(() => this.finishHydrate());
      }
      this.load(raw);
    } catch {
      /* 读取失败时保留内存记录。 */
    }
    this.finishHydrate();
    return Promise.resolve();
  }

  /** 容忍坏 JSON 与坏记录，逐条合并有效历史。 */
  private load(raw: string | null | undefined): void {
    try {
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      for (const [id, rec] of Object.entries(parsed)) this.mergeRecord(id, rec);
    } catch {
      /* 坏 JSON 不阻止完成 hydrate。 */
    }
  }

  /** 标记读取结束，并补写读取期间的内存变动。 */
  private finishHydrate(): void {
    this.hydrated = true;
    if (this.dirty) this.flush();
  }

  /** 只有持久化字段需要等待历史读取。 */
  needsHydration(cd: Cooldown): boolean {
    return !this.hydrated && CooldownStore.needsPersist(cd);
  }

  /** 集中判断冷却是否使用持久化记录。 */
  private static needsPersist(cd: Cooldown): boolean {
    return cd.total != null || cd.day != null || cd.hour != null || cd.minute != null || cd.minGap != null;
  }

  /** 把持久化记录整体写回存储（写失败静默忽略）。 */
  private flush(): void {
    this.dirty = true;
    if (!this.hydrated || this.writing) return;
    if (!this.storage) return;
    this.dirty = false;
    this.writing = true;
    const obj = Object.create(null) as Record<string, CooldownRecord>;
    for (const [id, rec] of this.persisted) obj[id] = rec;
    try {
      const result = this.storage.set(this.storageKey, JSON.stringify(obj));
      if (result) {
        void Promise.resolve(result).then(
          () => this.finishWrite(),
          () => this.finishWrite(),
        );
      } else {
        this.finishWrite();
      }
    } catch {
      this.finishWrite();
    }
  }

  /** 结束本轮写入，并在有新变动时补写最新快照。 */
  private finishWrite(): void {
    this.writing = false;
    if (this.dirty) this.flush();
  }

  /** 判断不会随时间解除的会话或累计额度耗尽。 */
  isCapped(id: string, cd: Cooldown): boolean {
    return (cd.session != null && (this.session.get(id) ?? 0) >= cd.session) || (cd.total != null && (this.persisted.get(id)?.total ?? 0) >= cd.total);
  }

  /** 按冷却配置判断该 id 此刻能否展示（各字段 AND）。 */
  canShow(id: string, cd: Cooldown, now: number): boolean {
    if (cd.session != null && (this.session.get(id) ?? 0) >= cd.session) return false;
    const rec = this.persisted.get(id);
    if (cd.total != null && (rec?.total ?? 0) >= cd.total) return false;
    if (cd.day != null || cd.hour != null || cd.minute != null) {
      const b = bucketsOf(now);
      if (cd.day != null && (rec && rec.dayBucket === b.day ? rec.dayCount : 0) >= cd.day) return false;
      if (cd.hour != null && (rec && rec.hourBucket === b.hour ? rec.hourCount : 0) >= cd.hour) return false;
      if (cd.minute != null && (rec && rec.minuteBucket === b.minute ? rec.minuteCount : 0) >= cd.minute) return false;
    }
    if (cd.minGap != null && rec?.lastShownAt != null && now - rec.lastShownAt < durationToMs(cd.minGap)) return false;
    return true;
  }

  /** 记一次展示（open 时调用）。返回持久化记录（用于跨标签页广播），无持久化字段时返回 undefined。 */
  record(id: string, cd: Cooldown, now: number): CooldownRecord | undefined {
    if (cd.session != null) this.session.set(id, (this.session.get(id) ?? 0) + 1);
    const needsPersist = CooldownStore.needsPersist(cd);
    if (!needsPersist) return undefined;
    const rec = this.bump(id, now);
    this.flush();
    return rec;
  }

  /** 给该 id 的持久化记录各计数 +1（跨桶则重新从 1 计）。 */
  private bump(id: string, now: number): CooldownRecord {
    const { day: dayB, hour: hourB, minute: minuteB } = bucketsOf(now);
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

  /** 同桶取最大计数；跨桶按展示时间选取，兼容本地时钟回拨。 */
  private static mergeBucket(prevBucket: string, prevCount: number, remoteBucket: string, remoteCount: number, remoteIsNewer: boolean): { bucket: string; count: number } {
    if (prevBucket === remoteBucket) return { bucket: prevBucket, count: Math.max(prevCount, remoteCount) };
    return remoteIsNewer ? { bucket: remoteBucket, count: remoteCount } : { bucket: prevBucket, count: prevCount };
  }

  /** 合并来自其他标签页的记录（取更大计数 / 更新的时间戳 / 更新的桶）。 */
  mergeRemote(id: string, remote: unknown): void {
    this.mergeRecord(id, remote);
  }

  /** 对历史读取与广播应用相同的逐条校验和合并规则。 */
  private mergeRecord(id: string, remote: unknown): void {
    if (!validateRecord(remote)) return;
    const prev = this.persisted.get(id);
    if (!prev) {
      this.persisted.set(id, { ...remote });
      return;
    }
    const remoteIsNewer = remote.lastShownAt > prev.lastShownAt;
    const day = CooldownStore.mergeBucket(prev.dayBucket, prev.dayCount, remote.dayBucket, remote.dayCount, remoteIsNewer);
    const hour = CooldownStore.mergeBucket(prev.hourBucket, prev.hourCount, remote.hourBucket, remote.hourCount, remoteIsNewer);
    const minute = CooldownStore.mergeBucket(prev.minuteBucket, prev.minuteCount, remote.minuteBucket, remote.minuteCount, remoteIsNewer);
    this.persisted.set(id, {
      total: Math.max(prev.total, remote.total),
      dayBucket: day.bucket,
      dayCount: day.count,
      hourBucket: hour.bucket,
      hourCount: hour.count,
      minuteBucket: minute.bucket,
      minuteCount: minute.count,
      lastShownAt: Math.max(prev.lastShownAt, remote.lastShownAt),
    });
  }
}
