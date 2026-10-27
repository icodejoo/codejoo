import { errorMatchesAny } from './classify.ts';
import type { Style } from './constants.ts';
import { checkLoadingPaired } from './events.ts';
import type { EventSnapshot } from './events.ts';
import { checkOrder, checkRange, countAborted, subsetMatch } from './matchers.ts';
import type { Observation } from './matchers.ts';
import type { Expectation, Range, ServerExpect } from './types.ts';

/** 一条请求的执行记录 */
export interface RequestRecord {
  /** 请求 id（含 repeat 的 #i 后缀） */
  id: string;
  style: Style;
  ok: boolean;
  /** 失败时的具体错误类别（classifyError 的结果） */
  kind?: string;
  /** 成功时客户端最终拿到的数据（信封已解包） */
  data?: unknown;
  /** 失败时的错误消息，便于排查 */
  message?: string;
  /** 请求是否到达了服务器；只对声明了 from_cache 的请求探测 */
  reached?: boolean;
}

/** 一次运行结束后收集到的全部客观事实 */
export interface Observed {
  records: Map<string, RequestRecord>;
  /** 请求落定顺序（请求 id） */
  order: string[];
  events: EventSnapshot;
  pendingAfter: number;
  durationMs: number;
}

/** 读取 data.meta.hit */
function hitOf(data: unknown): unknown {
  const meta = (data as { meta?: { hit?: unknown } } | null | undefined)?.meta;
  return meta?.hit;
}

/**
 * 校验 expect.results：成败、错误类别、data 子集、hit、from_cache。
 * @param exp 合并后的预期
 * @param observed 运行事实
 * @returns 失败原因清单
 */
export function checkResults(exp: Expectation, observed: Observed): string[] {
  const fails: string[] = [];
  for (const [id, r] of Object.entries(exp.results ?? {})) {
    const rec = observed.records.get(id);
    if (!rec) { fails.push(`${id}: 请求没有发出或没有落定`); continue; }
    if (r.ok === true && !rec.ok) fails.push(`${id}: 期望成功，实际失败 ${rec.kind}（${rec.message ?? ''}）`);
    if (r.ok === false && rec.ok) fails.push(`${id}: 期望失败，实际成功`);
    if (r.error !== undefined) {
      if (rec.ok) fails.push(`${id}: 期望错误 ${JSON.stringify(r.error)}，实际成功`);
      else if (!errorMatchesAny(r.error, rec.kind ?? '', rec.style)) {
        fails.push(`${id}: 期望错误 ${JSON.stringify(r.error)}，实际 ${rec.kind}（${rec.message ?? ''}）`);
      }
    }
    if (r.data !== undefined && rec.ok) fails.push(...subsetMatch(rec.data, r.data, `${id}.data`));
    if (r.hit !== undefined && rec.ok && hitOf(rec.data) !== r.hit) fails.push(`${id}.hit: 实际 ${String(hitOf(rec.data))}，期望 ${r.hit}`);
    if (r.from_cache !== undefined) {
      if (rec.reached === undefined) fails.push(`${id}.from_cache: 无法推断（没有服务端观测）`);
      else if (rec.reached === r.from_cache) fails.push(`${id}.from_cache: 期望 ${r.from_cache}，实际${rec.reached ? '到达了服务器' : '未到达服务器'}`);
    }
  }
  return fails;
}

/** 区间校验的小封装，把 null 过滤掉 */
function rangeFails(entries: Array<[string, number, Range | undefined]>): string[] {
  const out: string[] = [];
  for (const [label, value, range] of entries) {
    if (!range) continue;
    const f = checkRange(label, value, range);
    if (f) out.push(f);
  }
  return out;
}

/**
 * 校验 expect.client：loading 精确序列，以及 notify/refresh/expired/denied/pending_after 区间。
 * @param exp 合并后的预期
 * @param observed 运行事实
 */
export function checkClient(exp: Expectation, observed: Observed): string[] {
  const c = exp.client;
  if (!c) return [];
  const fails: string[] = [];
  if (c.loading) {
    const a = JSON.stringify(observed.events.loading);
    const e = JSON.stringify(c.loading);
    if (a !== e) fails.push(`client.loading: 实际 ${a}，期望 ${e}`);
  }
  fails.push(...rangeFails([
    ['client.notify', observed.events.notify.length, c.notify],
    ['client.refresh', observed.events.refresh, c.refresh],
    ['client.expired', observed.events.expired, c.expired],
    ['client.denied', observed.events.denied, c.denied],
    ['client.pending_after', observed.pendingAfter, c.pending_after],
  ]));
  return fails;
}

/**
 * 校验 expect.server：total、by_key、by_path、peak_inflight、aborted。
 * @param exp 预期里的 server 段
 * @param obs 服务端观测
 */
export function checkServer(exp: ServerExpect | undefined, obs: Observation): string[] {
  if (!exp) return [];
  const fails = rangeFails([
    ['server.total', obs.total, exp.total],
    ['server.peak_inflight', obs.peak_inflight, exp.peak_inflight],
    ['server.aborted', countAborted(obs), exp.aborted],
  ]);
  for (const [k, r] of Object.entries(exp.by_key ?? {})) fails.push(...rangeFails([[`server.by_key[${k}]`, obs.by_key[k] ?? 0, r]]));
  for (const [k, r] of Object.entries(exp.by_path ?? {})) fails.push(...rangeFails([[`server.by_path[${k}]`, obs.by_path[k] ?? 0, r]]));
  return fails;
}

/**
 * 校验 order 与 duration_ms。
 * @param exp 合并后的预期
 * @param observed 运行事实
 */
export function checkOrderAndDuration(exp: Expectation, observed: Observed): string[] {
  const fails: string[] = [];
  if (exp.order) {
    const f = checkOrder(observed.order, exp.order);
    if (f) fails.push(f);
  }
  fails.push(...rangeFails([['duration_ms', observed.durationMs, exp.duration_ms]]));
  return fails;
}

/**
 * 通用断言（MATRIX §4），无论场景是否声明都要检查：pending_after=0、loading 成对。
 * 服务端 inflight=0 需要观测，由 runner 单独检查。
 * @param observed 运行事实
 */
export function checkGeneric(observed: Observed): string[] {
  const fails: string[] = [];
  if (observed.pendingAfter !== 0) fails.push(`通用: pending_after=${observed.pendingAfter}，应为 0`);
  const paired = checkLoadingPaired(observed.events.loading);
  if (paired) fails.push(`通用: ${paired}`);
  return fails;
}

/**
 * 校验与服务端无关的全部预期（results/order/client/duration）加通用断言。
 * @param exp 合并后的预期
 * @param observed 运行事实
 * @returns 失败原因清单；空数组表示通过
 */
export function evaluateLocal(exp: Expectation, observed: Observed): string[] {
  return [
    ...checkResults(exp, observed),
    ...checkOrderAndDuration(exp, observed),
    ...checkClient(exp, observed),
    ...checkGeneric(observed),
  ];
}
