import type { AuthTag } from './classify.ts';

/** 事件快照：断言用的只读视图 */
export interface EventSnapshot {
  loading: boolean[];
  notify: string[];
  refresh: number;
  expired: number;
  denied: number;
  /** 客户端侧因无令牌被拒的次数（不算 denied，单独记） */
  unauthenticated: number;
}

/**
 * 客户端事件采集器：loading 序列、notify 次数与消息、refresh/expired/denied 计数，
 * 并按请求标签（tkReq）记录会话类结果，供 classify 优先使用。
 * pending_after 由 PendingTracker 单独统计。
 */
export class EventLog {
  loading: boolean[] = [];
  notify: string[] = [];
  refresh = 0;
  expired = 0;
  denied = 0;
  unauthenticated = 0;
  #tags = new Map<string, Set<AuthTag>>();

  /** loading 回调 */
  onLoading = (visible: boolean): void => { this.loading.push(visible); };
  /** notify 回调，参数为提示文案 */
  onNotify = (message: string): void => { this.notify.push(message); };
  /** 实际发起了一次 refresh 调用 */
  onRefresh = (): void => { this.refresh++; };

  /**
   * 会话过期回调。
   * @param reqTag 触发该回调的请求标签
   */
  onExpired(reqTag: string | undefined): void {
    this.expired++;
    this.#tag(reqTag, 'expired');
  }

  /**
   * 请求自身带有`authExpired`标记：只打 expired 标签，不增加回调计数。
   * @param reqTag 请求标签
   */
  markExpired(reqTag: string | undefined): void {
    this.#tag(reqTag, 'expired');
  }

  /**
   * 越权回调（HTTP/业务码 403）。
   * @param reqTag 触发该回调的请求标签
   */
  onDenied(reqTag: string | undefined): void {
    this.denied++;
    this.#tag(reqTag, 'denied');
  }

  /**
   * 客户端因没有 access token 拒绝发请求（对应错误类别 unauthenticated）。
   * @param reqTag 请求标签
   */
  onUnauthenticated(reqTag: string | undefined): void {
    this.unauthenticated++;
    this.#tag(reqTag, 'unauthenticated');
  }

  /**
   * 取某请求被打上的标签。
   * @param reqTag 请求标签
   */
  tagsOf(reqTag: string): ReadonlySet<AuthTag> {
    return this.#tags.get(reqTag) ?? EMPTY_TAGS;
  }

  /** 当前事件快照 */
  snapshot(): EventSnapshot {
    return {
      loading: [...this.loading],
      notify: [...this.notify],
      refresh: this.refresh,
      expired: this.expired,
      denied: this.denied,
      unauthenticated: this.unauthenticated,
    };
  }

  #tag(reqTag: string | undefined, tag: AuthTag): void {
    if (!reqTag) return;
    const set = this.#tags.get(reqTag) ?? new Set<AuthTag>();
    set.add(tag);
    this.#tags.set(reqTag, set);
  }
}

/** 空标签集合 */
const EMPTY_TAGS: ReadonlySet<AuthTag> = new Set();

/**
 * 在途请求计数器：场景结束后 `pending()` 即 pending_after。
 */
export class PendingTracker {
  #started = 0;
  #settled = 0;

  /** 请求发出 */
  start(): void { this.#started++; }
  /** 请求落定（无论成败） */
  settle(): void { this.#settled++; }
  /** 尚未落定的请求数 */
  pending(): number { return this.#started - this.#settled; }
}

/**
 * loading 序列是否成对：true 与 false 次数相等，且序列为空或最后一个是 false（MATRIX §4）。
 * @param seq loading 回调序列
 * @returns 违规描述；合规返回 null
 */
export function checkLoadingPaired(seq: readonly boolean[]): string | null {
  const shows = seq.filter(Boolean).length;
  const hides = seq.length - shows;
  if (shows !== hides) return `loading 未成对: true×${shows} false×${hides}`;
  if (seq.length > 0 && seq[seq.length - 1] !== false) return 'loading 最后一个不是 false';
  return null;
}
