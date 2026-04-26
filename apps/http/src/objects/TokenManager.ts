export interface ITokenManager {
  /** 是否可以刷新token，调用方需在登录成功后，将改字段重置为true */
  canRefresh: boolean;
  get accessToken(): string | undefined;
  get refreshToken(): string | undefined;
  set(accessToken?: string, refreshToken?: string): void;
  clear(): void;
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
}
