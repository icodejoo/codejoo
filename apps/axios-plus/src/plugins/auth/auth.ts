import type {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import type { Plugin } from "../../plugin/types";
import type { HttpResponse } from "../../core/types";
import {
  __DEV__,
  ACCESS_DENIED_CODE,
  AUTH_DECISION_KEY,
  AUTH_DENIED_KEY,
  AUTH_PROTECTED_KEY,
  AUTH_REFRESHED_KEY,
  AuthFailureAction,
  DEFAULT_ON_AUTH_FAILURE,
  Type,
  lockName,
  requirePlugin,
  tagOf,
} from "../../helper";
import ApiResponse from "../../objects/ApiResponse";
import type { ITokenManager } from "../../objects/TokenManager";
import { name as normalizeName } from "../normalize";
import type { IAuthOptions, TAuthFunc } from "./types";

export const name = "auth";

// ───────────────────────────────────────────────────────────────────────────
//  默认值 / 常量
// ───────────────────────────────────────────────────────────────────────────

/** 单例谓词 —— 编译期 fast-path 用；通配符 `'*'` 编译为 TRUE，运行时零开销 */
const TRUE: Predicate = () => true;
const FALSE: Predicate = () => false;

const DEFAULT_METHODS = "*";
const DEFAULT_URL_PATTERN = "*";

// ───────────────────────────────────────────────────────────────────────────
//  工厂
// ───────────────────────────────────────────────────────────────────────────

/**
 * 鉴权插件 —— 按用户提供的判定函数路由到 refresh / deny / expired 流程。
 *
 * **必须在 `normalize` 之后 use**。所有钩子共享 shape `(tm, response: HttpResponse) => T`
 * （`ready` 例外，第二参数是 `AxiosRequestConfig`）。
 *
 * **受保护判定**：插件级 `methods` ∩ `urlPattern` 必须同时命中；请求级 `config.protected`
 * 可单次强制覆盖（`true` / `false`）。判定函数在 `install` 时一次性编译，运行时只做查表
 * （Set.has）+ 已编译 RegExp / URLPattern 测试。
 *
 * **并发刷新协议**：模块内维护单一 `refreshing: Promise<boolean> | null`，
 * 同一时刻最多一个 `onRefresh` 在跑，所有受保护请求与之协作 —— 详见 `IAuthOptions` JSDoc。
 */
export default function auth(options: IAuthOptions): Plugin {
  const cfg = $normalize(options);
  return {
    name,
    install(ctx) {
      requirePlugin(ctx, normalizeName);
      if (__DEV__) ctx.logger.log(`${name} enabled:${cfg.enable}`);
      if (!cfg.enable) return;

      const { tokenManager: tm, matchMethod, matchUrl } = cfg;
      const log = ctx.logger;
      /** 全局刷新 promise —— 同一时刻最多一个 onRefresh 在跑；并发请求都等同一个 */
      let refreshing: Promise<boolean> | null = null;

      // ─── install 期 closure helpers（log / tm / cfg / refreshing 都已绑定） ───

      /** 安全调用钩子 —— 抛错被吞 + dev 日志，返回 `T | undefined` */
      const safe = async <T>(
        label: string,
        fn: () => T | Promise<T>,
      ): Promise<T | undefined> => {
        try {
          return await fn();
        } catch (e) {
          if (__DEV__) log.error(`${name} ${label} threw`, e);
          return undefined;
        }
      };

      /**
       * 启动 / 加入唯一 refresh 流程。**成功 = `!== false`**：
       *   - `false` / 抛错 → 视为失败（返回 false）
       *   - 其他任意值（true / undefined / 对象 / 数字…）→ 视为成功
       */
      const startRefresh = (resp: HttpResponse): Promise<boolean> =>
        (refreshing ??= (async () => {
          try {
            return (await cfg.onRefresh(tm, resp)) !== false;
          } catch (e) {
            if (__DEV__) log.error(`${name} onRefresh threw`, e);
            return false;
          } finally {
            refreshing = null;
          }
        })());

      /** expired 路径：tm.clear() + onAccessExpired */
      const expire = async (resp: HttpResponse): Promise<void> => {
        tm.clear();
        await safe("onAccessExpired", () => cfg.onAccessExpired(tm, resp));
      };

      /**
       * 解析当前请求是否受保护，四级优先级链（高 → 低）：
       *   0. **bag 已缓存决策**（重发场景）→ 直接复用。避免 `config.protected` 已被
       *      首发消费删除导致 retry / refresh / replay 重发退化为 plugin 级判定
       *   1. 请求级 `config.protected` —— `boolean` 即最终值；函数返回 boolean 同理；
       *      其他值（null / void）落到下一层
       *   2. 插件级 `cfg.isProtected(config)` —— 同上规则
       *   3. 插件级 `methods ∩ urlPattern`
       *
       * matchMethod 命中 fast-path：若插件配 `methods: '*'` 则 matchMethod === TRUE，
       * 直接跳过 method.toLowerCase + Set.has，剩 url 一次匹配。
       */
      const pluginIsProtected = cfg.isProtected;
      const isProtected = (config: AxiosRequestConfig): boolean => {
        const bag = config as unknown as Record<string, unknown>;
        // 0. 重发优先：首发已决策过 → 直接复用（跨 retry / refresh / replay 重发存活）
        const cached = bag[AUTH_DECISION_KEY];
        if (typeof cached === "boolean") return cached;

        const v = config.protected;
        if (v !== undefined) {
          const r =
            typeof v === "function"
              ? (v as (c: AxiosRequestConfig) => unknown)(config)
              : v;
          if (typeof r === "boolean") return r;
        }
        if (pluginIsProtected) {
          const r = pluginIsProtected(config);
          if (typeof r === "boolean") return r;
        }
        if (
          matchMethod !== TRUE &&
          !matchMethod((config.method || "get").toLowerCase())
        )
          return false;
        return matchUrl(config.url ?? "");
      };

      // ─── 请求侧：未登录拦截 + 等 refreshing + ready ───
      ctx.request(async (config: InternalAxiosRequestConfig) => {
        const bag = config as unknown as Record<string, unknown>;
        const protectedFlag = isProtected(config);
        // 缓存决策 —— 让重发（retry / refresh / replay）跳过判定 + 防止 config.protected
        // 已被消费删除导致退化为 plugin 级判定
        bag[AUTH_DECISION_KEY] = protectedFlag;
        if (!protectedFlag) {
          delete bag.protected;
          return config;
        }
        bag[AUTH_PROTECTED_KEY] = true;
        delete bag.protected;

        // 若有刷新进行中 → 等它完成（所有受保护请求共享同一窗口）
        if (refreshing) {
          if (__DEV__)
            log.log(`${name} request awaits refreshing: ${tagOf(config)}`);
          if (!(await refreshing)) {
            bag[AUTH_DENIED_KEY] = true;
            if (__DEV__)
              log.log(
                `${name} aborting due to failed refresh: ${tagOf(config)}`,
              );
            throw new Error(`[${name}] refresh failed; aborting request`);
          }
        }

        // 受保护 + 仍无 accessToken → 视为未登录越权访问 → 终止
        if (!tm.accessToken) {
          bag[AUTH_DENIED_KEY] = true;
          await safe("onAccessDenied", () =>
            cfg.onAccessDenied(
              tm,
              $syntheticDenied(config, cfg.accessDeniedCode),
            ),
          );
          if (__DEV__)
            log.log(
              `${name} request denied (no accessToken): ${tagOf(config)}`,
            );
          throw new Error(`[${name}] access denied`);
        }
        if (cfg.ready) await safe("ready", () => cfg.ready!(tm, config));
        return config;
      });

      // ─── 响应侧：单一路由器决策 ───
      ctx.response(async (response: AxiosResponse) => {
        const apiResp = response.data;
        if (!(apiResp instanceof ApiResponse)) return response;

        const config = response.config as AxiosRequestConfig;
        const bag = config as unknown as Record<string, unknown>;
        if (bag[AUTH_PROTECTED_KEY] !== true) return response;

        if (bag[AUTH_DENIED_KEY] === true || apiResp.success) {
          $clearFlags(bag);
          return response;
        }

        const httpResp = response as HttpResponse;

        // 已 refresh / replay 过一次 —— 兜底 expired，避免回环
        if (bag[AUTH_REFRESHED_KEY] === true) {
          await expire(httpResp);
          $clearFlags(bag);
          return response;
        }

        // 单一决策：onFailure → 5 种动作之一
        const action = (await safe("onFailure", () =>
          cfg.onFailure(tm, httpResp),
        )) ?? AuthFailureAction.Others;

        switch (action) {
          case AuthFailureAction.Refresh: {
            if (await startRefresh(httpResp)) {
              bag[AUTH_REFRESHED_KEY] = true;
              if (__DEV__)
                log.log(`${name} refresh ok, retrying ${tagOf(config)}`);
              return ctx.axios.request(config);
            }
            await expire(httpResp);
            $clearFlags(bag);
            return response;
          }
          case AuthFailureAction.Replay: {
            // stale：不刷新，直接用同一 config 重发（refresh 已被并发完成）
            bag[AUTH_REFRESHED_KEY] = true;
            if (__DEV__) log.log(`${name} replay (stale): ${tagOf(config)}`);
            return ctx.axios.request(config);
          }
          case AuthFailureAction.Deny: {
            await safe("onAccessDenied", () =>
              cfg.onAccessDenied(tm, httpResp),
            );
            $clearFlags(bag);
            return response;
          }
          case AuthFailureAction.Expired: {
            await expire(httpResp);
            $clearFlags(bag);
            return response;
          }
          case AuthFailureAction.Others:
          default: {
            $clearFlags(bag);
            return response;
          }
        }
      });
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  纯模块级 helper（无运行时依赖）
// ───────────────────────────────────────────────────────────────────────────

function $syntheticDenied(
  config: AxiosRequestConfig,
  code: string,
): HttpResponse {
  return {
    data: new ApiResponse(
      0,
      code,
      null,
      "protected request without accessToken",
      false,
    ),
    status: 0,
    statusText: "",
    headers: {},
    config: config as InternalAxiosRequestConfig,
    request: undefined,
  };
}

function $clearFlags(bag: Record<string, unknown>): void {
  delete bag[AUTH_PROTECTED_KEY];
  delete bag[AUTH_REFRESHED_KEY];
  delete bag[AUTH_DENIED_KEY];
}

// ───────────────────────────────────────────────────────────────────────────
//  受保护匹配编译（install 期一次性）
// ───────────────────────────────────────────────────────────────────────────

type Predicate = (s: string) => boolean;

/**
 * 编译 `methods` 选项为单一谓词。
 *
 *   - `undefined / null / '' / []` → 恒 false（method 维度全关）
 *   - `'*'` 或含 `'*'` 的数组 → 恒 true（fast-path，运行时跳过 toLowerCase / Set.has）
 *   - 字符串 → 单 method 字面量比较（lowered）
 *   - 数组 → `Set.has` lowered method（任一命中）
 *
 * @internal exported for unit tests
 */
export function $compileMethods(
  m: string | readonly string[] | undefined,
): Predicate {
  if (m == null) return FALSE;
  if (typeof m === "string") {
    if (m === "*") return TRUE;
    if (m === "") return FALSE;
    const lower = m.toLowerCase();
    return (x) => x === lower;
  }
  if (m.length === 0) return FALSE;
  if (m.includes("*")) return TRUE;
  const set = new Set(m.map((s) => s.toLowerCase()));
  return (x) => set.has(x);
}

/**
 * 编译 `urlPattern` 选项为单一谓词。
 *
 *   - `undefined / null / 空数组` → 恒 false
 *   - `['*']` 或 `'*'` → 恒 true（fast-path）
 *   - 普通数组 → 用 `URLPattern`（不可用时回退正则）编译每条模式：
 *     * `*` 匹配任意（含 `/`）/ `:name` 单段命名参数
 *     * `!` 前缀 = 否定（gitignore 风格：先 include 再 exclude）
 *
 * @internal exported for unit tests
 */
export function $compileUrlPatterns(
  p: string | readonly string[] | undefined,
): Predicate {
  const arr = p == null ? [] : Type.isArray(p) ? p : [p as string];
  if (arr.length === 0) return FALSE;
  if (arr.length === 1 && arr[0] === "*") return TRUE;

  const Ctor = $getURLPattern();
  const includes: Predicate[] = [];
  const excludes: Predicate[] = [];
  for (const raw of arr) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const isNeg = raw.charCodeAt(0) === 33; // '!'
    const pat = isNeg ? raw.slice(1) : raw;
    const m = $compileOne(Ctor, pat);
    if (m) (isNeg ? excludes : includes).push(m);
  }

  if (includes.length === 0 && excludes.length === 0) return FALSE;
  if (excludes.length === 0) {
    if (includes.length === 1) return includes[0];
    return (url) => includes.some((m) => m(url));
  }
  return (url) => {
    if (includes.length && !includes.some((m) => m(url))) return false;
    return !excludes.some((m) => m(url));
  };
}

/** 编译一条模式：URLPattern 优先，失败 / 不可用时回退到内置正则 */
function $compileOne(
  Ctor: typeof URLPattern | null,
  pat: string,
): Predicate | null {
  if (Ctor) {
    try {
      const p = new Ctor({ pathname: pat });
      return (url) => {
        try {
          return p.test({ pathname: url });
        } catch {
          return false;
        }
      };
    } catch (e) {
      if (__DEV__)
        console.warn(
          `[${name}] URLPattern reject "${pat}", falling back to regex`,
          e,
        );
      // fall through 到正则
    }
  }
  const re = $patternToRegex(pat);
  if (!re) {
    if (__DEV__)
      console.warn(
        `[${name}] regex fallback could not compile pattern: ${pat}`,
      );
    return null;
  }
  return (url) => re.test(url);
}

/**
 * 把 URLPattern pathname 子集编译成正则：
 *   - `*`     ⇒ `.*`
 *   - `:name` ⇒ `[^/]+`
 *   - 其他正则元字符按字面值转义
 *
 * @internal exported for unit tests
 */
export function $patternToRegex(pat: string): RegExp | null {
  try {
    const NAMED = " NAMED ";
    const STAR = " STAR ";
    const tokenized = pat
      .replace(/:[A-Za-z_$][\w$]*/g, NAMED)
      .replace(/\*/g, STAR);
    const escaped = tokenized.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const body = escaped
      .replace(new RegExp(NAMED, "g"), "[^/]+")
      .replace(new RegExp(STAR, "g"), ".*");
    return new RegExp(`^${body}/?$`);
  } catch {
    return null;
  }
}

function $getURLPattern(): typeof URLPattern | null {
  const G = (globalThis as { URLPattern?: typeof URLPattern }).URLPattern;
  return typeof G === "function" ? G : null;
}

// ───────────────────────────────────────────────────────────────────────────
//  归一化插件级配置
// ───────────────────────────────────────────────────────────────────────────

/** @internal */
export interface IAuthConfig {
  enable: boolean;
  tokenManager: ITokenManager;
  onFailure: TAuthFunc<AuthFailureAction | null | undefined | void>;
  onRefresh: TAuthFunc<unknown>;
  /** $normalize 时若用户未传，自动 alias 到 onAccessExpired */
  onAccessDenied: TAuthFunc<void>;
  onAccessExpired: TAuthFunc<void>;
  ready?: TAuthFunc<void, AxiosRequestConfig>;
  matchMethod: Predicate;
  matchUrl: Predicate;
  /** 函数式插件级 isProtected 钩子；undefined 表示未配置 */
  isProtected?: (
    config: AxiosRequestConfig,
  ) => boolean | null | undefined | void;
  accessDeniedCode: string;
}

/** @internal exported for unit tests */
export function $normalize(opts: IAuthOptions): IAuthConfig {
  if (!opts || !opts.tokenManager)
    throw new Error(`[${name}] options.tokenManager is required`);
  if (typeof opts.onRefresh !== "function")
    throw new Error(`[${name}] options.onRefresh is required`);
  if (typeof opts.onAccessExpired !== "function")
    throw new Error(`[${name}] options.onAccessExpired is required`);
  return {
    enable: opts.enable ?? true,
    tokenManager: opts.tokenManager,
    // 用户想换 header 名 / 自实现 → 传 onFailure；默认走 helper 单例
    onFailure: opts.onFailure ?? DEFAULT_ON_AUTH_FAILURE,
    onRefresh: opts.onRefresh,
    // 缺省回退到 onAccessExpired —— 多数业务场景两者最终动作一致（跳登录页）
    onAccessDenied: opts.onAccessDenied ?? opts.onAccessExpired,
    onAccessExpired: opts.onAccessExpired,
    ready: opts.ready,
    matchMethod: $compileMethods(opts.methods ?? DEFAULT_METHODS),
    matchUrl: $compileUrlPatterns(opts.urlPattern ?? DEFAULT_URL_PATTERN),
    isProtected: opts.isProtected,
    accessDeniedCode: opts.accessDeniedCode ?? ACCESS_DENIED_CODE,
  };
}

// 防打包混淆 —— 锁住函数 .name，让 `core.eject(auth)` 在 minify 后仍能识别
lockName(auth, name);


