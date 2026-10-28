import { DEFAULT_RETRY_STATUSES, PRIVATE_PREFIX, SUPPORTED_CAPABILITIES } from './constants.ts';
import type { PluginConfigs, RequestOptions, RequestSpec, Scenario } from './types.ts';
import { collectRequests, stepKind, STEP_KINDS, walkSteps } from './walk.ts';

/**
 * 能力映射表（代码版）。文字版见 accept/mapping.md，两者必须一致。
 * 这里只做纯数据与纯函数，不依赖 axp，dry-run 不需要打包产物。
 */

/** 一个选项的校验器：返回 null 表示可映射，返回字符串表示"映射不了"的原因 */
type OptionCheck = (value: unknown) => string | null;

const isNum: OptionCheck = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : '需要数字');
const isBool: OptionCheck = (v) => (typeof v === 'boolean' ? null : '需要布尔值');
const isStrList: OptionCheck = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : '需要字符串数组');
const isNumList: OptionCheck = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'number') ? null : '需要数字数组');
const isObj: OptionCheck = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? null : '需要对象');
/** 只接受指定取值 */
const oneOf = (...allowed: unknown[]): OptionCheck => (v) => (allowed.includes(v) ? null : `仅支持 ${allowed.map((x) => JSON.stringify(x)).join(' / ')}`);

/** 中立插件选项 → 是否可映射。键存在即"已映射"，校验器给出取值层面的限制 */
export const PLUGIN_OPTION_MAP: Record<string, Record<string, OptionCheck>> = {
  auth: { url_pattern: (v) => (typeof v === 'string' ? null : '需要字符串'), refresh: oneOf('endpoint'), refresh_query: isObj },
  cache: { ttl_ms: isNum, max: isNum, methods: isStrList },
  retry: { max: isNum, delay_ms: isNum, statuses: isNumList, methods: isStrList, respect_retry_after: isBool },
  share: { policy: oneOf('start', 'end', 'race') },
  loading: { delay_ms: isNum, delay_close_ms: isNum },
  notify: {},
  normalize: {},
  key: { scope: oneOf('user') },
  mock: { fallback_on_404: isBool },
  repath: {},
  filter: {},
  cancel: {},
  envs: {},
  log: {},
};

/** axp 没有对应能力、一律显式报错的插件 */
export const UNSUPPORTED_PLUGINS: readonly string[] = ['breaker', 'offline', 'timeout'];

/** 中立请求级选项 → 是否可映射；`breaker` 无对应能力，一律映射不了 */
export const REQUEST_OPTION_MAP: Record<string, OptionCheck> = {
  auth: isBool,
  cache: (v) => (typeof v === 'boolean' ? null : isObj(v) === null ? null : '需要 boolean 或 {ttl_ms,key}'),
  retry: (v) => (typeof v === 'boolean' || typeof v === 'number' ? null : isObj(v)),
  share: oneOf(true, false, 'start', 'end', 'race', 'none'),
  loading: isBool,
  silent: isBool,
  timeout_ms: isNum,
  key: (v) => (typeof v === 'boolean' || typeof v === 'string' ? null : '需要 boolean 或字符串'),
  mock: isBool,
  normalize: isBool,
  filter: isBool,
  breaker: () => 'axp 没有 breaker 能力',
};

/** 请求级 retry 对象里允许出现的键 */
const RETRY_OBJECT_KEYS = ['max', 'delay_ms', 'statuses', 'methods', 'respect_retry_after'];
/** 请求级 cache 对象里允许出现的键 */
const CACHE_OBJECT_KEYS = ['ttl_ms', 'key'];

/**
 * 检查中立插件配置能否映射到 axp。
 * @param plugins 场景的 client.plugins
 * @returns 映射不了的问题清单（空数组表示全部可映射）
 */
export function checkPluginConfigs(plugins: PluginConfigs | undefined): string[] {
  const issues: string[] = [];
  for (const [name, opts] of Object.entries(plugins ?? {})) {
    const table = PLUGIN_OPTION_MAP[name];
    if (!table) {
      if (!SUPPORTED_CAPABILITIES.has(name)) issues.push(`插件 ${name}: axp 没有该能力`);
      else issues.push(`插件 ${name}: 没有映射表`);
      continue;
    }
    for (const [k, v] of Object.entries(opts ?? {})) {
      const check = table[k];
      if (!check) issues.push(`插件 ${name}.${k}: 没有对应的 axp 参数`);
      else {
        const why = check(v);
        if (why) issues.push(`插件 ${name}.${k}: ${why}`);
      }
    }
  }
  return issues;
}

/**
 * 检查单个请求的中立选项能否映射。
 * @param req 请求 step
 * @returns 问题清单
 */
export function checkRequestOptions(req: RequestSpec): string[] {
  const issues: string[] = [];
  const opts = (req.options ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(opts)) {
    const check = REQUEST_OPTION_MAP[k];
    if (!check) {
      issues.push(`请求 ${req.id} 选项 ${k}: 没有对应的 axp 参数`);
      continue;
    }
    const why = check(v);
    if (why) issues.push(`请求 ${req.id} 选项 ${k}: ${why}`);
    if (k === 'retry' && v && typeof v === 'object') {
      for (const rk of Object.keys(v)) if (!RETRY_OBJECT_KEYS.includes(rk)) issues.push(`请求 ${req.id} 选项 retry.${rk}: 没有对应的 axp 参数`);
    }
    if (k === 'cache' && v && typeof v === 'object') {
      for (const ck of Object.keys(v)) if (!CACHE_OBJECT_KEYS.includes(ck)) issues.push(`请求 ${req.id} 选项 cache.${ck}: 没有对应的 axp 参数`);
    }
  }
  return issues;
}

/**
 * 检查一个场景的全部中立选项（插件配置、请求选项、step 类型）能否映射到 axp。
 * @param scenario 场景
 * @returns 去重后的问题清单；空数组表示全部可映射
 * @example validateScenarioMapping(sc) // ['插件 cache.foo: 没有对应的 axp 参数']
 */
export function validateScenarioMapping(scenario: Scenario): string[] {
  const issues = [...checkPluginConfigs(scenario.client?.plugins)];
  for (const req of collectRequests(scenario.steps)) issues.push(...checkRequestOptions(req));
  walkSteps(scenario.steps, (s, kind) => {
    if (!kind || !(STEP_KINDS as readonly string[]).includes(kind)) issues.push(`未知 step: ${JSON.stringify(Object.keys(s))}`);
  });
  return [...new Set(issues)];
}

/** 把 step 类型名收集出来，供测试核对"全部 step 都被解释" */
export function usedStepKinds(scenario: Scenario): Set<string> {
  const set = new Set<string>();
  walkSteps(scenario.steps, (s) => { const k = stepKind(s); if (k) set.add(k); });
  return set;
}

/** 映射后的 axios 请求级配置片段（键为 axp 实际读取的字段） */
export interface MappedRequestConfig {
  protected?: boolean;
  cache?: boolean | { expires?: number; key?: string };
  retry?: number | boolean | { max?: number; delay?: number; statusCodes?: number[]; methods?: string[]; respectRetryAfter?: boolean };
  share?: boolean | 'start' | 'end' | 'race' | 'none';
  loading?: boolean;
  silent?: boolean;
  timeout?: number;
  key?: boolean | string;
  mock?: boolean;
  normalize?: boolean;
  filter?: boolean;
}

/**
 * 翻译中立的 key 选项。中立语义：`true` 与 `'deep'` 都要把查询参数（及请求体）算进 key，`'simple'` 只看方法+路径。
 * axp 里 `key: true` 是 simple（只哈希 method+url，不含 `params`），所以：
 * 中立 `true`/`'deep'` → axp `'deep'`；中立 `'simple'` → axp `true`；其它字符串是显式 key，原样传。
 * @param key 中立 key 选项
 * @example mapKeyOption(true) // 'deep'
 */
export function mapKeyOption(key: boolean | string): boolean | string {
  if (key === true || key === 'deep') return 'deep';
  if (key === 'simple') return true;
  return key;
}

/**
 * 把中立的请求级选项翻译成 axp/axios 的请求配置字段。
 * - `key: 'simple'` 在 axp 里是 `key: true`（字符串 'simple' 会被当成字面 key）；
 * - 方法名转小写（axp 的 retry.methods 只认小写）。
 * @param options 中立请求选项
 * @returns axios 配置片段；未设置的选项不出现
 * @example mapRequestOptions({ cache: { ttl_ms: 300 }, auth: true }) // { cache: { expires: 300 }, protected: true }
 */
export function mapRequestOptions(options: RequestOptions | undefined): MappedRequestConfig {
  const o = options ?? {};
  const out: MappedRequestConfig = {};
  if (o.auth !== undefined) out.protected = o.auth;
  if (o.cache !== undefined) {
    out.cache = typeof o.cache === 'boolean' ? o.cache : { expires: o.cache.ttl_ms, key: o.cache.key };
  }
  if (o.retry !== undefined) {
    if (typeof o.retry === 'object') {
      const r = o.retry;
      out.retry = {
        max: r.max,
        delay: r.delay_ms,
        statusCodes: r.statuses,
        methods: r.methods?.map((m) => m.toLowerCase()),
        respectRetryAfter: r.respect_retry_after,
      };
    } else out.retry = o.retry;
  }
  if (o.share !== undefined) out.share = o.share;
  if (o.loading !== undefined) out.loading = o.loading;
  if (o.silent !== undefined) out.silent = o.silent;
  if (o.timeout_ms !== undefined) out.timeout = o.timeout_ms;
  if (o.key !== undefined) out.key = mapKeyOption(o.key);
  if (o.mock !== undefined) out.mock = o.mock;
  if (o.normalize !== undefined) out.normalize = o.normalize;
  if (o.filter !== undefined) out.filter = o.filter;
  return out;
}

/**
 * 把中立的 auth.url_pattern（路径前缀语义）翻译成 axp 的 URLPattern 列表：
 * 前缀本身 + 前缀/*，因为 axp 的 `/t/private` 只匹配精确路径。
 * @param pattern 中立前缀，缺省为 `/t/private`
 */
export function authUrlPatterns(pattern: string | undefined): string[] {
  const p = (pattern ?? PRIVATE_PREFIX).replace(/\/+$/, '');
  return [p, `${p}/*`];
}

/** 生效的重试状态列表：请求级优先，其次插件级，最后中立默认值 */
export function effectiveRetryStatuses(requestLevel: number[] | undefined, pluginLevel: number[] | undefined): number[] {
  return requestLevel ?? pluginLevel ?? [...DEFAULT_RETRY_STATUSES];
}
