import type { SyncStore } from "./interface";

/** 内存存储：用于读缓存及各类后端的内存兜底。 */
export class Memory implements SyncStore {
  /** 后端种类；缓存及 IDB 兜底默认标为 idb。 */
  readonly kind: "local" | "session" | "idb";
  /** 底层 Map。 */
  private store = new Map<string, any>();
  /** 指定兜底所属后端；不影响原有无参调用。 */
  constructor(kind: "local" | "session" | "idb" = "idb") {
    this.kind = kind;
  }
  /** 键总数。 */
  get length(): number {
    return this.store.size;
  }
  /** 清空。 */
  clear(): void {
    this.store.clear();
  }
  /** 读取；不存在返回 null。 */
  get(key: string): any {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  /** 全部键，按插入顺序。 */
  keys(): string[] {
    return [...this.store.keys()];
  }
  /** 按原生 unsigned long 下标取键。 */
  key(index: number): string | null {
    index = index >>> 0;
    if (index >= this.store.size) return null;
    const keys = this.store.keys();
    while (index-- > 0) keys.next();
    return keys.next().value!;
  }
  /** 删除指定键。 */
  remove(key: string): void {
    this.store.delete(key);
  }
  /** 写入键值。 */
  set(key: string, value: any): void {
    this.store.set(key, value);
  }
}
