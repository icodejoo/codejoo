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
