export interface ITokenManager {
  /** 是否可以刷新token，调用方需在登录成功后，将该字段重置为true */
  canRefresh: boolean;
  get accessToken(): string | undefined;
  get refreshToken(): string | undefined;
  set(accessToken?: string, refreshToken?: string): void;
  clear(): void;
}

/** SSR / 非浏览器环境下 localStorage 不存在 —— 统一经此安全访问，避免 ReferenceError。 */
const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null =
  typeof localStorage !== "undefined" ? localStorage : null;

export default class TokenManager implements ITokenManager {
  /** 存储“裸” token(不含 Bearer 前缀)；持久化的也是裸值，读取时按需加前缀，
   *  避免旧实现“存入已带 Bearer 的值 → 重新加载再次加前缀 → Bearer Bearer”的问题。 */
  #accessToken?: string;
  #refreshToken?: string;

  static #key1 = "__accessToken";
  static #key2 = "__refreshToken";

  canRefresh = true;

  constructor() {
    this.#accessToken = storage?.getItem(TokenManager.#key1) || undefined;
    this.#refreshToken = storage?.getItem(TokenManager.#key2) || undefined;
  }

  /** 直接可用于 `Authorization` 头：裸 token 存在时返回 `Bearer <token>`。 */
  get accessToken(): string | undefined {
    return this.#accessToken ? `Bearer ${this.#accessToken}` : undefined;
  }

  set accessToken(value: string | undefined | null) {
    this.#accessToken = value || undefined;
    TokenManager.#cache(this.#accessToken, TokenManager.#key1);
  }

  get refreshToken(): string | undefined {
    return this.#refreshToken;
  }

  set refreshToken(value: string | undefined | null) {
    this.#refreshToken = value || undefined;
    TokenManager.#cache(this.#refreshToken, TokenManager.#key2);
  }

  set(accessToken?: string, refreshToken?: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
  }

  clear(): void {
    this.#accessToken = undefined;
    this.#refreshToken = undefined;
    storage?.removeItem(TokenManager.#key1);
    storage?.removeItem(TokenManager.#key2);
  }

  static #cache(value: string | undefined | null, key: string) {
    if (!storage) return;
    if (value) {
      storage.setItem(key, value);
    } else {
      storage.removeItem(key);
    }
  }
}
