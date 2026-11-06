/** 可观察错误的操作名称。 */
export type StorageOperation = "get" | "set" | "remove" | "clear" | "purge";
/** 存储错误；error 保留原始异常对象。 */
export type StorageErrorInfo = { [K in "write" | "serialize" | "corrupt" | "type" | "abort"]: {
  /** 错误分类。 */
  kind: K;
  /** 失败操作。 */
  op: StorageOperation;
  /** 逻辑键；整库操作为空字符串。 */
  key: string;
  /** 原始异常。 */
  error: unknown;
} }["write" | "serialize" | "corrupt" | "type" | "abort"];
/** 上报错误；不捕获用户回调异常。 */
export function report(onError: ((info: StorageErrorInfo) => void) | undefined, info: StorageErrorInfo): void {
  if (onError) onError(info);
  else console.error(`[storage] ${info.kind} failed for "${info.key}"`, info.error);
}
