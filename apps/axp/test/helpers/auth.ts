import type { InternalAxiosRequestConfig } from "axios";

/**
 * 读 Authorization 请求头（AxiosHeaders 用 .get）。
 * @param c 请求配置
 * @returns 头的字符串值；不存在或非字符串返回 undefined
 * @example authHeader(config) // 'Bearer t1'
 */
export function authHeader(c: InternalAxiosRequestConfig): string | undefined {
  const h = c.headers as { get?: (n: string) => unknown } | undefined;
  const v = h?.get ? h.get("Authorization") : (c.headers as any)?.Authorization;
  return typeof v === "string" ? v : undefined;
}
