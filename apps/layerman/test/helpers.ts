import { type AsyncableStorage, createLayerman, type Layerman, type LayermanOptions } from "../src/index.ts";

/** 创建隔离的内存存储，并暴露后备 Map 供断言。 */
export function memStorage(): {
  /** 可注入管理器的存储接口。 */
  storage: AsyncableStorage;
  /** 供断言读取的实际存储内容。 */
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      /** 读取当前存储快照。 */
      get: (key) => map.get(key) ?? null,
      /** 同步记录写入内容。 */
      set: (key, value) => {
        map.set(key, value);
      },
    },
  };
}

/** 创建可由测试主动完成或拒绝的 Promise。 */
export function deferred<T>(): {
  /** 等待测试主动完成的异步结果。 */
  promise: Promise<T>;
  /** 主动兑现结果。 */
  resolve: (value: T) => void;
  /** 主动拒绝结果。 */
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** 按调用方配置创建管理器，并登记到该文件的清理列表。 */
export function createManager(managers: Layerman[], options: LayermanOptions): Layerman {
  const manager = createLayerman(options);
  managers.push(manager);
  return manager;
}
