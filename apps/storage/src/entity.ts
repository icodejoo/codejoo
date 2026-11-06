import type { StorageEntity, StorageOptions } from "./interface";
/** 校验信封结构与有限数字元数据，保留原始解析异常。 */
export function parseEntity(text: string | null, deserialize: (text: string) => unknown = JSON.parse): StorageEntity {
  const value = (text == null ? null : deserialize(text)) as StorageEntity & Record<string, unknown>;
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, "value") ||
    ["createdAt", "expireAt", "ttl"].some(k => k in value && !(k !== "createdAt" && value[k] === null) && (typeof value[k] !== "number" || !Number.isFinite(value[k])))) throw new TypeError("Invalid storage entity");
  return value;
}
/** 只判定带创建时间的本库过期信封。 */
export const isExpired = (e: StorageEntity, now: number): boolean => e.createdAt != null && e.expireAt != null && now >= e.expireAt;
/** 剩余寿命不超过 90% 时返回续期副本。 */
export const renewOf = (e: StorageEntity, now: number): StorageEntity | undefined => e.createdAt != null && e.ttl != null && e.ttl > 0 && e.expireAt != null && e.expireAt - now <= e.ttl * .9 ? { ...e, expireAt: now + e.ttl } : undefined;
/** 只对原始类型和数组默认值执行轻量类型检查。 */
export function typeMismatch(value: unknown, fallback: unknown): boolean {
  return Array.isArray(fallback) ? !Array.isArray(value) : fallback != null && typeof fallback !== "object" && typeof fallback !== "function" && typeof value !== typeof fallback;
}
/** 创建信封；非法 ttl 忽略，非法绝对期限放弃写入。 */
export function mkEntity(value: unknown, ttl: number | undefined, expireAt: StorageOptions["expireAt"], sliding: boolean, key: string, now = Date.now()): StorageEntity | null {
  if (ttl != null && (!Number.isFinite(ttl) || ttl <= 0)) { console.warn(`[storage] invalid ttl for "${key}"; ignored`); ttl = undefined; }
  const entity: StorageEntity = { value, createdAt: now };
  if (ttl != null) { entity.ttl = ttl; entity.expireAt = now + ttl; }
  if (expireAt != null) {
    const abs = new Date(expireAt).getTime();
    if (!Number.isFinite(abs) || (abs <= now && !(sliding && ttl != null))) { console.warn(`[storage] invalid expireAt for "${key}"; skipped`); return null; }
    entity.expireAt = abs <= now ? now + ttl! : abs;
  }
  return entity;
}
