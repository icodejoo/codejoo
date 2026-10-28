/** 判断非空对象，数组和特殊对象均保留为对象。
 * @internal
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** 判断可按字段复制的普通对象，包括无原型字典。
 * @internal
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
