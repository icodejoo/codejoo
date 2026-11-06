import type { BaseStorageOptions, StorageEntity } from "../../src/index";
import { afterAll } from "vitest";
import { make as originalMake, type Backend } from "../backends";
import type { AsyncStorage, SyncStore } from "../../src/index";
import type { Handlers } from "../../src/proxy";

/** 每文件只保留两个兜底 realm，避免数百次模块图加载使 Chromium 耗尽资源。 */
const anchors = new Map<Backend, ReturnType<typeof originalMake>>();

afterAll(async () => {
  await Promise.all(
    [...anchors.values()].map(async (fixture) => {
      await (await fixture).cleanup();
    }),
  );
  anchors.clear();
});

/** 复用原五后端夹具的兜底环境；每例仍使用独立 namespace、factory、memo 和 db 名。 */
export async function make(backend: Backend, options: Omit<BaseStorageOptions, "db"> = {}) {
  if (!backend.includes("(memory)")) return originalMake(backend, options);
  if (!anchors.has(backend)) anchors.set(backend, originalMake(backend));
  const anchor = await anchors.get(backend)!;
  const environment = realm(anchor.handler);
  const api = await (environment.Function("url", "return import(url)") as (url: string) => Promise<typeof import("../../src/index")>)(new URL("../../src/index.ts", import.meta.url).href);
  const id = "matrix-" + crypto.randomUUID();
  const instance = api.factory({ ...options, namespace: options.namespace ?? id, ...(backend === "db(memory)" ? { db: new api.Idb(id) } : {}) });
  const handler: Handlers<SyncStore | AsyncStorage> = backend === "db(memory)" ? instance.db : instance.ls;
  return {
    handler,
    databaseName: id,
    /** 清除本例数据和全部处理器；realm 在文件结束后由原夹具释放。 */
    async cleanup() {
      try {
        await handler.clear();
      } finally {
        await instance.destroy();
      }
    },
  };
}

/** 跨 realm 的内部 Symbol 身份不同，按已约定的描述查找实际后端。 */
export function backing(handler: Handlers<SyncStore | AsyncStorage>): SyncStore | AsyncStorage {
  const symbol = Object.getOwnPropertySymbols(handler).find((key) => key.description === "storage.store");
  if (!symbol) throw new Error("A2 STORE contract missing");
  return Reflect.get(handler, symbol) as SyncStore | AsyncStorage;
}

/** 返回执行后端的真实 realm；console 的 spy 必须与实现处于同一个窗口。 */
export function realm(handler: Handlers<SyncStore | AsyncStorage>): Window & typeof globalThis {
  return (handler.set.constructor as FunctionConstructor)("return globalThis")() as Window & typeof globalThis;
}

/** 在处理器所属 realm 调用 debug，避免内部 Symbol 跨 realm 后身份不同。 */
export async function snapshot(handler: Handlers<SyncStore | AsyncStorage>) {
  const api = await (realm(handler).Function("url", "return import(url)") as (url: string) => Promise<typeof import("../../src/debug")>)(new URL("../../src/debug.ts", import.meta.url).href);
  return api.debug(handler);
}

/** 在原处理器所属 realm 创建另一个 factory，兜底实例也共享相同模块和 Hub。 */
export async function peer(backend: Backend, handler: Handlers<SyncStore | AsyncStorage>, options: Omit<BaseStorageOptions, "db"> = {}) {
  const load = handler.set.constructor as FunctionConstructor;
  const api = await (load("url", "return import(url)") as (url: string) => Promise<typeof import("../../src/index")>)(new URL("../../src/index.ts", import.meta.url).href);
  const instance = api.factory({ ...options, namespace: handler.namespace.slice(0, -1), ...(backend.startsWith("db") ? { db: backing(handler) as AsyncStorage } : {}) });
  const other: Handlers<SyncStore | AsyncStorage> = backend.startsWith("db") ? instance.db : backend === "ss" ? instance.ss : instance.ls;
  return {
    handler: other,
    /** 只释放同层处理器，避免关闭共享数据库连接后影响原夹具。 */
    async destroy() {
      await (backend.startsWith("db") ? instance.db : backend === "ss" ? instance.ss : instance.ls).destroy();
    },
  };
}

/** 通过公开序列化钩子注入外部载荷；不依赖后端私有字段或 iframe 实现。 */
export async function matrix(backend: Backend, options: Omit<BaseStorageOptions, "db"> = {}) {
  let injected: string | undefined;
  const writes: StorageEntity[] = [];
  const fixture = await make(backend, {
    ...options,
    /** 记录实际序列化信封，允许单次模拟外部写入。 */
    serialize(entity) {
      writes.push(structuredClone(entity));
      if (injected !== undefined) {
        const result = injected;
        injected = undefined;
        return result;
      }
      return (options.serialize ?? JSON.stringify)(entity);
    },
  });
  return {
    ...fixture,
    /** 写路径及滑动续期所使用的信封快照。 */
    writes,
    /** 用一次真实后端提交模拟其他应用写入的裸 JSON 或损坏信封。 */
    async inject(key: string, text: string) {
      injected = text;
      await fixture.handler.set(key, null, { memoized: false });
    },
  };
}
