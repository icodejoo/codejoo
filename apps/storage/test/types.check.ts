import { expectTypeOf } from "vitest";
import { batchFast, factory, fast, Idb } from "../src/index";
import type { Result } from "../src/proxy";
import type { AsyncStorage, SyncStore, StorageErrorInfo } from "../src/index";

/** 仅供类型诊断：不由运行时 browser/node include 收集，禁止执行此函数。 */
export function storageTypeContract() {
  const { ls, db } = factory({ db: new Idb("types-only") });
  expectTypeOf(ls.get("key", 0)).toEqualTypeOf<number>();
  expectTypeOf(db.get("key", 0)).toEqualTypeOf<Promise<number>>();
  expectTypeOf(ls.get<number>("key")).toEqualTypeOf<number | null>();
  expectTypeOf(ls.get("key", undefined)).toEqualTypeOf<undefined | null>();
  expectTypeOf(ls.get<number | undefined>("key", undefined)).toEqualTypeOf<number | undefined | null>();
  expectTypeOf(db.get<number | undefined>("key", undefined)).toEqualTypeOf<Promise<number | undefined | null>>();
  expectTypeOf(ls.get("key", "default")).toEqualTypeOf<string>();
  expectTypeOf(ls.get("key", false)).toEqualTypeOf<boolean>();
  expectTypeOf(ls.get("key", 1n)).toEqualTypeOf<bigint>();
  expectTypeOf(db.get<number>("key")).toEqualTypeOf<Promise<number | null>>();
  expectTypeOf(ls.get(["a", "b"] as const, [1, false] as const)).toEqualTypeOf<[1, false]>();
  expectTypeOf(db.get(["a", "b"] as const, [1, false] as const)).toEqualTypeOf<Promise<[1, false]>>();
  expectTypeOf(ls.get(["a", "b"] as const, [1] as const)).toEqualTypeOf<[1, unknown]>();
  expectTypeOf(ls.get(["a", "b"] as const, [undefined, false] as const)).toEqualTypeOf<[undefined | null, false]>();
  expectTypeOf(ls.get<[number, boolean]>(["a", "b"])).toEqualTypeOf<[number | null, boolean | null]>();
  expectTypeOf(db.get<[number, boolean]>(["a", "b"])).toEqualTypeOf<Promise<[number | null, boolean | null]>>();
  expectTypeOf(ls.set("key", 1)).toEqualTypeOf<void>();
  expectTypeOf(db.set(["a", "b"], [1, false])).toEqualTypeOf<Promise<void>>();
  expectTypeOf(db.length).toEqualTypeOf<Promise<number>>();
  expectTypeOf(db.keys()).toEqualTypeOf<Promise<string[]>>();
  expectTypeOf<Result<SyncStore, number>>().toEqualTypeOf<number>();
  expectTypeOf<Result<AsyncStorage, number>>().toEqualTypeOf<Promise<number>>();
  const accessors = batchFast<number, readonly ["one", "two"]>(ls, ["one", "two"]);
  expectTypeOf(accessors.one.get()).toEqualTypeOf<number | null>();
  expectTypeOf(fast<number>(ls, "key").get()).toEqualTypeOf<number | null>();
  expectTypeOf(fast<number>(ls, "key").get(undefined)).toEqualTypeOf<number | null>();
  expectTypeOf(fast<number | undefined>(ls, "key").get(undefined)).toEqualTypeOf<number | undefined | null>();
  expectTypeOf(fast<number>(db, "key").get(undefined)).toEqualTypeOf<Promise<number | null>>();
  const asyncAccessors = batchFast<number, readonly ["one", "two"]>(db, ["one", "two"]);
  expectTypeOf(asyncAccessors.two.get(0)).toEqualTypeOf<Promise<number>>();
  const inferred = batchFast(ls, ["one", "two"]);
  expectTypeOf(inferred.one.get()).toEqualTypeOf<unknown>();
  // @ts-expect-error 明确传 V 后必须同时指定 K，防止键约束丢失（A8/D12）。
  batchFast<number>(ls, ["one"]);
  // @ts-expect-error 异步重载同样禁止省略 K。
  batchFast<number>(db, ["one"]);
  // @ts-expect-error 键名必须属于显式元组。
  accessors.missing.get();
  // @ts-expect-error 自动推导也保留逻辑键集合。
  inferred.missing.get();
  // @ts-expect-error 快捷写入必须满足绑定值类型。
  accessors.one.set("wrong");
  // @ts-expect-error 显式元组的键数必须匹配。
  ls.get<[number, boolean]>(["a"]);
  // @ts-expect-error per-call 第三参不接受 boolean。
  ls.set("key", 1, true);
  factory({ onError: errorContract });
}

/** 判别联合必须按 kind 收窄；穷尽检查让新增 kind 显式进入类型契约。 */
function errorContract(info: StorageErrorInfo): void {
  expectTypeOf(info.error).toEqualTypeOf<unknown>();
  expectTypeOf(info.key).toEqualTypeOf<string>();
  switch (info.kind) {
    case "write":
      expectTypeOf(info.kind).toEqualTypeOf<"write">();
      break;
    case "serialize":
      expectTypeOf(info.kind).toEqualTypeOf<"serialize">();
      break;
    case "corrupt":
      expectTypeOf(info.kind).toEqualTypeOf<"corrupt">();
      break;
    case "type":
      expectTypeOf(info.kind).toEqualTypeOf<"type">();
      break;
    case "abort":
      expectTypeOf(info.kind).toEqualTypeOf<"abort">();
      break;
    default:
      expectTypeOf(info).toEqualTypeOf<never>();
  }
  // @ts-expect-error 原始异常是 unknown，不能直接读取异常消息。
  console.log(info.error.message);
}
