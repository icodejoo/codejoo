import { factory, Idb, type BaseStorageOptions, type SyncStore, type AsyncStorage } from "../src/index";
import type { Handlers } from "../src/proxy";

/** 五种真实/兜底后端；统一使用 await handler.get/set/clear 断言。 */
export const BACKENDS = ["ls", "ss", "db", "ls(memory)", "db(memory)"] as const;

/** 参数化测试使用的后端名称。 */
export type Backend = (typeof BACKENDS)[number];

/** 删除已经关闭连接的测试数据库，阻塞也作为清理失败。 */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => reject(new Error(`测试数据库清理被阻塞: ${name}`)));
  });
}

/**
 * 创建每例隔离的后端；临时禁止原生存储以触发公开 API 的兜底路径。
 * @param backend BACKENDS 中的名称
 * @param opts 每例选项；namespace 默认为随机值，db 由夹具管理
 * @returns handler 和异步 cleanup；调用方应在 finally 中 await cleanup()
 */
export async function make(backend: Backend, opts: Omit<BaseStorageOptions, "db"> = {}) {
  const id = `storage-test-${crypto.randomUUID()}`;
  const property = backend === "ls(memory)" ? "localStorage" : backend === "db(memory)" ? "indexedDB" : undefined;
  const frame = property ? document.createElement("iframe") : undefined;
  if (frame) document.body.append(frame);
  // contentWindow 的运行时对象具有 Window 全局构造器，DOM 类型未完整表达该边界。
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const environment = frame?.contentWindow as (Window & typeof globalThis) | null | undefined;
  const descriptor = property && environment && Object.getOwnPropertyDescriptor(environment, property);
  // 原生 ESM 不可清缓存：兜底例在独立同源 realm 仅加载公开入口。
  let store: ReturnType<typeof factory>;
  try {
    let api = { factory, Idb };
    if (property && environment) {
      // 与父窗口共享 fake Date；不影响 iframe 自身的真实异步调度。
      Object.defineProperty(environment, "Date", {
        configurable: true,
        /** 动态读取父窗口时钟，允许先 make 再启用 clock。 */
        get() {
          return Date;
        },
      });
      // JSONX 的 instanceof 检查也须接收调用方 realm 的集合对象。
      environment.Map = Map;
      environment.Set = Set;
      Object.defineProperty(environment, property, {
        configurable: true,
        /** 模拟浏览器隐私策略禁止访问原生存储。 */
        get() {
          throw new DOMException("fixture denied", "SecurityError");
        },
      });
      // 静态函数体在新 realm 导入可信的本地公开入口；URL 作为参数传入。
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const load = environment.Function("url", "return import(url)") as (url: string) => Promise<typeof import("../src/index")>;
      api = await load(new URL("../src/index.ts", import.meta.url).href);
    }
    const database = backend.startsWith("db") ? new api.Idb(id) : undefined;
    store = api.factory({ ...opts, namespace: opts.namespace ?? id, db: database });
  } catch (error) {
    frame?.remove();
    throw error;
  } finally {
    if (property && descriptor && environment) Object.defineProperty(environment, property, descriptor);
  }
  const handler: Handlers<SyncStore | AsyncStorage> = backend.startsWith("db") ? store.db : backend === "ss" ? store.ss : store.ls;
  return {
    /** 随机数据库标识，便于断言真实建库与删除；内存 db 不应创建该库。 */
    databaseName: id,
    /** 公共存储处理器；同步/异步返回均可 await。 */
    handler,
    /** 清除本例数据、缓存、连接，最后删除真实数据库。 */
    async cleanup() {
      try {
        await handler.clear();
      } finally {
        try {
          await store.destroy();
          if (backend === "db") await deleteDatabase(id);
        } finally {
          frame?.remove();
        }
      }
    },
  };
}
