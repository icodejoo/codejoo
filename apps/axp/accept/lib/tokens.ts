import type { AccessTokenMode, RefreshTokenMode, SetTokenSpec } from "./types.ts";

/** 默认的令牌前缀 */
export const DEFAULT_SCHEME = "Bearer";
/** 错误前缀（set_token wrong_scheme 用） */
export const WRONG_SCHEME = "Token";
/** "假令牌"：不是 JWT 格式的字符串 */
export const GARBAGE_ACCESS = "garbage-not-a-jwt";
/** "假 refresh" */
export const GARBAGE_REFRESH = "garbage-refresh-token";
/** 被篡改的 sub 取值后缀 */
const TAMPER_SUFFIX = "-tampered";

/** base64url 编码 */
export function b64urlEncode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** base64url 解码；非法输入返回 null */
export function b64urlDecode(seg: string): string | null {
  try {
    return Buffer.from(seg, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** 把 Authorization 头值拆成 [scheme, token]；没有空格时 scheme 为空串 */
export function splitHeader(value: string): [scheme: string, token: string] {
  const i = value.indexOf(" ");
  return i < 0 ? ["", value] : [value.slice(0, i), value.slice(i + 1)];
}

/**
 * 改坏 JWT 的签名段（保持 header/payload 不变），得到"签名不对"的令牌。
 * @param jwt 合法 JWT；不是三段式时原样追加一个字符让它必然失效
 */
export function breakSignature(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length !== 3) return `${jwt}x`;
  const sig = parts[2] ?? "";
  const first = sig[0] === "A" ? "B" : "A";
  parts[2] = first + sig.slice(1);
  return parts.join(".");
}

/**
 * 篡改 JWT 的 payload（改 sub）而不重签，得到"内容被改"的令牌。
 * @param jwt 合法 JWT；解析失败时退化为破坏签名
 */
export function tamperPayload(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length !== 3) return breakSignature(jwt);
  const json = b64urlDecode(parts[1] ?? "");
  if (json === null) return breakSignature(jwt);
  try {
    const payload = JSON.parse(json) as Record<string, unknown>;
    payload.sub = `${typeof payload.sub === "string" ? payload.sub : "u"}${TAMPER_SUFFIX}`;
    parts[1] = b64urlEncode(JSON.stringify(payload));
    return parts.join(".");
  } catch {
    return breakSignature(jwt);
  }
}

/**
 * 客户端持有的令牌状态，实现 axp 的 `ITokenManager` 形状，并记录 `previous`。
 * 每次替换令牌（login、刷新成功、set_token、expire_local、clear）都会把旧值记成 previous（CONTRACT 附录 B.3）。
 * 内部保存"完整 Authorization 头值"（如 `Bearer xxx`），这样 wrong_scheme 能原样表达。
 */
export class TokenStore {
  /** 当前登录用户名 */
  user: string | undefined;
  #access: string | undefined;
  #refresh: string | undefined;
  #prevAccess: string | undefined;
  #prevRefresh: string | undefined;

  /** 完整的 Authorization 头值；未登录为 undefined，空串表示"空令牌" */
  get accessToken(): string | undefined {
    return this.#access;
  }

  /** 当前 refresh token */
  get refreshToken(): string | undefined {
    return this.#refresh;
  }

  /** 最近一次变化之前的 access 头值 */
  get previousAccess(): string | undefined {
    return this.#prevAccess;
  }

  /** 最近一次变化之前的 refresh */
  get previousRefresh(): string | undefined {
    return this.#prevRefresh;
  }

  /** 当前 access 的裸令牌（去掉前缀） */
  get rawAccess(): string | undefined {
    return this.#access === undefined ? undefined : splitHeader(this.#access)[1];
  }

  /**
   * 直接设置 access 头值，值变化时记录旧值。
   * @param header 完整头值，undefined 表示删除
   */
  setAccessHeader(header: string | undefined): void {
    if (header !== this.#access) this.#prevAccess = this.#access;
    this.#access = header;
  }

  /**
   * 设置 refresh，值变化时记录旧值。
   * @param refresh 新 refresh，undefined 表示删除
   */
  setRefresh(refresh: string | undefined): void {
    if (refresh !== this.#refresh) this.#prevRefresh = this.#refresh;
    this.#refresh = refresh;
  }

  /**
   * ITokenManager.set：写入裸 access 与 refresh（axp 约定 access 不含前缀）。
   * @param accessToken 裸 access
   * @param refreshToken refresh
   */
  set(accessToken?: string, refreshToken?: string): void {
    this.setAccessHeader(accessToken ? `${DEFAULT_SCHEME} ${accessToken}` : undefined);
    this.setRefresh(refreshToken || undefined);
  }

  /** ITokenManager.clear：清空两种令牌（旧值记为 previous） */
  clear(): void {
    this.setAccessHeader(undefined);
    this.setRefresh(undefined);
  }

  /**
   * 执行 set_token step：按取值篡改 access / refresh。
   * @param spec 中立的 set_token 参数；缺省的字段等价于 keep
   * @example store.applySetToken({ access: 'garbage', refresh: 'previous' })
   */
  applySetToken(spec: SetTokenSpec): void {
    // 先算出两个新值再统一写入，避免 access 的修改影响 refresh 的 previous 取值
    const nextAccess = resolveAccess(spec.access ?? "keep", this.#access, this.#prevAccess);
    const nextRefresh = resolveRefresh(spec.refresh ?? "keep", this.#refresh, this.#prevRefresh);
    this.setAccessHeader(nextAccess);
    this.setRefresh(nextRefresh);
  }
}

/**
 * 计算 set_token 之后的 access 头值。
 * @param mode set_token.access 取值
 * @param current 当前头值
 * @param previous 上一次变化前的头值
 * @returns 新头值（undefined 表示删除）
 */
export function resolveAccess(mode: AccessTokenMode, current: string | undefined, previous: string | undefined): string | undefined {
  const [scheme, raw] = splitHeader(current ?? "");
  switch (mode) {
    case "keep":
      return current;
    case "none":
      return undefined;
    case "empty":
      return "";
    case "garbage":
      return `${DEFAULT_SCHEME} ${GARBAGE_ACCESS}`;
    case "bad_signature":
      return `${scheme || DEFAULT_SCHEME} ${breakSignature(raw)}`;
    case "tampered_payload":
      return `${scheme || DEFAULT_SCHEME} ${tamperPayload(raw)}`;
    case "wrong_scheme":
      return `${WRONG_SCHEME} ${raw}`;
    case "previous":
      return previous;
  }
}

/**
 * 计算 set_token 之后的 refresh。
 * @param mode set_token.refresh 取值
 * @param current 当前 refresh
 * @param previous 上一次变化前的 refresh
 */
export function resolveRefresh(mode: RefreshTokenMode, current: string | undefined, previous: string | undefined): string | undefined {
  switch (mode) {
    case "keep":
      return current;
    case "none":
      return undefined;
    case "garbage":
      return GARBAGE_REFRESH;
    case "previous":
      return previous;
  }
}
