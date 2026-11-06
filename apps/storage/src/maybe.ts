/** 同步或异步结果。 */
export type Maybe<T> = T | Promise<T>;
/** 判断 Promise/thenable。 */
export const isPromise = (v: unknown): v is Promise<unknown> => typeof (v as { then?: unknown } | null)?.then === "function";
/** 统一串联同步值和 Promise。 */
export function chain<A, B>(v: Maybe<A>, fn: (a: A) => Maybe<B>): Maybe<B> {
  return isPromise(v) ? v.then(fn) : fn(v);
}
/** 捕获执行体的同步异常或异步拒绝，处理器异常原样传播。 */
export function attempt<T>(run: () => Maybe<T>, fail: (error: unknown) => Maybe<T>): Maybe<T> {
  let v: Maybe<T>;
  try { v = run(); } catch (error) { return fail(error); }
  return isPromise(v) ? v.catch(fail) : v;
}
/** 等待所有操作并丢弃结果。 */
export const all = (values: Maybe<unknown>[]): Promise<void> => Promise.all(values).then(() => undefined);
