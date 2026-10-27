/**
 * Stage-keyed Cache Storage wrapper with an LRU index over full-image entries.
 *
 * 按阶段分 key 的 Cache Storage 封装,对全图条目维护 LRU 索引。
 */

import { type ImgprogressStage, withStageParam } from "../shared/protocol";

/** Internal request key for the LRU index entry — LRU 索引条目的内部请求 key */
const INDEX_URL = "https://imgprogress.internal/__index__";

/** Per-URL LRU bookkeeping — 按 URL 的 LRU 记录 */
interface IndexEntry {
  /** Last-touched timestamp, ms — 最近触碰时间戳(毫秒) */
  ts: number;
}

/**
 * Minimal cache surface consumed by the SW pipeline.
 *
 * pipeline 消费的最小缓存接口。
 */
export interface ImgprogressCacheLike {
  /** Look up a cached stage response — 查找某阶段的缓存响应 */
  matchStage: (url: string, stage: ImgprogressStage) => Promise<Response | undefined>;
  /** Store a stage response; false when the write ultimately failed (e.g. quota) — 存储某阶段响应;写入最终失败(如配额)返回 false */
  putStage: (url: string, stage: ImgprogressStage, resp: Response) => Promise<boolean>;
  /** Delete both stage entries for a URL and drop it from the LRU index — 删除一个 URL 的两阶段缓存并从 LRU 索引移除 */
  deleteUrl: (url: string) => Promise<void>;
}

/**
 * Cache Storage-backed implementation of {@link ImgprogressCacheLike} with
 * entry-count and age-based LRU eviction.
 *
 * 基于 Cache Storage 的 {@link ImgprogressCacheLike} 实现,支持条目数与存活时长的 LRU 淘汰。
 */
export class ImgprogressCache implements ImgprogressCacheLike {
  /** Cache bucket name — 缓存桶名 */
  private readonly name: string;
  /** Max tracked full-image entries before eviction — 触发淘汰前的最大全图条目数 */
  private readonly maxEntries: number;
  /** Entry max age in seconds before it's treated as expired — 条目视为过期前的最大存活秒数 */
  private readonly maxAgeSeconds: number;
  /** Injected CacheStorage (real or mock) — 注入的 CacheStorage(真实或 mock) */
  private readonly cachesImpl: CacheStorage;
  /** Clock, injectable for tests — 时钟,测试可注入 */
  private readonly now: () => number;
  /** 索引读改写的串行化链,永不 reject */
  private indexLock: Promise<unknown> = Promise.resolve();

  /**
   * @param opts - Cache tuning: bucket name, entry cap, max age in seconds — 缓存配置:桶名、条目上限、最大存活秒数
   * @param cachesImpl - CacheStorage instance (real or mock) — CacheStorage 实例(真实或 mock)
   * @param now - Clock function, defaults to Date.now — 时钟函数,默认 Date.now
   */
  constructor(opts: { name: string; maxEntries: number; maxAgeSeconds: number }, cachesImpl: CacheStorage, now: () => number = Date.now) {
    this.name = opts.name;
    this.maxEntries = opts.maxEntries;
    this.maxAgeSeconds = opts.maxAgeSeconds;
    this.cachesImpl = cachesImpl;
    this.now = now;
  }

  /**
   * Load the LRU index, defaulting to empty when absent or unreadable.
   *
   * 加载 LRU 索引,缺失或不可读时默认空对象。
   * @param cache - Open Cache instance — 已打开的 Cache 实例
   * @returns Per-URL index — 按 URL 的索引
   */
  private async loadIndex(cache: Cache): Promise<Record<string, IndexEntry>> {
    const resp = await cache.match(INDEX_URL);
    if (!resp) return {};
    try {
      return await resp.json();
    } catch {
      return {};
    }
  }

  /**
   * Persist the LRU index.
   *
   * 持久化 LRU 索引。
   * @param cache - Open Cache instance — 已打开的 Cache 实例
   * @param index - Index to save — 待保存的索引
   */
  private async saveIndex(cache: Cache, index: Record<string, IndexEntry>): Promise<void> {
    await cache.put(INDEX_URL, new Response(JSON.stringify(index)));
  }

  /**
   * Delete both stage entries for a URL from the underlying cache (index untouched).
   *
   * 从底层缓存删除一个 URL 的两阶段条目(不动索引)。
   * @param cache - Open Cache instance — 已打开的 Cache 实例
   * @param url - Canonical image URL — 规范化图片 URL
   */
  private async deleteStages(cache: Cache, url: string): Promise<void> {
    await cache.delete(withStageParam(url, "ff"));
    await cache.delete(withStageParam(url, "1"));
  }

  /**
   * 串行执行索引的读改写段,避免并发完成时 last-writer-wins 丢条目。
   * 前一段无论成败都不会阻塞后一段。
   * @param fn - 在锁内执行的读改写逻辑
   * @returns fn 的返回值
   */
  private withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.indexLock.then(fn);
    this.indexLock = run.catch(() => {});
    return run;
  }

  /**
   * 查找某阶段缓存;"1" 阶段会校验过期并触碰 LRU 时间戳。见 {@link ImgprogressCacheLike.matchStage}。
   * @param url - 规范化图片 URL
   * @param stage - 目标阶段
   * @returns 命中的响应,未命中或已过期为 undefined
   */
  async matchStage(url: string, stage: ImgprogressStage): Promise<Response | undefined> {
    const cache = await this.cachesImpl.open(this.name);
    const resp = await cache.match(withStageParam(url, stage));
    if (!resp || stage !== "1") return resp;

    // 过期判断与触碰共用一次索引读取,且放在锁内,避免触碰覆盖并发写入
    return this.withIndexLock(async () => {
      const index = await this.loadIndex(cache);
      const entry = index[url];
      if (!entry) return resp;
      if (this.now() - entry.ts > this.maxAgeSeconds * 1000) return undefined;
      index[url] = { ts: this.now() };
      await this.saveIndex(cache, index);
      return resp;
    });
  }

  /**
   * 存储某阶段响应;配额失败时淘汰最旧一半后重试一次。见 {@link ImgprogressCacheLike.putStage}。
   * @param url - 规范化图片 URL
   * @param stage - 目标阶段
   * @param resp - 待存储响应(body 会被消耗)
   * @returns 最终写入成功为 true,失败为 false
   */
  async putStage(url: string, stage: ImgprogressStage, resp: Response): Promise<boolean> {
    const cache = await this.cachesImpl.open(this.name);
    const key = withStageParam(url, stage);

    try {
      // 首次写入用 clone:Cache.put 会消耗 body,失败后原响应还要用于重试
      await cache.put(key, resp.clone());
    } catch {
      // Quota-like failure — evict the oldest half of tracked entries and retry once.
      // 类配额失败——淘汰最旧的一半已跟踪条目后重试一次。
      try {
        await this.withIndexLock(async () => {
          const index = await this.loadIndex(cache);
          const oldestFirst = Object.entries(index).sort((a, b) => a[1].ts - b[1].ts);
          const toEvict = oldestFirst.slice(0, Math.ceil(oldestFirst.length / 2));
          for (const [evictUrl] of toEvict) {
            await this.deleteStages(cache, evictUrl);
            delete index[evictUrl];
          }
          await this.saveIndex(cache, index);
        });
        await cache.put(key, resp);
      } catch {
        return false;
      }
    }

    if (stage === "1") {
      await this.withIndexLock(async () => {
        const index = await this.loadIndex(cache);
        index[url] = { ts: this.now() };
        while (Object.keys(index).length > this.maxEntries) {
          const [oldestUrl] = Object.entries(index).sort((a, b) => a[1].ts - b[1].ts)[0]!;
          await this.deleteStages(cache, oldestUrl);
          delete index[oldestUrl];
        }
        await this.saveIndex(cache, index);
      });
    }

    return true;
  }

  /**
   * 删除一个 URL 的两阶段缓存并更新 LRU 索引。见 {@link ImgprogressCacheLike.deleteUrl}。
   * @param url - 规范化图片 URL
   */
  async deleteUrl(url: string): Promise<void> {
    const cache = await this.cachesImpl.open(this.name);
    await this.deleteStages(cache, url);
    await this.withIndexLock(async () => {
      const index = await this.loadIndex(cache);
      delete index[url];
      await this.saveIndex(cache, index);
    });
  }
}
