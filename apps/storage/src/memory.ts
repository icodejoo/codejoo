import type { SyncStore } from "./interface";

/**
 * 内存存储：基于 Map 的同步实现（单标签页，无跨标签）。
 * 用途：proxy 的读缓存（MemoCache）、原生存储不可用时的兜底（SyncStore）、
 * IndexedDB 不可用时 Idb 的内存兜底。
 */
export class Memory implements SyncStore {
  /** 底层 Map */
  private store = new Map<string, any>();

  /** 键总数 */
  get length(): number {
    return this.store.size;
  }

  /** 清空 */
  clear(): void {
    this.store.clear();
  }

  /** 读取；不存在返回 null */
  get(key: string): any {
    // 按键是否存在判断，避免把存进去的空串/0/false/null 等假值误返回成 null
    return this.store.has(key) ? this.store.get(key) : null;
  }

  /** 全部键（按插入顺序） */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /** 按下标取键；越界返回 null */
  key(index: number): string | null {
    // 对齐原生：参数按 unsigned long 转换（NaN->0、向零取整），如 key(1.5) 取下标 1
    index = Math.trunc(index) || 0;
    if (index < 0 || index >= this.store.size) return null;
    let i = 0;
    for (const k of this.store.keys()) if (i++ === index) return k;
    return null;
  }

  /** 删除指定键 */
  remove(key: string): void {
    this.store.delete(key);
  }

  /** 写入键值 */
  set(key: string, value: any): void {
    this.store.set(key, value);
  }
}
