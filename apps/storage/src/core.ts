import type { AsyncStorage, BaseStorageOptions, SyncStore } from "./interface";
import { supported } from "./helper";
import { Memory } from "./memory";
import { proxy } from "./proxy";

/** 把原生 Storage（getItem/setItem/...）适配成内部统一的 get/set/remove 词汇 */
function adapt(s: Storage): SyncStore {
  return {
    get: (k) => s.getItem(k),
    set: (k, v) => s.setItem(k, v),
    remove: (k) => s.removeItem(k),
    clear: () => s.clear(),
    key: (i) => s.key(i),
    keys: () => Object.keys(s), // 原生 Storage 的键即自身可枚举属性；供 clear/keys/purge 快路径

    get length() {
      return s.length;
    },
  };
}

/**
 * 未传入 db 实例时的占位。
 * 每个属性都返回同一个「抛错函数」：读取属性不抛（proxy 初始化时会读 length 判异步），
 * 真正调用方法/读 length() 时才抛，提示先 import 并传入 Idb。
 * db 不内置（按需引入便于 tree-shaking）。
 */
function unimpl(): AsyncStorage {
  const fail = () => {
    throw new Error("[storage] using `db` requires an IndexedDB instance: `import { Idb }` then `factory({ db: new Idb() })`");
  };
  return new Proxy({} as AsyncStorage, { get: () => fail });
}

export function factory(baseOptions?: BaseStorageOptions) {
  // 每层独立的内存读缓存，且按 factory 实例隔离（不同实例不共享 memo，避免跨实例串读）
  const lsMemo = new Memory();
  const ssMemo = new Memory();
  const dbMemo = new Memory();
  // 原生存储不可用时的兜底后端必须与上面的 memo 缓存是不同的 Memory 实例：
  // 二者若是同一个 Map，memo.clear()（destroy/clear/setNamespace 都会调）会把"落盘"数据本身一并清空，
  // 且 memoized 写入 entity 对象会与后端写入的 JSON 字符串互相覆盖同一个键。
  const ls = proxy(supported.storage ? adapt(window.localStorage) : new Memory(), lsMemo, baseOptions);
  const ss = proxy(supported.storage ? adapt(window.sessionStorage) : new Memory(), ssMemo, baseOptions);
  const dbProvided = baseOptions?.db != null;
  const db = proxy(baseOptions?.db ?? unimpl(), dbMemo, baseOptions);

  return {
    ls,
    ss,
    db,
    /**
     * 统一释放本实例占用的内存与连接：依次调用 ls/ss/db 各自的 destroy
     * （清空 memo 读缓存、断开 db 的 IndexedDB 连接）。不删除已落盘数据。
     * db 为异步后端，故整体返回 Promise，可 await 以确保连接已断开。
     * 未传入 db 时跳过 db.destroy()——unimpl() 占位对象任何方法调用都会抛错，
     * 而这里是无条件触发的收尾调用，不应因为用户根本没用过 db 而抛出。
     */
    destroy(): Promise<void> {
      ls.destroy();
      ss.destroy();
      return dbProvided ? db.destroy() : Promise.resolve();
    },
    /**
     * 切换命名空间（如按 username 隔离账号，登入/登出时调用）：原地修改 ls/ss/db 三层前缀，
     * 应用中已持有的同一实例引用会自动生效，无需重新获取。同时清空各层 memo 读缓存。
     * 注意：仅做隔离，不清除上个命名空间的落盘数据；敏感数据（token 等）请在登出时显式清除。
     */
    setNamespace(username?: string): void {
      ls.setNamespace(username);
      ss.setNamespace(username);
      db.setNamespace(username);
    },
  };
}
