import { PRIVATE_PREFIX, SUPPORTED_CAPABILITIES } from "./constants.ts";
import type { NetworkName, Style } from "./constants.ts";
import type { Expectation, PluginConfigs, RequestOptions, RequestSpec, ResultExpect, Scenario } from "./types.ts";
import { collectRequests, stepKind, STEP_KINDS, walkSteps } from "./walk.ts";

/**
 * 能力映射表（代码版）。文字版见 accept/mapping.md，两者必须一致。
 * 这里只做纯数据与纯函数，不依赖 axp，dry-run 不需要打包产物。
 */

/** 一个选项的校验器：返回 null 表示可映射，返回字符串表示"映射不了"的原因 */
type OptionCheck = (value: unknown) => string | null;

/** 中立 key 选项：与 `true` 同义，查询参数和请求体都算进 key */
const KEY_DEEP = "deep";
/** 中立 key 选项：只看方法+路径（新 key 服务没有这个模式，映射不了） */
const KEY_SIMPLE = "simple";
/** 中立 share 选项里的"不共享"：新架构没有 'none' 策略，等价于 false */
const SHARE_NONE = "none";
/** `key: 'simple'` 映射不了的原因：新 key 服务始终把 params（及请求体）算进 key */
const KEY_SIMPLE_UNSUPPORTED = `axp 的 key 服务始终含 params 与请求体，没有 '${KEY_SIMPLE}'（只看方法+路径）模式`;

/** 将中立配置的方法列表转成 axp 使用的小写方法。
 * @param list 中立配置里的方法列表。
 * @returns 保持顺序的小写方法。
 * @example `lowerMethods(['GET']) // ['get']`
 */
export function lowerMethods(list: string[]): string[] {
  return list.map(/** 保留方法顺序与空数组含义。 */ (method) => method.toLowerCase());
}

const isNum: OptionCheck = (v) => (typeof v === "number" && Number.isFinite(v) ? null : "需要数字");
const isBool: OptionCheck = (v) => (typeof v === "boolean" ? null : "需要布尔值");
const isStrList: OptionCheck = (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? null : "需要字符串数组");
const isNumList: OptionCheck = (v) => (Array.isArray(v) && v.every((x) => typeof x === "number") ? null : "需要数字数组");
const isObj: OptionCheck = (v) => (v && typeof v === "object" && !Array.isArray(v) ? null : "需要对象");
/** 只接受指定取值 */
const oneOf =
  (...allowed: unknown[]): OptionCheck =>
  (v) =>
    allowed.includes(v) ? null : `仅支持 ${allowed.map((x) => JSON.stringify(x)).join(" / ")}`;

/**
 * 中立插件选项 → 是否可映射。键存在即"已映射"，校验器给出取值层面的限制。
 * 其中 cancel / key / normalize / log 在 axp 里是内核能力，不再装配插件（见 KERNEL_CAPABILITIES），
 * 但中立 schema 仍有这些选项，所以保留登记：`key.scope` 落到客户端的 key 配置，其余无需落地。
 */
export const PLUGIN_OPTION_MAP: Record<string, Record<string, OptionCheck>> = {
  auth: { url_pattern: (v) => (typeof v === "string" ? null : "需要字符串"), refresh: oneOf("endpoint"), refresh_query: isObj },
  cache: { ttl_ms: isNum, max: isNum, methods: isStrList },
  retry: { max: isNum, delay_ms: isNum, statuses: isNumList, methods: isStrList, respect_retry_after: isBool },
  share: { policy: oneOf("start", "end", "race") },
  loading: { delay_ms: isNum, delay_close_ms: isNum },
  notify: {},
  normalize: {},
  key: { scope: oneOf("user") },
  mock: { fallback_on_404: isBool },
  repath: {},
  filter: {},
  cancel: {},
  envs: {},
  log: {},
};

/** axp 没有对应能力、一律显式报错的插件 */
export const UNSUPPORTED_PLUGINS: readonly string[] = ["breaker", "offline", "timeout"];

/** 校验中立请求级 key：布尔或字符串；`'simple'` 映射不了 */
const checkKeyOption: OptionCheck = (v) => {
  if (v === KEY_SIMPLE) return KEY_SIMPLE_UNSUPPORTED;
  return typeof v === "boolean" || typeof v === "string" ? null : "需要 boolean 或字符串";
};

/** 中立请求级选项 → 是否可映射；`breaker` 无对应能力，一律映射不了 */
export const REQUEST_OPTION_MAP: Record<string, OptionCheck> = {
  auth: isBool,
  cache: (v) => (typeof v === "boolean" ? null : isObj(v) === null ? null : "需要 boolean 或 {ttl_ms,key}"),
  retry: (v) => (typeof v === "boolean" || typeof v === "number" ? null : isObj(v)),
  share: oneOf(true, false, "start", "end", "race", "none"),
  loading: isBool,
  silent: isBool,
  timeout_ms: isNum,
  key: checkKeyOption,
  mock: isBool,
  normalize: isBool,
  filter: isBool,
  breaker: () => "axp 没有 breaker 能力",
};

/** 请求级 retry 对象里允许出现的键 */
const RETRY_OBJECT_KEYS = ["max", "delay_ms", "statuses", "methods", "respect_retry_after"];
/** 请求级 cache 对象里允许出现的键 */
const CACHE_OBJECT_KEYS = ["ttl_ms", "key"];

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
    if (k === "retry" && v && typeof v === "object") {
      for (const rk of Object.keys(v)) if (!RETRY_OBJECT_KEYS.includes(rk)) issues.push(`请求 ${req.id} 选项 retry.${rk}: 没有对应的 axp 参数`);
    }
    if (k === "cache" && v && typeof v === "object") {
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
  walkSteps(scenario.steps, (s) => {
    const k = stepKind(s);
    if (k) set.add(k);
  });
  return set;
}

/** 映射后的 axios 请求级配置片段（键为 axp 实际读取的字段） */
export interface MappedRequestConfig {
  protected?: boolean;
  cache?: boolean | { expires?: number; key?: string };
  retry?: number | boolean | { max?: number; delay?: number; statusCodes?: number[]; methods?: string[]; respectRetryAfter?: boolean };
  share?: boolean | "start" | "end" | "race";
  loading?: boolean;
  silent?: boolean;
  timeout?: number;
  key?: boolean | string;
  mock?: boolean;
  /** 可预期失败也 resolve 出 `ok: false` 的响应而不抛出（对应中立 `normalize: false`） */
  throws?: boolean;
  filter?: boolean;
}

/**
 * 翻译中立的 key 选项。新 key 服务默认就把 method+url+params（有请求体的方法再加 data）算进 key，
 * 所以中立 `true` 与 `'deep'` 都对应 axp 的 `true`（默认行为）；`false` 与显式字符串原样传。
 * 注意 `'deep'` 在新 API 里已删除，原样传会被当成一条字面 key，必须翻译掉。
 * @param key 中立 key 选项
 * @returns axp 请求级 key
 * @throws `'simple'` 在新 key 服务里没有对应模式，抛"映射不了"（正常流程里 validateScenarioMapping 已提前拦截）
 * @example mapKeyOption('deep') // true
 */
export function mapKeyOption(key: boolean | string): boolean | string {
  if (key === KEY_SIMPLE) throw new Error(`映射不了: key ${KEY_SIMPLE_UNSUPPORTED}`);
  return key === KEY_DEEP ? true : key;
}

/** axp cache 插件的选项（执行器会传的那几项） */
export interface MappedCacheOptions {
  /** 缓存有效期，毫秒 */
  expires?: number;
  /** LRU 容量 */
  max?: number;
  /** 允许缓存的方法（小写）；不传时用 axp 默认 get/head，与中立默认一致 */
  methods?: string[];
}

/**
 * 把中立的 `cache` 插件选项翻译成 axp cache 插件选项。
 * `methods` 直接作为插件选项传入（转小写），不再靠 shouldCache 叠加；未写时不传，沿用 axp 默认的 GET/HEAD。
 * @param cfg 中立 cache 插件选项
 * @returns axp 插件选项；未设置的项不出现
 * @example mapCacheOptions({ ttl_ms: 300, methods: ['GET', 'POST'] }) // { expires: 300, methods: ['get', 'post'] }
 */
export function mapCacheOptions(cfg: { ttl_ms?: number; max?: number; methods?: string[] }): MappedCacheOptions {
  const out: MappedCacheOptions = {};
  if (cfg.ttl_ms !== undefined) out.expires = cfg.ttl_ms;
  if (cfg.max !== undefined) out.max = cfg.max;
  if (cfg.methods !== undefined) out.methods = lowerMethods(cfg.methods);
  return out;
}

/**
 * 把中立的请求级选项翻译成 axp/axios 的请求配置字段。
 * - `key: true` / `'deep'` 都是 axp 的 `key: true`（默认含参数）；`'simple'` 映射不了，会抛错；
 * - `share: 'none'` 翻成 `false`（新架构没有 'none' 策略）；
 * - `normalize: false` 翻成 `throws: false`，由 client-factory 的 `passBusinessFailure` 只放行业务码失败（HTTP、网络失败照常算失败）；`normalize: true` 是内核默认，不输出；
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
    out.cache = typeof o.cache === "boolean" ? o.cache : { expires: o.cache.ttl_ms, key: o.cache.key };
  }
  if (o.retry !== undefined) {
    if (typeof o.retry === "object") {
      const r = o.retry;
      out.retry = {
        max: r.max,
        delay: r.delay_ms,
        statusCodes: r.statuses,
        methods: r.methods === undefined ? undefined : lowerMethods(r.methods),
        respectRetryAfter: r.respect_retry_after,
      };
    } else out.retry = o.retry;
  }
  if (o.share !== undefined) out.share = o.share === SHARE_NONE ? false : o.share;
  if (o.loading !== undefined) out.loading = o.loading;
  if (o.silent !== undefined) out.silent = o.silent;
  if (o.timeout_ms !== undefined) out.timeout = o.timeout_ms;
  if (o.key !== undefined) out.key = mapKeyOption(o.key);
  if (o.mock !== undefined) out.mock = o.mock;
  if (o.normalize === false) out.throws = false;
  if (o.filter !== undefined) out.filter = o.filter;
  return out;
}

/**
 * 把中立的 auth.url_pattern（路径前缀语义）翻译成 axp 的 URLPattern 列表：
 * 前缀本身 + 前缀/*，因为 axp 的 `/t/private` 只匹配精确路径。
 * @param pattern 中立前缀，缺省为 `/t/private`
 */
export function authUrlPatterns(pattern: string | undefined): string[] {
  const p = (pattern ?? PRIVATE_PREFIX).replace(/\/+$/, "");
  return [p, `${p}/*`];
}

/**
 * 补上中立语义里"请求不写就不生效"的两个请求级默认。它们和 axp 的默认相反，只能由请求级选项对齐：
 * - `key`：中立语义是请求写 `key: true` 才生成 key（没生成就不能误合并、误缓存）；axp 的 key 默认惰性自动生成，所以没写时显式关闭；
 * - `filter`：中立语义是装配了 filter、请求又没写 `filter: true` 时原样发送；axp 的 filter 装上即生效，所以没写时显式关闭。
 * @param config mapRequestOptions 的结果
 * @param plugins 场景的中立插件配置（只在装了 filter 时才补 `filter: false`）
 * @returns 补完默认的请求级配置（新对象）
 * @example withNeutralDefaults({}, { filter: {} }) // { key: false, filter: false }
 */
export function withNeutralDefaults(config: MappedRequestConfig, plugins: PluginConfigs | undefined): MappedRequestConfig {
  const out = { ...config };
  if (out.key === undefined) out.key = false;
  if (plugins?.filter !== undefined && out.filter === undefined) out.filter = false;
  return out;
}

/** 跳过理由：axp 把归一化做进内核、不能关闭，testkit D21 的"未装 normalize 时业务码透传"在 axp 上不适用 */
export const SKIP_NORMALIZE_KERNEL = "axp 归一化为内核能力，不支持关闭；testkit D21 的“未装 normalize 时业务码透传”不适用";
/** 跳过理由：场景在 blackhole 下期望 timeout，却没有配置任何超时，请求挂住直到运行被强制结束 */
export const SKIP_BLACKHOLE_NO_TIMEOUT = "场景未配置超时，blackhole 下请求无法落定";

/** 注入"HTTP 状态"的查询参数名（CONTRACT §3） */
const QUERY_STATUS = "status";
/** 注入"业务码"的查询参数名（CONTRACT §3） */
const QUERY_CODE = "code";
/** 没注入 status 时的 HTTP 状态，也是 2xx 区间的起点 */
const HTTP_OK = 200;
/** 2xx 区间的终点（不含） */
const HTTP_SUCCESS_END = 300;
/** 业务成功的码 */
const CODE_OK = 0;
/** 预期里"超时"类别的名字 */
const EXPECT_TIMEOUT = "timeout";

/**
 * 判断一个请求按服务端规则会不会返回"HTTP 2xx + 非 0 业务码"的纯业务失败（CONTRACT 附录 A.4、B.1）：
 * http 风格下 HTTP 状态取 `status`，business 风格下一律 200；业务码取 `code`，没写就取 `status`（`status` 为 200 时取 0）。
 * @param query 请求的查询参数
 * @param style 响应风格
 * @returns 是纯业务失败时为 true
 * @example injectsBusinessFailure({ status: 500 }, 'business') // true；同样的请求在 'http' 下是 HTTP 500，返回 false
 */
export function injectsBusinessFailure(query: Record<string, unknown> | undefined, style: Style): boolean {
  const status = Number(query?.[QUERY_STATUS] ?? HTTP_OK);
  const code = query?.[QUERY_CODE] === undefined ? (status === HTTP_OK ? CODE_OK : status) : Number(query[QUERY_CODE]);
  const httpStatus = style === "http" ? status : HTTP_OK;
  return Number.isFinite(code) && code !== CODE_OK && httpStatus >= HTTP_OK && httpStatus < HTTP_SUCCESS_END;
}

/** 某个请求 id 在预期里的结果（repeat 展开的 `id#i` 也算该请求） */
function resultsOf(exp: Expectation, id: string): ResultExpect[] {
  return Object.entries(exp.results ?? {})
    .filter(([key]) => key === id || key.startsWith(`${id}#`))
    .map(([, r]) => r);
}

/**
 * 判断一个 网络×风格 格子在 axp 上是否不适用，不适用就跳过（返回理由，适用返回 null）。两条规则：
 * 1. testkit D21：场景没装 normalize，却期望某个被注入"HTTP 2xx + 非 0 业务码"的请求成功（`ok: true`，业务码透传）。
 *    axp 的归一化是内核能力、不能关闭，这类请求一定判失败，所以跳过；请求自己写了 `normalize: false` 的不算（映射成 `throws: false`，本来就 resolve）。
 * 2. blackhole：期望某个请求 `timeout`，场景却没有 `base_timeout_ms`，请求也没有 `timeout_ms`，请求会一直挂到运行被强制结束，无法落定。
 * @param scenario 场景
 * @param network 网络预设名
 * @param style 响应风格
 * @param exp 该格子合并后的预期
 * @returns 跳过理由；适用返回 null
 * @example inapplicableReason(sc, 'normal', 'business', exp) // SKIP_NORMALIZE_KERNEL
 */
export function inapplicableReason(scenario: Scenario, network: NetworkName, style: Style, exp: Expectation): string | null {
  const requests = collectRequests(scenario.steps);
  if (scenario.client?.plugins?.normalize === undefined) {
    const passthrough = requests.some((req) => req.options?.normalize !== false && injectsBusinessFailure(req.query, style) && resultsOf(exp, req.id).some((r) => r.ok === true));
    if (passthrough) return SKIP_NORMALIZE_KERNEL;
  }
  if (network === "blackhole" && scenario.client?.base_timeout_ms === undefined) {
    const hangs = requests.some((req) => req.options?.timeout_ms === undefined && resultsOf(exp, req.id).some((r) => [r.error].flat().includes(EXPECT_TIMEOUT)));
    if (hangs) return SKIP_BLACKHOLE_NO_TIMEOUT;
  }
  return null;
}
