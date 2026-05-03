/**
 * `TokenManager` —— **token 事务领域对象**。
 *
 * 不只是存储：负责 token 在 HTTP 请求中的"写入表达式"。子类或自定义实现可
 * 完全决定 token 的物理位置（Authorization 头 / X-Token 头 / Cookie / 查询参数 …）
 * 与编码形态（Bearer 前缀 / API key / 自家签名）。
 *
 * `auth` 插件不直接读 `headers.Authorization`，而是通过 `toHeaders()` 让
 * TokenManager 自己决定 wire format —— 插件成为 transport-agnostic 的中间层。
 */
export interface ITokenManager {
  /** 是否可以刷新 token；调用方需在登录成功后将本字段重置为 true */
  canRefresh: boolean;

  get accessToken(): string | undefined;
  get refreshToken(): string | undefined;

  /** 同时写入 access / refresh token（任一可空） */
  set(accessToken?: string, refreshToken?: string): void;

  /** 清空双 token（含底层持久化） */
  clear(): void;

  /**
   * 把当前 access token 编码为应附加到请求的 headers 片段。
   * 默认实现：`accessToken` 存在 → `{ Authorization: <accessToken> }`，否则 `undefined`。
   *
   * 子类 / 自定义实现可改成 `X-Token` / `X-Api-Key` / `Cookie` 等任意位置。
   * `auth` 插件 `ready` 钩子的标准用法：
   *   `Object.assign(config.headers ??= {}, tm.toHeaders() ?? {})`
   */
  toHeaders(): Record<string, string> | undefined;
}

export default class TokenManager implements ITokenManager {
  #accessToken?: string;
  #refreshToken?: string;

  static #key1 = "__accessToken";
  static #key2 = "__refreshToken";

  canRefresh = true;

  constructor() {
    this.accessToken = localStorage.getItem(TokenManager.#key1) || undefined;
    this.refreshToken = localStorage.getItem(TokenManager.#key2) || undefined;
  }

  get accessToken(): string | undefined {
    return this.#accessToken;
  }

  set accessToken(value: string | undefined | null) {
    value = value ? `Bearer ${value}` : undefined;
    this.#accessToken = value;
    // this.#cache(this.#accessToken, TokenManager.#key1);
  }

  get refreshToken(): string | undefined {
    return this.#refreshToken;
  }

  set refreshToken(value: string | undefined | null) {
    this.#refreshToken = value || undefined;
    // this.#cache(this.#refreshToken, TokenManager.#key2);
  }

  set(accessToken?: string, refreshToken?: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  clear(): void {
    this.#accessToken = undefined;
    this.#refreshToken = undefined;
    localStorage.removeItem(TokenManager.#key1);
    localStorage.removeItem(TokenManager.#key2);
  }

  toHeaders(): Record<string, string> | undefined {
    return this.#accessToken ? { Authorization: this.#accessToken } : undefined;
  }

  #cache(value: string | undefined | null, key: string) {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  }
}
