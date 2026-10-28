import type { Range } from "./types.ts";

/** 判断是不是普通对象 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * 子集匹配：对象只比较预期里列出的键，数组要求长度一致并逐项子集匹配，原始值严格相等。
 * @param actual 实际值
 * @param expected 预期（子集）
 * @param where 当前路径，用于报错，默认 `data`
 * @returns 差异清单；空数组表示匹配
 * @example subsetMatch({ meta: { auth: 'u1', hit: 1 } }, { meta: { auth: 'u1' } }) // []
 */
export function subsetMatch(actual: unknown, expected: unknown, where = "data"): string[] {
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return [`${where}: 期望对象，实际 ${describe(actual)}`];
    const diffs: string[] = [];
    for (const [k, ev] of Object.entries(expected)) {
      if (!(k in actual)) diffs.push(`${where}.${k}: 缺失，期望 ${JSON.stringify(ev)}`);
      else diffs.push(...subsetMatch(actual[k], ev, `${where}.${k}`));
    }
    return diffs;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${where}: 期望数组，实际 ${describe(actual)}`];
    if (actual.length !== expected.length) return [`${where}: 数组长度 ${actual.length} ≠ ${expected.length}`];
    return expected.flatMap((ev, i) => subsetMatch(actual[i], ev, `${where}[${i}]`));
  }
  return Object.is(actual, expected) || actual === expected ? [] : [`${where}: 实际 ${describe(actual)}，期望 ${JSON.stringify(expected)}`];
}

/** 简短描述一个值，用于报错 */
function describe(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/**
 * 区间断言：支持 eq / min / max 的任意组合。
 * @param label 断言名称，用于报错
 * @param value 实际值
 * @param range 预期区间
 * @returns 违规描述；满足返回 null
 * @example checkRange('total', 3, { min: 1, max: 5 }) // null
 */
export function checkRange(label: string, value: number, range: Range): string | null {
  if (range.eq !== undefined && value !== range.eq) return `${label}: 实际 ${value}，期望 = ${range.eq}`;
  if (range.min !== undefined && value < range.min) return `${label}: 实际 ${value}，期望 ≥ ${range.min}`;
  if (range.max !== undefined && value > range.max) return `${label}: 实际 ${value}，期望 ≤ ${range.max}`;
  return null;
}

/**
 * 校验落定顺序：只看预期里列出的 id，它们在实际顺序里的相对先后必须一致。
 * @param actual 实际落定顺序（请求 id 列表）
 * @param expected 预期顺序
 * @returns 违规描述；满足返回 null
 * @example checkOrder(['a', 'x', 'b'], ['a', 'b']) // null
 */
export function checkOrder(actual: readonly string[], expected: readonly string[]): string | null {
  const want = new Set(expected);
  const filtered = actual.filter((id) => want.has(id));
  const missing = expected.filter((id) => !filtered.includes(id));
  if (missing.length) return `order: 请求未落定 ${missing.join(",")}`;
  if (filtered.length !== expected.length || filtered.some((id, i) => id !== expected[i])) {
    return `order: 实际 [${filtered.join(",")}]，期望 [${expected.join(",")}]`;
  }
  return null;
}

/** 服务端观测（GET /t/runs/{run} 的 data） */
export interface Observation {
  total: number;
  inflight: number;
  peak_inflight: number;
  by_key: Record<string, number>;
  by_path: Record<string, number>;
  log: Array<{ aborted?: boolean; [k: string]: unknown }>;
}

/**
 * 推断某个请求是否到达了服务器：比较请求前后两次观测。
 * 有 key 时按 by_key 增量判断（排除并发里其它请求的干扰），没有就用 total 增量。
 * @param before 请求发出前的观测
 * @param after 请求落定后的观测
 * @param serverKey 请求在服务端的分组键（`METHOD /path` 或 query.key），未知传 undefined
 * @returns true 表示到达服务器（不是缓存命中）
 * @example reachedServer(before, after, 'GET /t/echo')
 */
export function reachedServer(before: Observation, after: Observation, serverKey: string | undefined): boolean {
  if (serverKey !== undefined) return (after.by_key[serverKey] ?? 0) - (before.by_key[serverKey] ?? 0) > 0;
  return after.total - before.total > 0;
}

/**
 * 计算请求在服务端的分组键：query 里显式给了 `key` 就用它，否则是 `METHOD /path`；
 * 路径含 `{var}`（repath 之后才确定）时无法预知，返回 undefined。
 * @param method 请求方法
 * @param path 请求路径
 * @param query 查询参数
 */
export function serverKeyOf(method: string, path: string, query: Record<string, unknown> | undefined): string | undefined {
  const key = query?.key;
  if (key !== undefined) return typeof key === "string" ? key : JSON.stringify(key);
  if (/[{}[\]]|\/:[A-Za-z_]/.test(path)) return undefined;
  return `${method.toUpperCase()} ${path}`;
}

/**
 * 统计日志里被客户端中止的请求数。
 * @param obs 服务端观测
 */
export function countAborted(obs: Observation): number {
  return obs.log.filter((l) => l.aborted === true).length;
}
