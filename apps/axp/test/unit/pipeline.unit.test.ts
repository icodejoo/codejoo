import { AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { AxpContext, mergePatch, requestContext, stateKey } from "../../src/context";
import { AXP_STAGES, composePipeline, sortPipeline } from "../../src/pipeline";
import { axpResponse, type AxpResponse } from "../../src/response";
import type { AxpPlugin, AxpStage } from "../../src/types";
import { testContext } from "../helpers/context";

/** 无状态透传层。 */
const passthrough: NonNullable<AxpPlugin<AxpResponse>["handle"]> = (_ctx, next) => next();
/** 从纯插件对象构造排序记录，不调用客户端。 */
function sort(plugins: AxpPlugin<AxpResponse>[]) {
  return sortPipeline(
    plugins.map(/** 把插件定义包成无实例的注册记录。 */ (plugin) => ({ plugin, instance: {} })),
  );
}

describe("管线与上下文", /** 管线与上下文的用例集合。 */ () => {
  it("[core.fn.composePipeline][core.method.fail] 工厂 fail 损坏时 next 仍 resolve internal，原异常优先", /** 工厂 fail 损坏时 next 仍 resolve internal，原异常优先。 */ async () => {
    const factoryBug = new TypeError("factory");
    const original = new TypeError("middleware");
    const ctx = testContext(
      {},
      {
        ...axpResponse(),
        fail: /** 模拟损坏的响应工厂 fail。 */ () => {
          throw factoryBug;
        },
      },
    );
    expect(ctx.fail({ kind: "auth" })).toMatchObject({ kind: "internal", error: factoryBug });
    const layers = sort([
      {
        name: "observer",
        /** 观察内层 next 返回的必须是 internal。 */ async handle(_ctx, next) {
          const response = await next();
          expect(response.kind).toBe("internal");
          return response;
        },
      },
      {
        name: "broken",
        /** 最内层中间件抛出原始异常。 */ async handle() {
          throw original;
        },
      },
    ]);
    expect(
      (
        await composePipeline(
          layers,
          /** 中间件已抛错，传输不应被执行。 */ async () => {
            throw new Error("unreachable");
          },
        )(ctx)
      ).error,
    ).toBe(original);
  });
  it("[core.fn.sortPipeline] 阶段表从外到内固定为五段", /** 阶段次序由内置位置表的声明顺序派生。 */ () => {
    expect(AXP_STAGES).toEqual(["outer", "prepare", "attempt", "credential", "source"]);
  });
  it("[core.fn.sortPipeline] 五阶段、固定内置顺序及自定义 pre/post 数组次序", /** 五阶段、固定内置顺序及自定义 pre/post 数组次序。 */ () => {
    const builtins = [
      "axp:cache",
      "axp:share",
      "axp:mock",
      "axp:auth",
      "axp:retry",
      "axp:filter",
      "axp:repath",
      "axp:notify",
      "axp:loading",
    ];
    const layers = sort([
      ...builtins.map(
        /** 为每个内置名称造一个自称 source 阶段的插件，验证按名字定位。 */ (
          name,
        ): AxpPlugin<AxpResponse> => ({
          name,
          stage: "source",
          enforce: "pre",
          handle: passthrough,
        }),
      ),
      { name: "first", handle: passthrough },
      { name: "second", enforce: "post", handle: passthrough },
      { name: "pre", enforce: "pre", handle: passthrough },
      { name: "prepare", stage: "prepare", handle: passthrough },
    ]);
    expect(layers.map(/** 取排序后的层名。 */ (layer) => layer.name)).toEqual([
      "axp:loading",
      "axp:notify",
      "axp:repath",
      "axp:filter",
      "prepare",
      "pre",
      "axp:retry",
      "first",
      "second",
      "axp:auth",
      "axp:mock",
      "axp:share",
      "axp:cache",
    ]);
  });
  it("[core.fn.sortPipeline] taps 独立排序命名，setup-only 无层，禁用不进链", /** taps 独立排序命名，setup-only 无层，禁用不进链。 */ () => {
    const layers = sort([
      { name: "audit", taps: [{ stage: "credential" }, { stage: "outer", enforce: "pre" }] },
      { name: "disabled", enable: false, handle: passthrough },
      { name: "setup-only" },
    ]);
    expect(layers.map(/** 取层名与阶段。 */ ({ name, stage }) => ({ name, stage }))).toEqual([
      { name: "audit#1", stage: "outer" },
      { name: "audit#0", stage: "credential" },
    ]);
    expect(/** 重名插件应使校验失败。 */ () => sort([{ name: "same" }, { name: "same" }])).toThrow(
      "Duplicate",
    );
    expect(
      /** 未知阶段应使校验失败。 */ () =>
        sort([{ name: "unknown", stage: "wrong" as AxpStage, handle: passthrough }]),
    ).toThrow("Unknown");
  });
  it("[core.fn.composePipeline] 零插件直达传输，短路无需调用传输", /** 零插件直达传输，短路无需调用传输。 */ async () => {
    const ctx = testContext();
    const response = ctx.fail({ httpStatus: 200, data: 1 });
    expect(await composePipeline([], /** 传输直接返回预置响应。 */ async () => response)(ctx)).toBe(
      response,
    );
    const layers = sort([
      { name: "short", handle: /** 短路中间件不调用 next，直接给出响应。 */ async () => response },
    ]);
    expect(
      await composePipeline(
        layers,
        /** 短路后传输不应被调用。 */ async () => {
          throw new Error("不应发送");
        },
      )(ctx),
    ).toBe(response);
  });
  it("[core.fn.composePipeline][core.req.patch] 重复 next 使用同一基准，状态与逻辑字段共享", /** 重复 next 使用同一基准，状态与逻辑字段共享。 */ async () => {
    const ctx = testContext({ url: "/initial", headers: { original: "yes" } });
    const key = stateKey<number>("count");
    const seen: AxpContext<AxpResponse>[] = [];
    const layers = sort([
      {
        name: "twice",
        /** 同一层连续调用两次 next，验证每次基于同一基准。 */ async handle(context, next) {
          context.set(key, 1);
          await next({ url: "/patched", headers: { added: "yes" } });
          return next();
        },
      },
    ]);
    await composePipeline(
      layers,
      /** 记录最内层看到的上下文与请求视图。 */ async (inner) => {
        expect(inner.get(key)).toBe(1);
        expect(inner.id).toBe(ctx.id);
        expect(inner.signal).toBe(ctx.signal);
        seen.push(inner);
        return inner.fail({ httpStatus: 200 });
      },
    )(ctx);
    expect(seen.map(/** 取内层看到的请求视图。 */ (inner) => inner.request)).toEqual([
      { url: "/patched", headers: { original: "yes", added: "yes" } },
      ctx.request,
    ]);
    // 带补丁派生新的上下文实例；无补丁时直接复用外层实例，请求视图保持同一引用。
    expect(seen[0]).toBeInstanceOf(AxpContext);
    expect(seen[0]).not.toBe(ctx);
    expect(seen[1]).toBe(ctx);
    expect(seen[1]!.request).toBe(ctx.request);
  });
  it.each([false, true])(
    "[core.fn.composePipeline] 同步或异步异常转 internal，外层正常收尾 async=%s",
    /** 同步或异步异常转 internal，外层正常收尾。 */ async (asyncError) => {
      const bug = new TypeError("middleware bug");
      const events: string[] = [];
      const layers = sort([
        {
          name: "outer",
          /** 外层中间件记录进入与最终类别。 */ async handle(_ctx, next) {
            events.push("enter");
            const result = await next();
            events.push(result.kind);
            return result;
          },
        },
        {
          name: "bug",
          handle: /** 按参数同步抛错或返回拒绝的 Promise。 */ () => {
            if (asyncError) return Promise.reject(bug);
            throw bug;
          },
        },
      ]);
      const response = await composePipeline(
        layers,
        /** 传输返回空响应。 */ async (ctx) => ctx.fail({}),
      )(testContext());
      expect(response.error).toBe(bug);
      expect(events).toEqual(["enter", "internal"]);
    },
  );
  it("[core.fn.composePipeline] patch getter 抛错仍由 next 转为 internal", /** patch getter 抛错仍由 next 转为 internal。 */ async () => {
    const bug = new Error("patch");
    const layers = sort([
      {
        name: "patch",
        /** 补丁读取字段时抛错，next 应转为 internal。 */ async handle(_ctx, next) {
          return next({
            /** 模拟补丁字段 getter 抛错。 */ get url(): string {
              throw bug;
            },
          });
        },
      },
    ]);
    expect(
      (
        await composePipeline(
          layers,
          /** 传输返回空响应。 */ async (ctx) => ctx.fail({}),
        )(testContext())
      ).error,
    ).toBe(bug);
  });
  it("[core.fn.composePipeline] taps 请求补丁与响应替换、无回调透传", /** taps 请求补丁与响应替换、无回调透传。 */ async () => {
    const ctx = testContext();
    const layers = sort([
      {
        name: "taps",
        taps: [
          {
            stage: "outer",
            onRequest: /** 请求侧返回补丁，改写 url。 */ () => ({ url: "/tap" }),
            onResponse: /** 响应侧用新响应替换内层结果。 */ (_r, context) =>
              context.fail({ httpStatus: 200, data: "replaced" }),
          },
          { stage: "source", onResponse: /** 响应侧不返回值时保留内层响应。 */ () => undefined },
          { stage: "source" },
          {
            stage: "credential",
            onRequest: /** 只有请求侧且返回空值，不产生补丁。 */ () => undefined,
          },
          {
            stage: "prepare",
            onRequest: /** 双向 tap 的请求侧返回空值。 */ () => {},
            onResponse: /** 双向 tap 的响应侧返回空值。 */ () => {},
          },
          { stage: "attempt", onRequest: /** 只有请求侧，返回超时补丁。 */ () => ({ timeout: 5 }) },
        ],
      },
    ]);
    const response = await composePipeline(
      layers,
      /** 校验各 tap 的补丁已叠加后返回成功响应。 */ async (inner) => {
        expect(inner.request.url).toBe("/tap");
        expect(inner.request.timeout).toBe(5);
        return inner.fail({ httpStatus: 200 });
      },
    )(ctx);
    expect(response.data).toBe("replaced");
    expect(
      sortPipeline([
        {
          plugin: { name: "instance", handle: passthrough, taps: [] },
          instance: { handle: passthrough, taps: [] },
        },
      ]),
    ).toHaveLength(1);
  });
  it("[core.fn.mergePatch] 浅合并、删除字段、头多一层且不改输入", /** 浅合并、删除字段、头多一层且不改输入。 */ () => {
    const original = {
      url: "/old",
      params: { a: 1 },
      timeout: 10,
      headers: { Keep: "yes", Delete: "old", Replace: "old" },
    };
    const patch = {
      url: "/new",
      params: { b: 2 },
      timeout: undefined,
      headers: { Delete: undefined, replace: "new" },
    };
    const merged = mergePatch(original, patch);
    expect(merged).toEqual({
      url: "/new",
      params: { b: 2 },
      headers: { Keep: "yes", replace: "new" },
    });
    expect(original.headers.Delete).toBe("old");
    expect(mergePatch(original, { headers: undefined }).headers).toBeUndefined();
    expect(
      mergePatch(
        { headers: new AxiosHeaders({ A: "1" }) },
        { headers: new AxiosHeaders({ B: "2" }) },
      ).headers,
    ).toEqual({ A: "1", B: "2" });
    expect(mergePatch({}, { headers: { A: "1" } }).headers).toEqual({ A: "1" });
    const before = new AxiosHeaders({ Delete: "old", Keep: "yes" });
    const patchHeaders = new AxiosHeaders({ Disable: false });
    patchHeaders.set("delete", undefined);
    expect(mergePatch({ headers: before }, { headers: patchHeaders }).headers).toEqual({
      Keep: "yes",
      Disable: false,
    });
    expect(before.get("Delete")).toBe("old");
  });
  it("[core.fn.stateKey][core.method.key] 同描述键不冲突，指纹按请求对象缓存包括 null", /** 同描述键不冲突，指纹按请求对象缓存包括 null。 */ () => {
    const ctx = testContext({ url: "/key", params: { id: 1 } });
    const first = stateKey<number>("same");
    const second = stateKey<string>("same");
    ctx.set(first, 1);
    ctx.set(second, "two");
    expect(ctx.get(first)).toBe(1);
    expect(ctx.get(second)).toBe("two");
    expect(ctx.get(stateKey("missing"))).toBeUndefined();
    expect(ctx.key()).toBe(ctx.key());
    const inner = requestContext(ctx, mergePatch(ctx.request, { params: { id: 2 } }));
    expect(inner.key()).not.toBe(ctx.key());
    const disabled = requestContext(ctx, { key: false });
    expect(disabled.key()).toBeNull();
    expect(disabled.key()).toBeNull();
    inner.markReplayable();
    expect(ctx.replayable).toBe(true);
  });
});
