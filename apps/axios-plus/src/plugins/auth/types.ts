import type { AxiosRequestConfig } from "axios";
import type { AuthFailureAction, MaybeFunc } from "../../helper";
import type { ITokenManager } from "../../objects/TokenManager";
import { HttpResponse } from "../../core/types";

/**
 * 所有 auth 钩子的统一 shape —— `(tm, ctx) => T`。
 *
 *   - 泛型 `T`：返回值类型（判定钩子用 `boolean`，副作用钩子用 `void`）
 *   - 泛型 `C`：第二个参数类型；响应阶段钩子默认是 `HttpResponse`，
 *     `ready` 用 `AxiosRequestConfig`
 *   - 同步 / 异步皆可（实现侧统一 `await` 解开）
 */
export type TAuthFunc<T, C = HttpResponse> = (
  TM: ITokenManager,
  ctx: C,
) => T | Promise<T>;

/** 插件级选项 */
export interface IAuthOptions {
  /** 总开关；默认 `true`。设为 `false` 时整个插件不安装 */
  enable?: boolean;

  /** token 管理器（提供 accessToken / refreshToken / clear / canRefresh） */
  tokenManager: ITokenManager;

  /**
   * 受保护资源的 HTTP method 白名单（小写）。
   *
   *   - `'*'` 通配所有 method（fast-path）
   *   - 字符串 → 单 method 等价于单元素数组 `[method]`
   *   - 数组 → 任一命中即可；含 `'*'` 也通配
   *   - 空数组 / 空字符串 → 完全关闭 method 维度
   *
   * 与 `urlPattern` 取交集判定 —— 必须同时命中。
   *
   * @default `'*'`（所有 method）
   * @example
   *   methods: '*'
   *   methods: 'post'
   *   methods: ['get', 'post']
   */
  methods?: string | string[];

  /**
   * 受保护资源的 URL pathname 模式（[URLPattern] 语法）。
   *
   *   - `*`        匹配任意字符（含 `/`）
   *   - `:name`    单段命名参数
   *   - `!` 前缀   gitignore 风格的否定（先 include 再 exclude）
   *
   * 字符串视为单元素数组。**默认 `'*'`** 即所有 URL 命中。
   *
   * 与 `methods` 取交集判定 —— 必须同时命中才视为受保护。
   *
   * [URLPattern]: https://developer.mozilla.org/en-US/docs/Web/API/URLPattern
   *
   * @default `'*'`（所有 URL）
   * @example
   *   urlPattern: ['/user/*', '/admin/*', '!/user/login']
   */
  urlPattern?: string | string[];

  /**
   * **函数式插件级判定** —— 在 `methods + urlPattern` 之上再加一层用户自定义判定。
   *
   * 用于按 header / payload / 业务标记等非 URL/method 维度判定（例如：
   * `config.meta?.requiresAuth`、`config.headers['X-Need-Auth']`）。
   *
   * **优先级链**（高 → 低）：
   *   1. 请求级 `config.protected`（boolean / 函数返回 boolean）→ 最终值
   *   2. 插件级 `isProtected(config)` → 返回 `boolean` 即最终值；返回
   *      `null / undefined / void` 落到下一层
   *   3. 插件级 `methods ∩ urlPattern`
   *
   * @example
   *   isProtected: (config) => config.meta?.requiresAuth ? true : null
   */
  isProtected?: (config: AxiosRequestConfig) => boolean | null | undefined | void;

  /**
   * 请求阶段越权拦截（无 accessToken）时合成响应的业务码。
   *
   * 写到 `apiResp.code`，方便上游 `notification.messages` / `rethrow.shouldRethrow`
   * 路由这种"合成失败"。业务码体系不同的项目（如纯数字码 `40001`）请自行覆盖。
   *
   * @default `'ACCESS_DENIED'`
   */
  accessDeniedCode?: string;


  /**
   * **响应侧统一路由** —— 失败响应被路由到 5 种动作之一。
   * 单一决策器代替了原来的 `shouldRefresh / isDeny / isExpired` 三谓词链。
   *
   * 返回 {@link AuthFailureAction}：
   *   - `Refresh` → 调 `onRefresh`，成功后用同一 config 重发
   *   - `Replay`  → 不刷新，直接重发（stale-token 场景：refresh 已被并发完成）
   *   - `Deny`    → 调 `onAccessDenied`，原响应原样传播
   *   - `Expired` → `tm.clear()` + 调 `onAccessExpired`，原响应原样传播
   *   - `Others`  → 与本插件无关，原样传播
   *
   * @default `DEFAULT_ON_AUTH_FAILURE`（从 `'http-plugins'` 直接导入）—— 标准 OAuth
   *   路由，假设 `Authorization` header 承载 token。需要更换 header 名 / 业务码 /
   *   多 header 联合签名等场景，按以下方式覆盖：
   *
   * @example —— 业务码扩展（基于默认 + 早返回）
   *   import { AuthFailureAction, DEFAULT_ON_AUTH_FAILURE } from 'http-plugins';
   *
   *   onFailure: (tm, resp) => {
   *     if (resp.data?.code === 'TOKEN_EXPIRED') return AuthFailureAction.Refresh;
   *     return DEFAULT_ON_AUTH_FAILURE(tm, resp);
   *   }
   *
   * @example —— 换 header 名（如 `X-Token`）
   *   import { authFailureFactory } from 'http-plugins';
   *
   *   onFailure: authFailureFactory('X-Token'),
   *
   * @example —— 完全自实现
   *   onFailure: (tm, resp) => { ... }
   */
  onFailure?: TAuthFunc<AuthFailureAction | null | undefined | void>;

  /**
   * **必填处理** —— 真正的刷新 token 实现。在 `onFailure` 返回 `Refresh` 时被调用。
   * 用户在该函数内自行调用 refresh API 并通过 `tokenManager.set(...)` 写入新 token。
   *
   *   - 返回 `false` / 抛错  → 视为**失败**，触发 `onAccessExpired`
   *   - 其他任何返回值（`true` / `undefined` / 对象 / 数字 …）→ 视为**成功**，
   *     自动用同一 config 重发原请求
   *
   * 同一刷新窗口内的并发请求会共享同一 promise，`onRefresh` 只触发一次。
   */
  onRefresh: TAuthFunc<unknown>;

  /**
   * **可选处理** —— 禁止访问回调。常见用途：弹"无权限"提示。
   *
   * 触发时机：
   *   - **请求阶段**：受保护请求但 `tokenManager.accessToken` 缺失（视为未登录）
   *   - **响应阶段**：`onFailure` 返回 `Deny`
   *
   * **未配置时回退调用 `onAccessExpired`** —— 多数业务场景两者最终动作一致（跳登录页），可省略此项。
   * 抛错会被吞掉（仅 dev 日志），不影响主流程。
   */
  onAccessDenied?: TAuthFunc<void>;

  /**
   * **必填处理** —— 授权过期回调。常见用途：清登录态、跳登录页。
   *
   * 触发时机：
   *   - `onFailure` 返回 `Expired`
   *   - `onFailure` 返回 `Refresh` 但 `onRefresh` 失败（兜底）
   *   - 已被插件自动重发过一次仍失败（避免回环）
   *
   * 调用前插件已自动 `tokenManager.clear()`。当 `onAccessDenied` 未配置时，
   * 拒绝访问路径也会回退到本回调。
   *
   * 抛错会被吞掉（仅 dev 日志），不影响主流程。
   */
  onAccessExpired: TAuthFunc<void>;

  /**
   * **请求侧钩子** —— 受保护请求发送前调用（仅在已通过登录态拦截后才运行）。
   * 用户在该函数内根据需要设置请求头（比如 `Authorization`、自定义签名）、
   * 改写 query 参数等。
   *
   * 抛错会被吞掉（仅 dev 日志），不影响请求继续发送。
   *
   * @example
   *   ready: (tm, config) => {
   *     config.headers!.Authorization = tm.accessToken!;
   *   }
   */
  ready?: TAuthFunc<void, AxiosRequestConfig>;
}

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * 请求级是否受保护 —— 单次覆盖插件级 `methods + urlPattern` 判定：
     *
     *   - `true` / `false`     强制开 / 关
     *   - `null` / `undefined` / 函数返回 void   走插件级判定
     *   - 函数 `(config) => ...` MaybeFun，按上述规则解读返回值
     */
    protected?: MaybeFunc<boolean | undefined | null | void>;
  }
}
