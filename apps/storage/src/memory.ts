import type { SyncStore } from "./interface";

/**
 * 内存存储：基于 Map 的同步实现（单标签页，无跨标签）。
 * 用途：proxy 的读缓存（MemoCache）、原生存储不可用时的兜底（SyncStore）、IdbStorage 的内存镜像。
 */
export class Memory implements SyncStore {
  private store = new Map<string, any>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  get(key: string): any {
    key = String(key);
    // 按键是否存在判断，避免把存进去的空串/0/false/null 等假值误返回成 null
    return this.store.has(key) ? this.store.get(key) : null;
  }

  key(index: number): string | null {
    // 对齐原生：参数按 unsigned long 转换（NaN->0、向零取整），如 key(1.5) 取下标 1
    index = Math.trunc(index) || 0;
    if (index < 0 || index >= this.store.size) return null;
    let i = 0;
    for (const k of this.store.keys()) if (i++ === index) return k;
    return null;
  }

  remove(key: string): void {
    this.store.delete(String(key));
  }

  set(key: string, value: any): void {
    this.store.set(String(key), value);
  }
}
