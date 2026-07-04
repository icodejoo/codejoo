import { describe, expectTypeOf, it } from "vitest";

import { createOverlayManager, type DismissResult, type OverlayInstance, type OverlayRecord } from "../src/index.ts";

// 类型级契约测试：由 tsc(tsconfig include test/**) 静态校验；运行时为 no-op。
describe("类型契约", () => {
  it("open<TData,TResult> 返回可 await 的结果", () => {
    const m = createOverlayManager();
    const h = m.open<{ a: number }, boolean>({ id: "x", data: { a: 1 } });
    expectTypeOf(h.id).toEqualTypeOf<string>();
    expectTypeOf(h.result).resolves.toEqualTypeOf<boolean | DismissResult>();
  });

  it("OverlayInstance 含 stackIndex / isTopmost / overlapping", () => {
    expectTypeOf<OverlayInstance["stackIndex"]>().toEqualTypeOf<number>();
    expectTypeOf<OverlayInstance["isTopmost"]>().toEqualTypeOf<boolean>();
    expectTypeOf<OverlayInstance["overlapping"]>().toEqualTypeOf<boolean>();
  });

  it("clear 接受选择器与 options；update/get 签名", () => {
    const m = createOverlayManager();
    m.clear((_ctx, recs) => {
      expectTypeOf(recs).toEqualTypeOf<OverlayRecord[]>();
      return recs.map((r) => r.id);
    });
    m.clear({ closeActive: true });
    m.clear();
    m.update("x", { a: 2 });
    expectTypeOf(m.get("x")).toEqualTypeOf<OverlayInstance | undefined>();
  });
});
