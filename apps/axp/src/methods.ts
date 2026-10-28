/** payload 作为请求体发送的四个方法。 */
export const BODY_METHODS = ["delete", "post", "put", "patch"] as const;
/** payload 作为查询参数发送的六个方法。 */
export const NO_BODY_METHODS = ["get", "head", "options", "purge", "link", "unlink"] as const;

/** 判断规范化的小写方法是否使用请求体。
 * @param method 小写 HTTP 方法。
 * @returns 是否属于四个请求体方法。
 * @example `isBodyMethod('post')`
 */
export function isBodyMethod(method: string): boolean {
  return (BODY_METHODS as readonly string[]).includes(method);
}
/** 缺少方法时采用 axios 的 GET 语义。 */
export const DEFAULT_METHOD = "get";

/** 统一请求方法的大小写，空值采用默认方法。
 * @param method 请求方法。
 * @returns 小写 HTTP 方法。
 * @example `normalizeMethod('POST')`
 */
export function normalizeMethod(method?: string): string {
  return (method ?? DEFAULT_METHOD).toLowerCase();
}
