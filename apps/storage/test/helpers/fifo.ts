import type { AsyncStorage } from "../../src/index";
import { Memory } from "../../src/memory";

/** 补充竞态用的 FIFO 后端；每个原语在微任务中按调用顺序执行，不增加真实延迟。 */
export function fifo(): AsyncStorage {
  const data = new Memory();
  let tail = Promise.resolve();
  /** 串行执行单个原语，失败后仍允许后续操作运行。 */
  const call = <T>(operation: () => T): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    get: (key) => call(() => data.get(key)),
    set: (key, value) => call(() => data.set(key, value)),
    remove: (key) => call(() => data.remove(key)),
    clear: () => call(() => data.clear()),
    key: (index) => call(() => data.key(index)),
    keys: () => call(() => data.keys()),
    length: () => call(() => data.length),
  };
}
