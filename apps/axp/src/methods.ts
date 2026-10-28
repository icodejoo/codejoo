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

/** 不改变服务端状态的方法，share 与 cache 默认只处理它们。 */
export const SAFE_METHODS = ["get", "head"];

/** 把方法列表规范成小写集合，供请求期按方法 O(1) 判定。
 * @param list 方法列表，大小写不敏感。
 * @returns 小写方法集合。
 * @example `methodSet(['GET', 'Head']).has('get') // true`
 */
export function methodSet(list: readonly string[]): Set<string> {
  return new Set(list.map(normalizeMethod));
}
