import type { AsyncStorage, BaseStorageOptions, SyncStore } from "./interface";
import { supported } from "./helper";
import { Memory } from "./memory";
import { proxy } from "./proxy";

// 每层独立的内存缓存（单标签页，无跨标签）
const lsMemo = new Memory();
const ssMemo = new Memory();
const dbMemo = new Memory();

/** 把原生 Storage（getItem/setItem/...）适配成内部统一的 get/set/remove 词汇 */
function adapt(s: Storage): SyncStore {
  return {
    get: (k) => s.getItem(k),
    set: (k, v) => s.setItem(k, v),
    remove: (k) => s.removeItem(k),
    clear: () => s.clear(),
    key: (i) => s.key(i),
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
    throw new Error("[storage] 使用 db 需先传入 IndexedDB 实例：`import { Idb }` 后 `factory({ db: new Idb() })`");
  };
  return new Proxy({} as AsyncStorage, { get: () => fail });
}

export function factory(baseOptions?: BaseStorageOptions) {
  const ls = proxy(supported.storage ? adapt(window.localStorage) : lsMemo, lsMemo, baseOptions);
  const ss = proxy(supported.storage ? adapt(window.sessionStorage) : ssMemo, ssMemo, baseOptions);
  const db = proxy(baseOptions?.db ?? unimpl(), dbMemo, baseOptions);

  return {
    ls,
    ss,
    db,
    /**
     * 统一释放本实例占用的内存与连接：依次调用 ls/ss/db 各自的 destroy
     * （清空 memo 读缓存、断开 db 的 IndexedDB 连接）。不删除已落盘数据。
     * db 为异步后端，故整体返回 Promise，可 await 以确保连接已断开。
     */
    destroy(): Promise<void> {
      ls.destroy();
      ss.destroy();
      return Promise.resolve(db.destroy());
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
