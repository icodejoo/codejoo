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
 * 真正调用方法/读 length() 时才抛，提示先 import 并传入 IdbStorage。
 * db 不内置（按需引入便于 tree-shaking）。
 */
function unimpl(): AsyncStorage {
  const fail = () => {
    throw new Error(
      "[storage] 使用 db 需先传入 IndexedDB 实例：`import { IdbStorage }` 后 `buildStorage({ db: new IdbStorage() })`",
    );
  };
  return new Proxy({} as AsyncStorage, { get: () => fail });
}

export function buildStorage(baseOptions?: BaseStorageOptions) {
  return {
    ls: proxy(supported.storage ? adapt(window.localStorage) : lsMemo, lsMemo, baseOptions),
    ss: proxy(supported.storage ? adapt(window.sessionStorage) : ssMemo, ssMemo, baseOptions),
    db: proxy(baseOptions?.db ?? unimpl(), dbMemo, baseOptions),
  };
}
