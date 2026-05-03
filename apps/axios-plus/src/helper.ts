/* Shared utilities used across multiple plugins / Core. Plugin-manager-internal
 * machinery (loggers / NS / tagged) lives in `plugin/plugin.ts`; per-plugin
 * helpers live alongside their plugin. */

import type { AxiosRequestConfig } from 'axios';


declare const process: { env: { NODE_ENV?: string } };

/**
 * 编译期常量：
 *   - Vite / Rollup / esbuild / Webpack 等都会把 `process.env.NODE_ENV` 替换成字面量，
 *     生产构建中本常量折叠成 `false`，配合 `if (__DEV__) {...}` 整块被 DCE 掉。
 *   - 未走打包（直接 Node 运行测试）时退化成运行时判断，结果一致。
 */
export const __DEV__: boolean = process.env.NODE_ENV !== 'production';


/* ── Cross-cutting type aliases (used by plugins' declare-module blocks) ─── */

export type Primitive = string | number | boolean | symbol | bigint | undefined | null;

/**虚值 */
export type Falsy = false | "" | null | undefined;

/** Generic for the per-request option pattern: a value, or a function from
 *  some context to that value. Default context is `AxiosRequestConfig`
 *  (for backward compat with share / retry / filter / key / cache); plugins
 *  needing a richer context (e.g. `notification` resolves with response/error)
 *  override the second generic. Plugins resolve via:
 *  `typeof v === 'function' ? v(ctx) : v`. */
export type MaybeFunc<T, P = AxiosRequestConfig> = T | ((ctx: P) => T);


/* ── Cross-plugin runtime utilities ─────────────────────────────────────── */

/** Coerce `value | value[] | undefined` into a fresh `value[]`. */
export function asArray<X>(x: X | X[] | undefined): X[] {
    if (x == null) return [];
    return Array.isArray(x) ? [...x] : [x];
}


export class Type {
    private static readonly toString = Object.prototype.toString;

    private static stringify(val: unknown): string {
        return this.toString.call(val).slice(8, -1).toLowerCase();
    }

    static isObject(val: unknown): val is Record<string, any> {
        return this.stringify(val) === 'object';
    }

    static isArray(val: unknown): val is any[] {
        return Array.isArray(val);
    }

    static isString(val: unknown): val is string {
        return typeof val === 'string';
    }

    static isNumber(val: unknown): val is number {
        return typeof val === 'number';
    }

    static isFunction(val: unknown): val is Function {
        return typeof val === 'function';
    }

    static isDate(val: unknown): val is Date {
        return val instanceof Date;
    }

    static isNull(val: unknown): val is null {
        return val === null;
    }

    static isUndefined(val: unknown): val is undefined {
        return val === undefined;
    }

    static isMap(val: unknown): val is Map<any, any> {
        return val instanceof Map;
    }

    static isSet(val: unknown): val is Set<any> {
        return val instanceof Set;
    }

    static isPrimitive(val: unknown): val is Primitive {
        if (val === null) return true;
        const type = typeof val;
        return type !== 'object' && type !== 'function';
    }

    static falsy(val: unknown) {
        return val === void 0 || val === null || Number.isNaN(val);
    }
}


/* ── 跨插件 config 字段命名空间 ──────────────────────────────────────────
 *
 * 各插件挂在 `config` 上的字符串字段名集中定义在此处，方便跨文件查阅、避免命名冲突。
 *
 * **为什么挂 config 而不是 WeakMap**：axios 的 `mergeConfig` 使用 `Object.keys` 枚举
 * 属性，字符串 key 在 mergeConfig 后能完整保留 —— 跨 `axios.request` 重发时（如 retry
 * 重试、auth 刷新后重放）这些字段会自动随 config 传递，无需额外结构。
 *
 * **命名约定**：以下划线起头表明"插件内部状态"，与业务字段区分。
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * `retry` 插件挂在 config 上的剩余重试预算字段名。
 *
 *   - **倒计时语义**：首发触发重试前，`__retry` 被设为剩余次数（max=3 → __retry=3），
 *     之后每发一次 HTTP 减 1；归零时不再重试；`-1` 维持原值表示无限重试
 *   - **`isRetry(config)` 判定**：只看 `__retry in config`（含 0 / -1）—— 一旦字段存在，
 *     该 config 就是 retry 插件接管的请求
 *   - **公开导出**：其他真正幂等的插件可以 `isRetry(config)` 提前 short-circuit，
 *     省掉重试请求里重复的纯计算开销（路径变量替换、key 重算、空字段剥离等）
 */
export const RETRY_KEY = '__retry';

/** `auth`：本请求是受保护资源（请求侧设置，响应侧消费） */
export const AUTH_PROTECTED_KEY = '_protected';
/** `auth`：本请求已被自动 refresh + 重放过一次（防回环） */
export const AUTH_REFRESHED_KEY = '_refreshed';
/** `auth`：请求阶段已判定为 deny —— 让响应侧跳过重复触发 */
export const AUTH_DENIED_KEY = '_denied';
/**
 * `auth`：缓存"是否受保护"的最终决策（boolean）—— 跨 retry / refresh / replay
 * 重发存活，避免重发时 `config.protected` 已被删除导致退化为 plugin 级判定。
 */
export const AUTH_DECISION_KEY = '_auth_decision';

/**
 * `auth` 插件 `onFailure` 决策枚举 —— 单一路由器返回值，驱动 5 种动作。
 *
 *   - `Refresh` → 调 `onRefresh`，成功后用同一 config 重发原请求
 *   - `Replay`  → 不刷新，直接用同一 config 重发（refresh 已被并发完成 / 请求当时
 *                 没带 token / 旧 token 与当前不一致）
 *   - `Deny`    → 调 `onAccessDenied`，原响应原样传播
 *   - `Expired` → `tm.clear()` + 调 `onAccessExpired`，原响应原样传播
 *   - `Others`  → 与本插件无关，原样传播；返回 `null / undefined / void` 等同此值
 *
 * 默认 {@link DEFAULT_ON_AUTH_FAILURE}（见下方）—— 用户可组合扩展或自实现。
 */
export enum AuthFailureAction {
    Refresh = 'refresh',
    Replay = 'replay',
    Deny = 'deny',
    Expired = 'expired',
    Others = 'others',
}

/**
 * `auth` 插件请求阶段越权拦截（无 accessToken）时合成响应的默认业务码。
 * 公开 export 让上游 `notification.messages` / `rethrow.shouldRethrow`
 * 等可以引用同一个常量做路由。
 */
export const ACCESS_DENIED_CODE = 'ACCESS_DENIED';


/**
 * `auth` 插件默认 `onFailure` 实现工厂（柯里化）—— 用指定 header 字段名生成一个
 * 标准 OAuth 路由器。`auth` 插件内部使用本工厂的 `'Authorization'` 实例
 * （{@link DEFAULT_ON_AUTH_FAILURE} 单例）；用户想换 header（如 `X-Token`）
 * 直接 `authFailureFactory('X-Token')` 后传给插件 `onFailure` 选项即可。
 *
 * 路由决策顺序（与 {@link AuthFailureAction} 对应）：
 *
 *   1. 非 401 / 403 → `Others`
 *   2. tm 无 accessToken → `401: Expired` / `403: Deny`
 *   3. 请求当时**未携带** token → `Replay`（用 tm 当前 token 重发）
 *   4. 携带了 token，与 tm 当前**一致** → `Refresh`
 *   5. 携带了 token，但与 tm 当前**不一致** → `Replay`（stale）
 *
 * 复杂语义（多 header 联合签名 / cookie 比对 / JWT payload 等价 …）请直接
 * 重写整个 `onFailure`，而不是基于本工厂。
 *
 * @example —— 业务码场景：基于默认 + 早返回扩展
 *
 *   import { AuthFailureAction, DEFAULT_ON_AUTH_FAILURE } from 'http-plugins';
 *
 *   onFailure: (tm, resp) => {
 *     if (resp.data?.code === 'TOKEN_EXPIRED') return AuthFailureAction.Refresh;
 *     return DEFAULT_ON_AUTH_FAILURE(tm, resp);
 *   }
 *
 * @example —— 换 header 名：从工厂派生新单例
 *
 *   import { authFailureFactory } from 'http-plugins';
 *
 *   const onFailure = authFailureFactory('X-Token');
 *   authPlugin({ ..., onFailure });
 */
export function authFailureFactory(headerName: string = 'Authorization') {
    const lower = headerName.toLowerCase();
    return (
        tm: { accessToken?: string | undefined },
        resp: { status: number; config?: { headers?: unknown } | undefined },
    ): AuthFailureAction => {
        const s = resp.status;
        // 1. 非 401/403 不属于本插件管的失败
        if (s !== 401 && s !== 403) return AuthFailureAction.Others;

        // 2. tm 无 token：未登录 / 已登出 → 401=Expired，403=Deny
        const cur = tm.accessToken;
        if (!cur) return s === 401 ? AuthFailureAction.Expired : AuthFailureAction.Deny;

        // 3. 当时未携带 token（请求是登录前发出的）→ 用 tm 当前 token 重发
        const h = resp.config?.headers as Record<string, unknown> | undefined;
        let carried: string | undefined;
        if (h) {
            const v = h[headerName] ?? (lower !== headerName ? h[lower] : undefined);
            if (typeof v === 'string' && v) carried = v;
        }
        if (!carried) return AuthFailureAction.Replay;

        // 4-5. 携带了 token：一致 → 真过期，触发刷新；不一致 → 已被并发刷新过，直接重发
        return carried === cur ? AuthFailureAction.Refresh : AuthFailureAction.Replay;
      };
}

/** 默认 `onFailure` 单例 —— `authFailureFactory('Authorization')`。 */
export const DEFAULT_ON_AUTH_FAILURE = /*#__PURE__*/ authFailureFactory();

/**
 * `share` 插件 race 模式 → `retry` 插件的 settled 探针字段名。
 *
 *   - 由 `share.$race` 在每次入栈时挂上：值是 `() => boolean`，回到 entry.settled
 *   - 由 `retry.$attempt` 在入口检查：命中 true 即跳过本请求重试 —— race 已有赢家，
 *     再发是浪费带宽（caller 拿的是共享 promise 里赢家的响应，自己重试无意义）
 *   - share 未装时字段不存在，retry 走原逻辑
 */
export const SHARE_SETTLED_KEY = '__race_settled';


/** 当前 config 是否是 retry 插件接管的重试请求（即配置上挂了 `__retry` 字段） */
export function isRetry(config: AxiosRequestConfig | undefined | null): boolean {
    if (!config) return false;
    return RETRY_KEY in (config as Record<string, unknown>);
}


/* ── 通用日志 / 字符串工具 ──────────────────────────────────────────────── */

/**
 * 给请求生成简短的日志标签，多个插件的 dev 日志格式由此统一。
 *
 *   - 优先用 `config.key`（[key] 插件产出）—— 通常是稳定 hash，跨重发一致
 *   - 否则回退到 `${METHOD} ${url}`（uppercase method + 原 url；都缺时返回空串后 trim）
 *
 * 集中实现，避免 retry / auth / filter 等插件各自拼接，也保证用户在日志里 grep
 * 同一请求的多条记录格式一致。
 */
export function tagOf(config: AxiosRequestConfig): string {
    const k = (config as { key?: unknown }).key;
    if (typeof k === 'string' && k) return k;
    return `${(config.method || '').toUpperCase()} ${config.url ?? ''}`.trim();
}


/* ── plugin dependency check ─────────────────────────────────────────────── */

/**
 * 在 `install(ctx)` 阶段断言某个依赖插件已先安装。失败抛错。
 *
 * 由于 PluginManager 按 use 顺序顺序安装，调用方必须**在 use 时**把依赖放在自己之前。
 *
 * @example
 *   // 在 notification / retry / rethrow 的 install() 里：
 *   requirePlugin(ctx, 'normalize');
 */
export function requirePlugin(
    ctx: { name: string; plugins(): readonly string[] },
    name: string,
): void {
    if (!ctx.plugins().includes(name)) {
        throw new Error(
            `[${ctx.name}] requires "${name}" plugin to be installed first; ` +
            `use(${name}()) before use(${ctx.name}())`,
        );
    }
}

export function createAborter(){
    return new AbortController();
}

/**
 * "空容器"判定 —— 仅识别三种形态：
 *   - 空字符串 `''`
 *   - 空数组 `[]`（含 `length === 0`）
 *   - 空对象 `{}`（普通对象，own enumerable keys 为 0）
 *
 * `null` / `undefined` 不算空容器；`Map` / `Set` / `Date` / `RegExp` 等带专属
 * prototype 的对象也跳过 —— 它们不是"普通容器"。
 */
export function isEmpty(v: unknown): boolean {
    if (Type.isString(v)) return v === '';
    if (Type.isArray(v)) return v.length === 0;
    // Type.isObject 走 Object.prototype.toString === '[object Object]'，自动排除 Map/Set/Date/RegExp 等
    if (Type.isObject(v)) return Object.keys(v).length === 0;
    return false;
}

export function isNotEmpty<T>(v: T): boolean {
    return !isEmpty(v);
}


/**
 * 把函数的 `.name` 锁死为指定字符串 —— 防打包混淆，让 `core.eject(plugin)` 在
 * minify 后仍能识别。
 *
 * **Bug fix**: 旧实现 `Object.defineProperty(plugin, name, ...)` 第二参错了 ——
 * 它把 `plugin[name]` 设为 `name` 字符串，而不是锁住 `plugin.name`。
 */
export function lockName(target: object, name: string): void {
    Object.defineProperty(target, 'name', { value: name, configurable: true });
}