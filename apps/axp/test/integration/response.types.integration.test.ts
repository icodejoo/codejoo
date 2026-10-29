import { expect, expectTypeOf, it } from "vitest";
import { createAxp } from "../../src/client";
import type { AxpContext } from "../../src/context";
import { AxpResponse, axpResponse, type AxpResponseInit, type IAxpResponse } from "../../src/response";

it("[core.type.IAxpResponse][core.type.AxpResponseInit] 精简接口、业务码泛型和扩展数据字段", /** 只执行类型契约函数的声明检查。 */ () => {
  /** 编译期验证，不发送网络。 */
  function contracts() {
    const minimal: IAxpResponse<null, string> = { ok: false, status: 0, code: "OFFLINE", data: null };
    expectTypeOf(minimal.code).toEqualTypeOf<string>();
    expectTypeOf<IAxpResponse["code"]>().toEqualTypeOf<number>();
    expectTypeOf<keyof IAxpResponse>().toEqualTypeOf<"ok" | "status" | "code" | "data" | "message" | "raw" | "error">();
    /** 响应上的扩展数据与函数。 */
    class Extended extends AxpResponse<unknown, string | number> {
      /** 扩展追踪字段。 */ traceId = "";
      /** 可选额外数据。 */ count?: number;
      /** 函数字段不是初始化数据。 */ callback = () => 1;
      /** 可选函数同样不是初始化数据。 */ optionalCallback?: () => void;
    }
    const init: AxpResponseInit<Extended> = { traceId: "trace", count: 1, failure: "auth", reason: "expired" };
    expectTypeOf(init.traceId).toEqualTypeOf<string | undefined>();
    const factory = axpResponse<Extended>({ type: Extended });
    createAxp<unknown, Extended>({ response: factory });
    const ctx = {} as AxpContext<Extended>;
    ctx.fail({ traceId: "trace" });
    // @ts-expect-error 基础字段重载不会放宽已知扩展字段的值类型。
    ctx.fail({ traceId: 1 });
    /** 泛型插件只提供基础字段时不需要断言。 */
    function generic<R extends IAxpResponse<unknown, string | number>>(context: AxpContext<R>) {
      return context.fail({ failure: "auth", reason: "expired" });
    }
    void generic;
    axpResponse<IAxpResponse<null, string>>({ create: () => minimal });
    // @ts-expect-error 自定义 R 必须提供 type 或 create。
    axpResponse<Extended>({ expectJson: true });
    // @ts-expect-error 业务码泛型只能是数字或字符串。
    type Invalid = IAxpResponse<null, boolean>;
    // @ts-expect-error failure 只能是内核规定的六种。
    const invalidFailure: AxpResponseInit<Extended> = { failure: "http" };
    // @ts-expect-error 扩展字段保留值类型约束。
    const invalidExtra: AxpResponseInit<Extended> = { traceId: 1 };
    // @ts-expect-error 方法不能用作扩展初始化数据。
    const invalidMethod: AxpResponseInit<Extended> = { callback: () => 2 };
    // @ts-expect-error 可选函数也不能用作扩展初始化数据。
    const invalidOptionalMethod: AxpResponseInit<Extended> = { optionalCallback: () => undefined };
    // @ts-expect-error 工厂已删除 envelope 配置。
    axpResponse({ envelope: false });
    void ({} as Invalid);
    void invalidFailure;
    void invalidExtra;
    void invalidMethod;
    void invalidOptionalMethod;
  }
  expect(contracts).toBeTypeOf("function");
});
