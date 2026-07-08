import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import type { MaybeFun, Plugin } from '../types';
import { pluginLog, pluginError } from '../helper';
import AxpResponse from '../objects/Response';
import type { ITokenManager } from '../objects/TokenManager';

export const name = 'axp:auth';

/* ── 跨重发存活的 auth 状态标志：必须用可枚举字符串键，因为 axios.request 重发时的
 * mergeConfig 只保留可枚举字符串键（Symbol/非枚举键会被丢弃）。与 cancel 里用 Symbol
 * 私有 bag 存的"清理类"字段目的不同：前者要跨重发存活，后者要私有防 GC。
 *
 * Cross-resend auth state flags: must use enumerable string keys, because
 * axios.request's re-merge (mergeConfig) drops Symbol/non-enumerable keys.
 * Different purpose from cancel's Symbol-backed private bag: these need to
 * survive re-sends, that one needs to stay private and GC-safe. */
/** 缓存"是否受保护"的最终决策 / caches the final protected-decision (boolean). */
const DECISION = `${name}:decision`;
/** 本请求是受保护资源（请求侧设，响应侧读） / this request is protected (set on request side, read on response side). */
const PROTECTED = `${name}:protected`;
/** 已被 refresh/replay 重放过一次，防回环 / already replayed once via refresh/replay, guards against loops. */
const REFRESHED = `${name}:refreshed`;
/** 请求阶段已判定 deny，响应侧跳过重复触发 / denial already decided at request stage, response side skips re-triggering. */
const DENIED = `${name}:denied`;

/** 默认越权业务码，用于 `$synthDenied` 合成的响应 / default access-denied business code, used by `$synthDenied`'s synthesized response. */
export const ACCESS_DENIED_CODE = 'ACCESS_DENIED';

/**
 * 按 axios 实例存单飞 refresh 状态；若存在闭包局部变量里，`PluginManager#refresh()`
 * 重装所有插件时会把它清成 null，导致在途 refresh 失联、并发跑出第二个 onRefresh。
 * 存 WeakMap 才能跨闭包重建存活。
 *
 * Single-flight refresh state keyed per axios instance; if kept as a
 * closure-local variable, `PluginManager#refresh()`'s full plugin reinstall
 * would reset it to null, losing an in-flight refresh and letting a second
 * `onRefresh` race. A WeakMap survives closure rebuilds.
 */
const refreshStates = new WeakMap<AxiosInstance, { current: Promise<boolean> | null }>();


/* ── onFailure 路由动作 ──────────────────────────────────────────────────── */

/**
 * `onFailure` 路由决策枚举，驱动 5 种动作 / `onFailure` router's decision enum, driving 5 actions:
 *   - `Refresh` → 调 onRefresh 成功后原 config 重发 / calls onRefresh, re-sends same config on success
 *   - `Replay`  → 不刷新直接重发（并发已刷新/未带token/token不一致） / no refresh, re-sends directly (already refreshed concurrently / no token carried / token mismatch)
 *   - `Deny`    → 调 onAccessDenied，原样传播 / calls onAccessDenied, propagates unchanged
 *   - `Expired` → tm.clear() + onAccessExpired，原样传播 / tm.clear() + onAccessExpired, propagates unchanged
 *   - `Others`  → 与插件无关，原样传播；null/undefined/void 同此值 / unrelated to plugin, propagates unchanged; null/undefined/void treated the same
 */
export enum AuthFailureAction {
  /** 需要刷新——token 与 tm 当前一致（真过期） / needs refresh — carried token matches tm's current one (genuinely expired). */
  Refresh = 'refresh',
  /** 无需刷新直接重发——已被并发刷新或 token 不一致（stale） / no refresh needed, re-sends directly — already refreshed concurrently or token is stale. */
  Replay = 'replay',
  /** 越权拒绝——调用 onAccessDenied / access denied — calls onAccessDenied. */
  Deny = 'deny',
  /** 会话过期——tm.clear() 后调用 onAccessExpired / session expired — calls onAccessExpired after tm.clear(). */
  Expired = 'expired',
  /** 与插件无关，原样传播 / unrelated to this plugin, propagates unchanged. */
  Others = 'others',
}


/**
 * 默认 `onFailure` 工厂（柯里化）——按 header 字段名生成标准 OAuth 路由器。决策顺序：
 * 非401/403→Others；tm无token→401:Expired/403:Deny；未带token→Replay；带token且与tm
 * 一致→Refresh（真过期）；带token但不一致→Replay（已被并发刷新，stale）。
 *
 * Default `onFailure` factory (curried) — builds a standard OAuth router
 * keyed off the header field name. Decision order: not 401/403 → Others; tm
 * has no token → 401:Expired/403:Deny; no token carried → Replay; token
 * carried and matches tm → Refresh (genuinely expired); token carried but
 * mismatched → Replay (already refreshed concurrently, stale).
 *
 * 注：按 HTTP status 判定（401/403 走 onRejected）；信封式项目请自行提供 onFailure。
 *
 * Note: decides on HTTP status (401/403 go through onRejected); envelope-style
 * projects should supply their own `onFailure`.
 *
 * @param headerName 承载凭证的请求头字段名，默认 'Authorization' / header field carrying the credential, defaults to 'Authorization'.
 * @returns onFailure 路由函数 (tm, resp) => AuthFailureAction / an onFailure router function (tm, resp) => AuthFailureAction.
 */
export function authFailureFactory(headerName = 'Authorization') {
  const lower = headerName.toLowerCase();
  return (
    tm: Pick<ITokenManager, 'accessToken'>,
    resp: { status: number; config?: { headers?: unknown } },
  ): AuthFailureAction => {
    const s = resp.status;
    if (s !== 401 && s !== 403) return AuthFailureAction.Others;

    const cur = tm.accessToken;
    if (!cur) return s === 401 ? AuthFailureAction.Expired : AuthFailureAction.Deny;

    const h = resp.config?.headers as Record<string, unknown> | undefined;
    let carried: string | undefined;
    if (h) {
      const v = h[headerName] ?? (lower !== headerName ? h[lower] : undefined);
      if (typeof v === 'string' && v) carried = v;
    }
    if (!carried) return AuthFailureAction.Replay;

    return carried === cur ? AuthFailureAction.Refresh : AuthFailureAction.Replay;
  };
}

/** 默认 `onFailure` 单例 / default `onFailure` singleton: `authFailureFactory('Authorization')`. */
export const DEFAULT_ON_AUTH_FAILURE = /*#__PURE__*/ authFailureFactory();


/* ── 插件工厂 ────────────────────────────────────────────────────────────── */

/**
 * 鉴权插件——单一刷新窗口 + onFailure 五动作路由 / auth plugin — single shared refresh window plus the 5-action onFailure router.
 *   - 受保护判定：methods∩urlPattern 命中，可被 config.protected/isProtected 逐级覆盖，install 时编译一次
 *     protected-ness: methods∩urlPattern must hit, overridable by config.protected/isProtected, compiled once at install
 *   - 并发刷新协议：同一时刻最多一个 onRefresh，所有受保护请求共享窗口
 *     concurrent-refresh: at most one onRefresh at a time, shared by all protected requests
 *   - 请求侧：受保护无token→合成deny响应+终止；否则经 ready 注入凭证
 *     request side: protected w/o token → synthesizes deny response + aborts; otherwise injects credentials via ready
 *   - 响应侧：业务失败(!successful)或 401/403 → 经 onFailure 路由
 *     response side: business failure (!successful) or 401/403 → routed through onFailure
 *
 * 不再依赖 normalize 改写 response.data，改用 ApiResponse.fromResponse(response).successful 判定，自给自足。
 *
 * No longer relies on normalize rewriting `response.data` — decides via
 * `ApiResponse.fromResponse(response).successful` instead, self-contained.
 *
 * @param options 插件配置，见 {@link IAuthOptions}（tokenManager/onRefresh/onAccessExpired 必填） / plugin options, see {@link IAuthOptions} (tokenManager/onRefresh/onAccessExpired required).
 * @returns 可安装的 {@link Plugin}；cleanup 会摘除两个拦截器并清理该实例的 refresh 状态 / an installable {@link Plugin}; cleanup ejects both interceptors and clears the instance's refresh state.
 */
export default function axpAuth(options: IAuthOptions): Plugin {
  const cfg = $normalize(options);
  return {
    name,
    install(axios) {
      pluginLog(axios.defaults, `[${name}] enabled:${cfg.enable}`);
      if (!cfg.enable) return;

      const { tokenManager: tm, matchMethod, matchUrl } = cfg;
      let refreshState = refreshStates.get(axios);
      if (!refreshState) {
        refreshState = { current: null };
        refreshStates.set(axios, refreshState);
      }

      /** 包一层 try/catch 调用用户钩子，抛错只记 log 不外泄，避免单个回调炸掉整条状态机 / wraps a user hook call in try/catch — a thrown error is only logged, never leaked, so one callback can't break the whole state machine. */
      const safe = async <T>(label: string, fn: () => T | Promise<T>): Promise<T | undefined> => {
        try { return await fn(); }
        catch (e) { pluginError(axios.defaults, `[${name}] ${label} threw`, e); return undefined; }
      };

      /** 启动/加入唯一 refresh 流程，成功=!==false / starts/joins the single refresh flow; success = `!== false`. */
      const startRefresh = (resp: AxiosResponse): Promise<boolean> =>
        (refreshState.current ??= (async () => {
          try { return (await cfg.onRefresh(tm, resp)) !== false; }
          catch (e) { pluginError(axios.defaults, `[${name}] onRefresh threw`, e); return false; }
          finally { refreshState.current = null; }
        })());

      /** 判定过期：tm.clear() 后调用 onAccessExpired / handles expiry: tm.clear() then calls onAccessExpired. */
      const expire = async (resp: AxiosResponse): Promise<void> => {
        tm.clear();
        await safe('onAccessExpired', () => cfg.onAccessExpired(tm, resp));
      };

      const pluginIsProtected = cfg.isProtected;
      /** 判定请求是否受保护：先用重发缓存的 DECISION，否则按 config.protected → 插件 isProtected → methods∩urlPattern 依次尝试 / decides protected-ness: reuses cached DECISION on resend, else tries config.protected → plugin isProtected → methods∩urlPattern in order. */
      const isProtected = (config: AxiosRequestConfig): boolean => {
        const bag = config as Record<string, unknown>;
        const cached = bag[DECISION];
        // 重发优先，复用首发决策 / replay-first, reuse the initial decision.
        if (typeof cached === 'boolean') return cached;

        // protected/isProtected 抛错会连累"未保护"请求——捕获后降级到 methods/urlPattern，不让链路崩
        //
        // protected/isProtected throwing would drag down "unprotected" requests too — caught here, falls back to methods/urlPattern instead of crashing the chain
        try {
          const v = config.protected;
          if (v !== undefined) {
            const r = typeof v === 'function' ? (v as (c: AxiosRequestConfig) => unknown)(config) : v;
            if (typeof r === 'boolean') return r;
          }
          if (pluginIsProtected) {
            const r = pluginIsProtected(config);
            if (typeof r === 'boolean') return r;
          }
        } catch (e) {
          pluginError(config, `[${name}] protected/isProtected threw`, e);
        }
        if (matchMethod !== TRUE && !matchMethod((config.method || 'get').toLowerCase())) return false;
        return matchUrl(config.url ?? '');
      };

      // ─── 请求侧 ───
      const reqId = axios.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
        const bag = config as unknown as Record<string, unknown>;
        const prot = isProtected(config);
        bag[DECISION] = prot;
        if (!prot) { delete config.protected; return config; }
        bag[PROTECTED] = true;
        delete config.protected;

        if (refreshState.current) {
          if (!(await refreshState.current)) {
            bag[DENIED] = true;
            // 附 .config：cancel 插件靠 error.config 释放它的 AbortController，没有会永久泄漏
            //
            // attaches .config: cancel plugin releases its AbortController via error.config; without it, that controller leaks forever
            throw Object.assign(new Error(`[${name}] refresh failed; aborting request`), { config });
          }
        }
        if (!tm.accessToken) {
          bag[DENIED] = true;
          await safe('onAccessDenied', () => cfg.onAccessDenied(tm, $synthDenied(config, cfg.accessDeniedCode)));
          throw Object.assign(new Error(`[${name}] access denied`), { config });
        }
        await safe('ready', () => cfg.ready(tm, config));
        return config;
      });

      /**
       * 失败路由，onFulfilled/onRejected 共用；originalError 存在（onRejected 路径）时终态
       * reject 原 error，否则返回原 response。
       *
       * Failure router shared by onFulfilled/onRejected; when originalError is
       * present (onRejected path) terminal actions reject the original error,
       * otherwise return the original response.
       *
       * @param response 触发路由的响应对象 / the response that triggered routing.
       * @param config 该请求 config，用于重发/读写状态标志 / this request's config, used for re-sending and state flags.
       * @param originalError onRejected 路径的原始 error，onFulfilled 路径为 undefined / original error on onRejected path; undefined on onFulfilled path.
       * @returns 重发时为新响应 promise，否则返回/reject 原响应或原 error / a new response promise on re-send; otherwise the original response, or the original error rejected.
       */
      const handleFailure = async (
        response: AxiosResponse,
        config: AxiosRequestConfig,
        originalError?: unknown,
      ): Promise<AxiosResponse> => {
        const bag = config as Record<string, unknown>;
        const propagate = () => originalError !== undefined ? Promise.reject(originalError) : response;

        // 已重放过仍失败——兜底 expired，防回环 / already replayed and still failing — falls back to expired, guards against loops
        if (bag[REFRESHED] === true) {
          await expire(response);
          $clearFlags(bag);
          return propagate();
        }

        const action = (await safe('onFailure', () => cfg.onFailure(tm, response))) ?? AuthFailureAction.Others;

        switch (action) {
          case AuthFailureAction.Refresh: {
            if (await startRefresh(response)) {
              bag[REFRESHED] = true;
              pluginLog(config, `[${name}] refresh ok, retrying`);
              return axios.request(config);
            }
            await expire(response);
            $clearFlags(bag);
            return propagate();
          }
          case AuthFailureAction.Replay: {
            bag[REFRESHED] = true;
            pluginLog(config, `[${name}] replay (stale)`);
            return axios.request(config);
          }
          case AuthFailureAction.Deny: {
            await safe('onAccessDenied', () => cfg.onAccessDenied(tm, response));
            $clearFlags(bag);
            return propagate();
          }
          case AuthFailureAction.Expired: {
            await expire(response);
            $clearFlags(bag);
            return propagate();
          }
          default: {  // Others
            $clearFlags(bag);
            return propagate();
          }
        }
      };

      // ─── 响应侧（双路径） ───
      const resId = axios.interceptors.response.use(
        async (response: AxiosResponse) => {
          const config = response.config as AxiosRequestConfig | undefined;
          const bag = config as Record<string, unknown> | undefined;
          if (!bag?.[PROTECTED]) return response;
          if (bag[DENIED]) { $clearFlags(bag); return response; }
          if (AxpResponse.fromResponse(response).successful) { $clearFlags(bag); return response; }
          return handleFailure(response, config!);
        },
        async (error: unknown) => {
          const config = (error as { config?: AxiosRequestConfig })?.config;
          const bag = config as Record<string, unknown> | undefined;
          if (!bag?.[PROTECTED]) return Promise.reject(error);
          if (bag[DENIED]) { $clearFlags(bag); return Promise.reject(error); }
          const response = (error as { response?: AxiosResponse }).response;
          // 网络错误，无从路由 / network error, nothing to route on
          if (!response) return Promise.reject(error);
          return handleFailure(response, config!, error);
        },
      );

      return () => {
        axios.interceptors.request.eject(reqId);
        axios.interceptors.response.eject(resId);
        refreshStates.delete(axios);
      };
    },
  };
}


/* ── 纯模块级 helper ──────────────────────────────────────────────────────── */

/**
 * 合成越权拒绝的假响应——请求阶段发现无 token 时用，避免真的发请求，但仍走
 * onAccessDenied(tm, resp) 统一的 response-like 形状。
 *
 * Synthesizes a fake "access denied" response — used when no token is found
 * at request stage, avoiding a real request while still giving
 * `onAccessDenied(tm, resp)` a uniform response-like shape.
 *
 * @param config 触发合成的请求 config，挂到假响应 .config 上 / the request config, attached onto the fake response's .config.
 * @param code 业务码，写入 data.code / business code written into data.code.
 */
function $synthDenied(config: AxiosRequestConfig, code: string): AxiosResponse {
  return {
    data: { code, message: 'protected request without accessToken' },
    status: 0,
    statusText: '',
    headers: {},
    config: config as InternalAxiosRequestConfig,
  } as AxiosResponse;
}

/**
 * 清除本请求的 auth 跨重发标志（PROTECTED/REFRESHED/DENIED），路由到终态时调用，
 * 避免残留状态污染下次复用同一 config 的请求。
 *
 * Clears this request's cross-resend auth flags (PROTECTED/REFRESHED/DENIED),
 * called on reaching a terminal state — prevents leftover state from
 * contaminating a later request that reuses the same config.
 */
function $clearFlags(bag: Record<string, unknown>): void {
  delete bag[PROTECTED];
  delete bag[REFRESHED];
  delete bag[DENIED];
}


/* ── 受保护匹配编译（install 期一次性） ──────────────────────────────────── */

type Predicate = (s: string) => boolean;
const TRUE: Predicate = () => true;
const FALSE: Predicate = () => false;

/**
 * 编译 methods 选项为谓词：undefined/''/[] 恒false；'*' 或含'*'恒true；字符串单值比较；
 * 数组用 Set.has。
 *
 * Compiles the `methods` option into a predicate: undefined/''/[] → always
 * false; `'*'` or an array containing `'*'` → always true; a string compares
 * by value; an array uses `Set.has`.
 *
 * @internal exported for unit tests
 * @param m methods 选项 / the methods option.
 * @returns 判定（已小写）method 是否命中的谓词 / predicate matching a lowercased method string.
 */
export function $compileMethods(m: string | readonly string[] | undefined): Predicate {
  if (m == null) return FALSE;
  if (typeof m === 'string') {
    if (m === '*') return TRUE;
    if (m === '') return FALSE;
    const lower = m.toLowerCase();
    return (x) => x === lower;
  }
  if (m.length === 0) return FALSE;
  if (m.includes('*')) return TRUE;
  const set = new Set(m.map((s) => s.toLowerCase()));
  return (x) => set.has(x);
}

/**
 * 编译 urlPattern 选项为谓词：undefined/[] 恒false；'*'/['*'] 恒true；否则用 URLPattern
 * （不可用回退正则），'*' 任意、':name' 单段、'!' 前缀否定。
 *
 * Compiles the `urlPattern` option into a predicate: undefined/[] → always
 * false; `'*'`/`['*']` → always true; otherwise uses `URLPattern` (falls back
 * to regex), where `*` matches anything, `:name` matches one segment, and a
 * `!` prefix negates.
 *
 * @internal exported for unit tests
 * @param p urlPattern 选项 / the urlPattern option.
 * @returns 判定 URL pathname 是否命中的谓词 / predicate matching a URL pathname.
 */
export function $compileUrlPatterns(p: string | readonly string[] | undefined): Predicate {
  const arr = p == null ? [] : Array.isArray(p) ? p : [p as string];
  if (arr.length === 0) return FALSE;
  if (arr.length === 1 && arr[0] === '*') return TRUE;

  const Ctor = $getURLPattern();
  const includes: Predicate[] = [];
  const excludes: Predicate[] = [];
  for (const raw of arr) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const isNeg = raw.charCodeAt(0) === 33; // '!'
    const m = $compileOne(Ctor, isNeg ? raw.slice(1) : raw);
    if (m) (isNeg ? excludes : includes).push(m);
  }

  if (includes.length === 0 && excludes.length === 0) return FALSE;
  if (excludes.length === 0) {
    return includes.length === 1 ? includes[0] : (url) => includes.some((m) => m(url));
  }
  return (url) => {
    if (includes.length && !includes.some((m) => m(url))) return false;
    return !excludes.some((m) => m(url));
  };
}

/** 编译单个模式串：优先 URLPattern，失败/不可用回退 $patternToRegex / compiles one pattern: prefers URLPattern, falls back to $patternToRegex. */
function $compileOne(Ctor: typeof URLPattern | null, pat: string): Predicate | null {
  if (Ctor) {
    try {
      const p = new Ctor({ pathname: pat });
      return (url) => { try { return p.test({ pathname: url }); } catch { return false; } };
    } catch { /* fall through to regex */ }
  }
  const re = $patternToRegex(pat);
  return re ? (url) => re.test(url) : null;
}

/**
 * URLPattern pathname 子集转正则：'*'⇒.*，':name'⇒[^/]+，其余转义为字面量。
 *
 * URLPattern pathname subset to regex: `*` ⇒ `.*`, `:name` ⇒ `[^/]+`,
 * everything else escaped as a literal.
 *
 * @internal exported for unit tests
 * @param pat URLPattern pathname 语法模式串 / pattern string in URLPattern pathname syntax.
 * @returns 编译得到的正则，解析失败返回 null / the compiled regex, or null if parsing fails.
 */
export function $patternToRegex(pat: string): RegExp | null {
  try {
    const NAMED = ' NAMED ', STAR = ' STAR ';
    const tokenized = pat.replace(/:[A-Za-z_$][\w$]*/g, NAMED).replace(/\*/g, STAR);
    const escaped = tokenized.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const body = escaped.replace(new RegExp(NAMED, 'g'), '[^/]+').replace(new RegExp(STAR, 'g'), '.*');
    return new RegExp(`^${body}/?$`);
  } catch { return null; }
}

/** 探测全局是否有 URLPattern（部分运行时/旧浏览器没有） / probes whether URLPattern exists globally (missing on some runtimes/older browsers). */
function $getURLPattern(): typeof URLPattern | null {
  const G = (globalThis as { URLPattern?: typeof URLPattern }).URLPattern;
  return typeof G === 'function' ? G : null;
}


/* ── 归一化插件级配置 ─────────────────────────────────────────────────────── */

const DEFAULT_METHODS = '*';
const DEFAULT_URL_PATTERN = '*';

/** 缺省 ready：把 tm.accessToken 写入 Authorization 头 / default ready: writes tm.accessToken into the Authorization header. */
function defaultReady(tm: ITokenManager, config: AxiosRequestConfig): void {
  const token = tm.accessToken;
  if (!token) return;
  const h = config.headers as { set?: (k: string, v: string) => void } | undefined;
  if (h && typeof h.set === 'function') h.set('Authorization', token);
  else config.headers = { ...(config.headers as object), Authorization: token } as never;
}

/** `$normalize` 的输出——从 {@link IAuthOptions} 补全默认值/编译谓词后的内部配置 / `$normalize`'s output — internal config after filling defaults / compiling predicates from {@link IAuthOptions}. @internal */
export interface IAuthConfig {
  /** 总开关（默认 true） / master switch (default true). */
  enable: boolean;
  /** token 管理器，来自 options / token manager, from options. */
  tokenManager: ITokenManager;
  /** 响应侧路由（默认 DEFAULT_ON_AUTH_FAILURE） / response-side router (default DEFAULT_ON_AUTH_FAILURE). */
  onFailure: TAuthFunc<AuthFailureAction | null | undefined | void>;
  /** 刷新实现，来自 options（必填） / refresh implementation, from options (required). */
  onRefresh: TAuthFunc<unknown>;
  /** 禁止访问回调（默认回退 onAccessExpired） / access-denied callback (default falls back to onAccessExpired). */
  onAccessDenied: TAuthFunc<void>;
  /** 过期回调，来自 options（必填） / expiry callback, from options (required). */
  onAccessExpired: TAuthFunc<void>;
  /** 请求侧凭证注入（默认 defaultReady） / request-side credential injection (default defaultReady). */
  ready: TAuthFunc<void, AxiosRequestConfig>;
  /** 编译好的 method 谓词，见 $compileMethods / compiled method predicate, see $compileMethods. */
  matchMethod: Predicate;
  /** 编译好的 URL 谓词，见 $compileUrlPatterns / compiled URL predicate, see $compileUrlPatterns. */
  matchUrl: Predicate;
  /** 插件级判定函数，来自 options（可选） / plugin-level predicate, from options (optional). */
  isProtected?: (config: AxiosRequestConfig) => boolean | null | undefined | void;
  /** 越权响应业务码（默认 ACCESS_DENIED_CODE） / access-denied business code (default ACCESS_DENIED_CODE). */
  accessDeniedCode: string;
}

/**
 * 校验并归一化 IAuthOptions：填充默认值、编译 methods/urlPattern 为谓词、校验必填字段；
 * 在 axpAuth 工厂调用时执行一次。
 *
 * Validates and normalizes {@link IAuthOptions}: fills defaults, compiles
 * methods/urlPattern into predicates, validates required fields; runs once
 * when the `axpAuth` factory is called.
 *
 * @internal exported for unit tests
 * @param opts 用户传入的插件选项 / the user-supplied plugin options.
 * @returns 归一化后的内部配置 IAuthConfig / the normalized internal config, {@link IAuthConfig}.
 * @throws 缺少 tokenManager/onRefresh/onAccessExpired 任一项时抛错 / throws if tokenManager/onRefresh/onAccessExpired is missing.
 */
export function $normalize(opts: IAuthOptions): IAuthConfig {
  if (!opts || !opts.tokenManager) throw new Error(`[${name}] options.tokenManager is required`);
  if (typeof opts.onRefresh !== 'function') throw new Error(`[${name}] options.onRefresh is required`);
  if (typeof opts.onAccessExpired !== 'function') throw new Error(`[${name}] options.onAccessExpired is required`);
  return {
    enable: opts.enable ?? true,
    tokenManager: opts.tokenManager,
    onFailure: opts.onFailure ?? DEFAULT_ON_AUTH_FAILURE,
    onRefresh: opts.onRefresh,
    onAccessDenied: opts.onAccessDenied ?? opts.onAccessExpired,  // 缺省回退 expired
    onAccessExpired: opts.onAccessExpired,
    ready: opts.ready ?? defaultReady,
    matchMethod: $compileMethods(opts.methods ?? DEFAULT_METHODS),
    matchUrl: $compileUrlPatterns(opts.urlPattern ?? DEFAULT_URL_PATTERN),
    isProtected: opts.isProtected,
    accessDeniedCode: opts.accessDeniedCode ?? ACCESS_DENIED_CODE,
  };
}


/* ── 类型 ─────────────────────────────────────────────────────────────────── */

/** 所有 auth 钩子的统一 shape (tm, ctx)=>T（ready 的第二参是 config） / uniform shape for all auth hooks: (tm, ctx)=>T (ready's second arg is config). */
export type TAuthFunc<T, C = AxiosResponse> = (TM: ITokenManager, ctx: C) => T | Promise<T>;

export interface IAuthOptions {
  /** 总开关，默认 true / master switch, defaults to true. */
  enable?: boolean;
  /** token 管理器（accessToken/refreshToken/clear/canRefresh） / token manager (accessToken/refreshToken/clear/canRefresh). */
  tokenManager: ITokenManager;
  /** 受保护 method 白名单（小写），'*' 通配，与 urlPattern 取交集，默认 '*' / whitelist of protected methods (lowercase), '*' matches anything, intersected with urlPattern, defaults to '*'. */
  methods?: string | string[];
  /** 受保护 URL pathname 模式（URLPattern 语法，'!' 前缀否定），默认 '*' / protected URL pathname pattern(s) (URLPattern syntax, '!' negates), defaults to '*'. */
  urlPattern?: string | string[];
  /** 函数式插件级判定（叠加在 methods+urlPattern 上），返回 boolean 即终值 / function-based plugin-level predicate (layered on methods+urlPattern); a boolean return is final. */
  isProtected?: (config: AxiosRequestConfig) => boolean | null | undefined | void;
  /** 请求阶段越权合成响应的业务码，默认 'ACCESS_DENIED' / business code for the request-stage synthesized deny response, defaults to 'ACCESS_DENIED'. */
  accessDeniedCode?: string;
  /** 响应侧统一路由→5动作之一，默认 DEFAULT_ON_AUTH_FAILURE（标准OAuth） / response-side router → one of 5 actions, defaults to DEFAULT_ON_AUTH_FAILURE (standard OAuth). */
  onFailure?: TAuthFunc<AuthFailureAction | null | undefined | void>;
  /** 必填：刷新实现；onFailure=Refresh 时调用，返回false/抛错=失败，同窗口并发共享一次 / required: refresh implementation; called on onFailure=Refresh, false/throw=failure, shared once across concurrent requests in the same window. */
  onRefresh: TAuthFunc<unknown>;
  /** 禁止访问回调（无token/onFailure=Deny），未配置回退 onAccessExpired / access-denied callback (no token / onFailure=Deny), falls back to onAccessExpired if unset. */
  onAccessDenied?: TAuthFunc<void>;
  /** 必填：过期回调（Expired/刷新失败/重放后仍失败），调用前已 tm.clear() / required: expiry callback (Expired / refresh failed / still failing after replay), tm.clear() already called before this fires. */
  onAccessExpired: TAuthFunc<void>;
  /** 受保护请求发送前注入凭证，默认写 tm.accessToken 到 Authorization 头 / injects credentials before sending a protected request, defaults to writing tm.accessToken into the Authorization header. */
  ready?: TAuthFunc<void, AxiosRequestConfig>;
}

// 锁住 .name（严格模式 ESM 下函数 .name 只读，minify 后仍保持可读的插件名）
Object.defineProperty(axpAuth, 'name', { value: name, configurable: true });


declare module 'axios' {
  interface AxiosRequestConfig {
    /** 请求级是否受保护，单次覆盖插件级判定：true/false 强制，或函数 MaybeFun / request-level protected override: true/false forces it, or a MaybeFun. */
    protected?: MaybeFun<boolean | undefined | null | void>;
  }
}
