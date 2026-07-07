import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import type { MaybeFun, Plugin } from '../types';
import { __DEV__ } from '../helper';
import AxpResponse from '../objects/Response';
import type { ITokenManager } from '../objects/TokenManager';

export const name = 'auth';

/* ── 跨重发存活的 auth 状态标志 ───────────────────────────────────────────────
 * 这些字段必须熬过 refresh / replay 的 `ctx.axios.request(config)` 重发 —— 而该重发
 * 经 axios `mergeConfig` 时**只保留可枚举字符串键**（实测 Symbol / 非枚举键被丢弃）。
 * 故 auth 状态机刻意使用可枚举字符串键，与 B2 中走 Symbol 私有 bag 的「清理类」字段
 * （如 cancel 的 controller）属于不同诉求：前者要"跨重发存活"，后者要"私有 + 防 GC"。 */
const DECISION = '__auth_decision';   // 缓存"是否受保护"的最终决策（boolean）
const PROTECTED = '__auth_protected'; // 本请求是受保护资源（请求侧设、响应侧消费）
const REFRESHED = '__auth_refreshed'; // 本请求已被 refresh/replay 重放过一次（防回环）
const DENIED = '__auth_denied';       // 请求阶段已判定 deny —— 让响应侧跳过重复触发

export const ACCESS_DENIED_CODE = 'ACCESS_DENIED';

/** 按 axios 实例存的单飞 refresh 状态。`PluginManager#refresh()` 会在任意 use()/eject()
 *  调用时把**所有**已装插件（不只是改动的那个）重新 install 一遍，若 `refreshing` 只是
 *  `install(ctx)` 闭包里的局部变量，这次重装会把它清成 null —— 一次真正在途的 refresh
 *  就此和后续请求失联，同一实例上能并发跑出第二个 onRefresh，破坏"同一时刻最多一个"的协议。
 *  存到按实例查的 WeakMap 里，跨闭包重建也不丢。 */
const refreshStates = new WeakMap<AxiosInstance, { current: Promise<boolean> | null }>();


/* ── onFailure 路由动作 ──────────────────────────────────────────────────── */

/**
 * `onFailure` 决策枚举 —— 单一路由器返回值，驱动 5 种动作。
 *   - `Refresh` → 调 `onRefresh`，成功后用同一 config 重发
 *   - `Replay`  → 不刷新，直接用同一 config 重发（refresh 已被并发完成 / 当时没带 token / token 不一致）
 *   - `Deny`    → 调 `onAccessDenied`，原响应/错误原样传播
 *   - `Expired` → `tm.clear()` + 调 `onAccessExpired`，原样传播
 *   - `Others`  → 与本插件无关，原样传播；返回 `null/undefined/void` 等同此值
 */
export enum AuthFailureAction {
  Refresh = 'refresh',
  Replay = 'replay',
  Deny = 'deny',
  Expired = 'expired',
  Others = 'others',
}


/**
 * 默认 `onFailure` 工厂（柯里化）—— 用指定 header 字段名生成标准 OAuth 路由器。
 * 决策顺序：
 *   1. 非 401/403 → `Others`
 *   2. tm 无 token → `401: Expired` / `403: Deny`
 *   3. 请求当时未携带 token → `Replay`（用 tm 当前 token 重发）
 *   4. 携带 token 且与 tm 当前一致 → `Refresh`（真过期）
 *   5. 携带 token 但与 tm 当前不一致 → `Replay`（已被并发刷新过，stale）
 *
 * 注意：默认路由器按 **HTTP status** 判定（axp 中 401/403 走 `onRejected`）。信封式
 * （HTTP 200 + 业务 code 表达鉴权失败）的项目请自行提供 `onFailure`。
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

/** 默认 `onFailure` 单例 —— `authFailureFactory('Authorization')`。 */
export const DEFAULT_ON_AUTH_FAILURE = /*#__PURE__*/ authFailureFactory();


/* ── 插件工厂 ────────────────────────────────────────────────────────────── */

/**
 * 鉴权插件 —— 单一刷新窗口 + `onFailure` 五动作路由。
 *
 *   - **受保护判定**：插件级 `methods ∩ urlPattern` 必须同时命中；请求级 `config.protected`
 *     与插件级 `isProtected` 可逐级覆盖。判定函数在 `install` 时一次性编译。
 *   - **并发刷新协议**：同一时刻最多一个 `onRefresh` 在跑，所有受保护请求共享同一窗口。
 *   - **请求侧**：受保护但无 token → 合成 deny 响应 + 终止；否则经 `ready` 注入凭证。
 *   - **响应侧**：业务失败(`!successful`)或 HTTP 401/403 → 经 `onFailure` 路由。
 *
 * 与老 axios-plus 版的区别：不再依赖 normalize 把 `response.data` 改写成 `ApiResponse`
 * 实例，而是用 `ApiResponse.fromResponse(response).successful` 判定 —— 自给自足。
 */
export default function auth(options: IAuthOptions): Plugin {
  const cfg = $normalize(options);
  return {
    name,
    install(ctx) {
      if (__DEV__) ctx.logger.log(`${name} enabled:${cfg.enable}`);
      if (!cfg.enable) return;

      const { tokenManager: tm, matchMethod, matchUrl } = cfg;
      const log = ctx.logger;
      let refreshState = refreshStates.get(ctx.axios);
      if (!refreshState) {
        refreshState = { current: null };
        refreshStates.set(ctx.axios, refreshState);
      }

      const safe = async <T>(label: string, fn: () => T | Promise<T>): Promise<T | undefined> => {
        try { return await fn(); }
        catch (e) { if (__DEV__) log.error(`${name} ${label} threw`, e); return undefined; }
      };

      /** 启动 / 加入唯一 refresh 流程。成功 = `!== false`（false / 抛错 → 失败）。 */
      const startRefresh = (resp: AxiosResponse): Promise<boolean> =>
        (refreshState.current ??= (async () => {
          try { return (await cfg.onRefresh(tm, resp)) !== false; }
          catch (e) { if (__DEV__) log.error(`${name} onRefresh threw`, e); return false; }
          finally { refreshState.current = null; }
        })());

      const expire = async (resp: AxiosResponse): Promise<void> => {
        tm.clear();
        await safe('onAccessExpired', () => cfg.onAccessExpired(tm, resp));
      };

      const pluginIsProtected = cfg.isProtected;
      const isProtected = (config: AxiosRequestConfig): boolean => {
        const bag = config as Record<string, unknown>;
        const cached = bag[DECISION];
        if (typeof cached === 'boolean') return cached;  // 重发优先：复用首发决策

        // 用户提供的 protected/isProtected 是唯一没走 safe() 的钩子——但它跑在"决定这
        // 是不是受保护请求"这一步，抛错会连累原本不受保护的请求一起失败。捕获后降级到
        // methods/urlPattern 兜底，而不是让整条请求链路崩掉。
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
          if (__DEV__) log.error(`${name} protected/isProtected threw`, e);
        }
        if (matchMethod !== TRUE && !matchMethod((config.method || 'get').toLowerCase())) return false;
        return matchUrl(config.url ?? '');
      };

      // ─── 请求侧 ───
      ctx.request(async (config: InternalAxiosRequestConfig) => {
        const bag = config as unknown as Record<string, unknown>;
        const prot = isProtected(config);
        bag[DECISION] = prot;
        if (!prot) { delete config.protected; return config; }
        bag[PROTECTED] = true;
        delete config.protected;

        if (refreshState.current) {
          if (!(await refreshState.current)) {
            bag[DENIED] = true;
            // 附上 .config：cancel 插件的响应侧靠 error.config 找到并释放它自己的
            // AbortController，没有 .config 的裸 Error 会让那个 controller 永久泄漏。
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

      /** 失败路由 —— onFulfilled / onRejected 共用。`originalError` 存在时（onRejected
       *  路径）终止动作以"重新 reject 原 error"传播，否则返回原 response。 */
      const handleFailure = async (
        response: AxiosResponse,
        config: AxiosRequestConfig,
        originalError?: unknown,
      ): Promise<AxiosResponse> => {
        const bag = config as Record<string, unknown>;
        const propagate = () => originalError !== undefined ? Promise.reject(originalError) : response;

        // 已重放过一次仍失败 → 兜底 expired，防回环
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
              if (__DEV__) log.log(`${name} refresh ok, retrying`);
              return ctx.axios.request(config);
            }
            await expire(response);
            $clearFlags(bag);
            return propagate();
          }
          case AuthFailureAction.Replay: {
            bag[REFRESHED] = true;
            if (__DEV__) log.log(`${name} replay (stale)`);
            return ctx.axios.request(config);
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
      ctx.response(
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
          if (!response) return Promise.reject(error);  // 网络错误，无从路由
          return handleFailure(response, config!, error);
        },
      );
    },
  };
}


/* ── 纯模块级 helper ──────────────────────────────────────────────────────── */

function $synthDenied(config: AxiosRequestConfig, code: string): AxiosResponse {
  return {
    data: { code, message: 'protected request without accessToken' },
    status: 0,
    statusText: '',
    headers: {},
    config: config as InternalAxiosRequestConfig,
  } as AxiosResponse;
}

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
 * 编译 `methods` 选项为单一谓词。
 *   - `undefined/null/''/[]` → 恒 false
 *   - `'*'` 或含 `'*'` 的数组 → 恒 true（fast-path）
 *   - 字符串 → 单 method 字面量比较（lowered）
 *   - 数组 → `Set.has`（任一命中）
 * @internal exported for unit tests
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
 * 编译 `urlPattern` 选项为单一谓词。
 *   - `undefined/null/[]` → 恒 false
 *   - `'*'` / `['*']` → 恒 true（fast-path）
 *   - 数组 → `URLPattern`（不可用时回退正则）：`*` 任意、`:name` 单段、`!` 前缀否定
 * @internal exported for unit tests
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
 * URLPattern pathname 子集 → 正则：`*` ⇒ `.*`，`:name` ⇒ `[^/]+`，其余字面转义。
 * @internal exported for unit tests
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

function $getURLPattern(): typeof URLPattern | null {
  const G = (globalThis as { URLPattern?: typeof URLPattern }).URLPattern;
  return typeof G === 'function' ? G : null;
}


/* ── 归一化插件级配置 ─────────────────────────────────────────────────────── */

const DEFAULT_METHODS = '*';
const DEFAULT_URL_PATTERN = '*';

/** 缺省 ready：把 `tm.accessToken`（已含 Bearer 前缀）写入 Authorization 头。 */
function defaultReady(tm: ITokenManager, config: AxiosRequestConfig): void {
  const token = tm.accessToken;
  if (!token) return;
  const h = config.headers as { set?: (k: string, v: string) => void } | undefined;
  if (h && typeof h.set === 'function') h.set('Authorization', token);
  else config.headers = { ...(config.headers as object), Authorization: token } as never;
}

/** @internal */
export interface IAuthConfig {
  enable: boolean;
  tokenManager: ITokenManager;
  onFailure: TAuthFunc<AuthFailureAction | null | undefined | void>;
  onRefresh: TAuthFunc<unknown>;
  onAccessDenied: TAuthFunc<void>;
  onAccessExpired: TAuthFunc<void>;
  ready: TAuthFunc<void, AxiosRequestConfig>;
  matchMethod: Predicate;
  matchUrl: Predicate;
  isProtected?: (config: AxiosRequestConfig) => boolean | null | undefined | void;
  accessDeniedCode: string;
}

/** @internal exported for unit tests */
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

/** 所有 auth 钩子的统一 shape `(tm, ctx) => T`（`ready` 的第二参是 config）。 */
export type TAuthFunc<T, C = AxiosResponse> = (TM: ITokenManager, ctx: C) => T | Promise<T>;

export interface IAuthOptions {
  /** 总开关；默认 `true`。 */
  enable?: boolean;
  /** token 管理器（提供 accessToken / refreshToken / clear / canRefresh）。 */
  tokenManager: ITokenManager;
  /** 受保护 method 白名单（小写）。`'*'` 通配。与 `urlPattern` 取交集。默认 `'*'`。 */
  methods?: string | string[];
  /** 受保护 URL pathname 模式（URLPattern 语法，`!` 前缀否定）。默认 `'*'`。 */
  urlPattern?: string | string[];
  /** 函数式插件级判定（在 methods+urlPattern 之上）。返回 boolean 即最终值，其他落下一层。 */
  isProtected?: (config: AxiosRequestConfig) => boolean | null | undefined | void;
  /** 请求阶段越权（无 token）合成响应的业务码。默认 `'ACCESS_DENIED'`。 */
  accessDeniedCode?: string;
  /** 响应侧统一路由 → 5 动作之一。默认 `DEFAULT_ON_AUTH_FAILURE`（标准 OAuth）。 */
  onFailure?: TAuthFunc<AuthFailureAction | null | undefined | void>;
  /** **必填** 刷新实现；`onFailure` 返回 `Refresh` 时调用。返回 `false`/抛错 = 失败。
   *  同一窗口并发请求共享同一 promise，只触发一次。 */
  onRefresh: TAuthFunc<unknown>;
  /** 禁止访问回调（请求阶段无 token / onFailure=Deny）。未配置时回退 `onAccessExpired`。 */
  onAccessDenied?: TAuthFunc<void>;
  /** **必填** 授权过期回调（Expired / refresh 失败 / 重放后仍失败）。调用前已 `tm.clear()`。 */
  onAccessExpired: TAuthFunc<void>;
  /** 受保护请求发送前注入凭证（默认把 `tm.accessToken` 写入 Authorization 头）。 */
  ready?: TAuthFunc<void, AxiosRequestConfig>;
}

// 锁住 .name，让 minify 后 `core.eject(auth)` 仍可识别（严格模式 ESM 用 defineProperty）
Object.defineProperty(auth, 'name', { value: name, configurable: true });


declare module 'axios' {
  interface AxiosRequestConfig {
    /** 请求级是否受保护 —— 单次覆盖插件级判定：`true`/`false` 强制；函数 MaybeFun。 */
    protected?: MaybeFun<boolean | undefined | null | void>;
  }
}
