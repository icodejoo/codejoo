import { expectTypeOf, it } from "vitest";
import { Memory } from "../src/memory";
import { proxy } from "../src/proxy";
import { fast, batchFast } from "../src/fast";
import type { AsyncStorage } from "../src/interface";

it("core A9/D12 undefined defaults and literal batch keys retain exact types", () => {
  const h = proxy(new Memory(), new Memory());
  expectTypeOf(h.get("k", undefined)).toEqualTypeOf<undefined | null>();
  expectTypeOf(h.get<number | undefined>("k", undefined)).toEqualTypeOf<number | undefined | null>();
  expectTypeOf(h.get(["a", "b"] as const, [undefined, false] as const)).toEqualTypeOf<[undefined | null, false]>();
  expectTypeOf(fast<number>(h, "k").get(undefined)).toEqualTypeOf<number | null>();
  expectTypeOf(fast<undefined>(h, "k").get(undefined)).toEqualTypeOf<undefined | null>();
  const access = batchFast<number, readonly ["one"]>(h, ["one"]);
  expectTypeOf(access.one.get()).toEqualTypeOf<number | null>();
});
/** 仅编译的错误分支；不得运行。 */
export function rejectedTypeContracts(h: ReturnType<typeof proxy<AsyncStorage>>) {
  expectTypeOf(fast<undefined>(h, "k").get(undefined)).toEqualTypeOf<Promise<undefined | null>>();
  // @ts-expect-error 显式 V 时必须提供 K。
  batchFast<number>(h, ["key"]);
  const access = batchFast<number, readonly ["key"]>(h, ["key"]);
  // @ts-expect-error 不属于 K 的键必须报错。
  access.missing.get();
}
