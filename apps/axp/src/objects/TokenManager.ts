/**
 * token 管理器需要实现的最小接口 —— `auth` 插件依赖此形状读写/清除 token，接入方
 * 可提供自定义实现（如接入 Redux/Pinia store）替换默认的 `TokenManager`。
 *
 * The minimal interface a token manager must implement — the `auth` plugin
 * relies on this shape; consumers may supply a custom implementation (e.g.
 * backed by a Redux/Pinia store) in place of the default `TokenManager`.
 */
export interface ITokenManager {
  /** 是否可以刷新token，调用方需在登录成功后，将该字段重置为true / must be reset to true by the caller after a successful login. */
  canRefresh: boolean;
  /** 当前可用于 Authorization 头的 access token，未登录为 undefined / ready for the Authorization header; undefined when not logged in. */
  get accessToken(): string | undefined;
  /** 当前的 refresh token，未登录为 undefined / undefined when not logged in. */
  get refreshToken(): string | undefined;
  /** 写入一对新的 access/refresh token（登录成功或刷新成功后调用） / writes a new token pair (on login or after a refresh). */
  set(accessToken?: string, refreshToken?: string): void;
  /** 清除所有已存储的 token（登出或刷新彻底失败时调用） / clears all stored tokens (on logout or unrecoverable refresh failure). */
  clear(): void;
}

/** SSR / 非浏览器环境下 localStorage 不存在，统一经此安全访问 / guarded access since localStorage doesn't exist in SSR/non-browser envs. */
const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null =
  typeof localStorage !== "undefined" ? localStorage : null;

/**
 * `ITokenManager` 的默认实现：access/refresh token 存于内存并镜像持久化到
 * localStorage（若存在），构造时从 localStorage 恢复上次会话的 token。
 *
 * The default `ITokenManager` implementation: keeps tokens in memory, mirrors
 * them into localStorage (when available), and restores the previous
 * session's tokens on construction.
 */
export default class TokenManager implements ITokenManager {
  /** 存储“裸” token(不含 Bearer 前缀)；持久化的也是裸值，读取时按需加前缀，
   *  避免旧实现“存入已带 Bearer 的值 → 重新加载再次加前缀 → Bearer Bearer”的问题。
   *
   *  Stores the "bare" token (no `Bearer` prefix); the prefix is added on read,
   *  avoiding the old bug of double-prefixing into `Bearer Bearer`. */
  #accessToken?: string;
  #refreshToken?: string;

  static #key1 = "axp:token:access";
  static #key2 = "axp:token:refresh";

  canRefresh = true;

  /**
   * 构造时尝试从 localStorage 恢复上次会话的 access/refresh token；SSR/非浏览器
   * 环境或此前未登录过时两者均为 undefined。
   *
   * Attempts to restore tokens from localStorage on construction; both are
   * undefined in SSR/non-browser environments or when there was no prior login.
   */
  constructor() {
    this.#accessToken = storage?.getItem(TokenManager.#key1) || undefined;
    this.#refreshToken = storage?.getItem(TokenManager.#key2) || undefined;
  }

  /** 直接可用于 Authorization 头：裸 token 存在时返回 `Bearer <token>` / returns `Bearer <token>` when present, else undefined. */
  get accessToken(): string | undefined {
    return this.#accessToken ? `Bearer ${this.#accessToken}` : undefined;
  }

  /** 写入新 access token，空值归一化为 undefined 并同步持久化 / writes a new access token, normalizing falsy to undefined and syncing to localStorage. */
  set accessToken(value: string | undefined | null) {
    this.#accessToken = value || undefined;
    TokenManager.#cache(this.#accessToken, TokenManager.#key1);
  }

  /** 当前的 refresh token，未登录为 undefined / undefined when not logged in. */
  get refreshToken(): string | undefined {
    return this.#refreshToken;
  }

  /** 写入新 refresh token，空值归一化为 undefined 并同步持久化 / writes a new refresh token, normalizing falsy to undefined and syncing to localStorage. */
  set refreshToken(value: string | undefined | null) {
    this.#refreshToken = value || undefined;
    TokenManager.#cache(this.#refreshToken, TokenManager.#key2);
  }

  /**
   * 写入一对新的 access/refresh token（经由各自 setter，同时持久化到 localStorage）。
   *
   * Writes a new access/refresh token pair (via their setters, which also sync to localStorage).
   *
   * @param accessToken 新的裸 access token，省略/空值等价于清空 / omitted/falsy clears it
   * @param refreshToken 新的 refresh token，省略/空值等价于清空 / omitted/falsy clears it
   */
  set(accessToken?: string, refreshToken?: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  /**
   * 清除内存中及 localStorage 中持久化的所有 token。
   *
   * Clears both the in-memory tokens and their persisted copies in localStorage.
   */
  clear(): void {
    this.#accessToken = undefined;
    this.#refreshToken = undefined;
    storage?.removeItem(TokenManager.#key1);
    storage?.removeItem(TokenManager.#key2);
  }

  /** 把 value 写入 localStorage（若存在），空值时移除该键 / writes value to localStorage, or removes the key when falsy. */
  static #cache(value: string | undefined | null, key: string) {
    if (!storage) return;
    if (value) {
      storage.setItem(key, value);
    } else {
      storage.removeItem(key);
    }
  }
}
