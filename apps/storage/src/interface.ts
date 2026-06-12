/** proxy 读缓存的最小接口（Memory 满足） */
export interface MemoCache {
  get(key: string): any;
  set(key: string, value: any): void;
  remove(key: string): void;
  clear(): void;
}

/** 同步键值存储后端：Memory，以及被适配后的原生 localStorage/sessionStorage */
export interface SyncStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear(): void;
  key(index: number): string | null;
  /** 可选：一次性返回全部存储键。提供时 clear/keys/purge 走快路径（免逐下标枚举） */
  keys?(): string[];
  length: number;
}

/** 异步键值存储后端（IndexedDB 持久层，Idb 实现） */
export interface AsyncStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  key(index: number): Promise<string | null>;
  /** 可选：一次性返回全部存储键。提供时 clear/keys/purge 走快路径（Idb 单次 getAllKeys，免逐下标 O(n²)） */
  keys?(): Promise<string[]>;
  /** 可选批量原语：单事务内完成。提供时批量 get/set/remove 与 clear/purge 走快路径（免 N 次事务开销） */
  getMany?(keys: readonly string[]): Promise<(string | null)[]>;
  setMany?(entries: readonly (readonly [string, string])[]): Promise<void>;
  removeMany?(keys: readonly string[]): Promise<void>;
  length(): Promise<number>;
}

/** 编解码器：成对的字符串变换，用于对落盘字符串做混淆/加密/压缩等 */
export interface Codec {
  encode(value: string): string;
  /** 解码失败（密钥不匹配/数据损坏）返回 null，由上层决定清除或回退，避免抛错 */
  decode(value: string): string | null;
}

export interface BaseStorageOptions {
  /** 是否同步存储到内存 */
  memoized?: boolean;
  /** memo 命中/回填的对象返回深拷贝（structuredClone），隔离调用方修改对缓存的污染；默认 false（共享引用，零开销） */
  cloned?: boolean;
  /** 自定义序列化：entity -> 字符串，取代默认 JSON.stringify */
  serialize?: (entity: StorageEntity) => string;
  /** 自定义反序列化：字符串 -> entity，需与 serialize 配对，取代默认 JSON.parse */
  deserialize?: (raw: string) => StorageEntity;
  /** 是否启用编解码：为 true 时才调用 codec；默认 false。便于按环境(开发/生产)开关 */
  codeable?: boolean;
  /** 编解码器：encode/decode 须配对。对值生效需 codeable 为 true；enckey 键加密只要求传入 codec、不要求 codeable */
  codec?: Codec;
  /** 滑动过期：每次读命中后按原始 ttl 续期，适合登录态/会话类数据 */
  sliding?: boolean;
  /** 键命名空间前缀，隔离同源下不同应用/模块，避免 key 冲突 */
  namespace?: string;
  /** 跳过 entity 信封，直接存裸值（兼容外部写入/读取的原始数据） */
  raw?: boolean;
  /** 容量不足时强制腾挪：清理已过期数据后重试写入；默认 true。仍失败则记录错误日志并放弃本次写入 */
  force?: boolean;
  /** 只写一次：默认 false。为 true 时仅当键为空（不存在/已过期）才写入，否则丢弃本次写入 */
  readonly?: boolean;
  /** 是否对键也加密：默认 false。为 true 且配置了 codec 时，存储键经 codec 确定性加密（隐藏明文键名） */
  enckey?: boolean;
  /**
   * 额外的 IndexedDB 持久层实例（**异步** API，不常驻内存镜像，容量更大），暴露为 factory().db。
   * 需自行 `import { Idb }` 构造后传入：`db: new Idb()`（不内置，按需引入便于 tree-shaking）。
   * IndexedDB 不可用时其内部自动退回内存；未传实例时使用 db 会抛错提示先传入。
   * 注意：db 为异步存储，不经同步 proxy，故 ttl/codec/namespace 等选项暂不作用于 db。
   */
  db?: AsyncStorage;
}

/** set 的 per-call 选项。仅以下三项 per-call 生效；其余（codec/sliding/raw 等）为实例级配置，见 BaseStorageOptions */
export interface StorageOptions {
  /** 存活时间：毫秒 */
  ttl?: number;
  /** 过期时间，时间戳|日期字符串|日期 */
  expireAt?: number | string | Date;
  /** 本次写入是否同步存入 memo 读缓存（覆盖实例级 memoized） */
  memoized?: boolean;
}

/** 实际存储对象 */
export interface StorageEntity {
  /** 存储的真实值 */
  value: any;
  /** 过期时间，时间戳 */
  expireAt?: number;
  /** 创建时间戳，用于滑动续期、调试、按时间淘汰(LRU) */
  createdAt?: number;
  /** 原始 ttl（毫秒），滑动过期时据此重算 expireAt */
  ttl?: number;
}
