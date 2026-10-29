import { AxiosHeaders, type AxiosResponse } from "axios";
import { expect, it, vi } from "vitest";
import { AxpResponse, axpResponse, DEFAULT_RESPONSE_FACTORY, failureOf, guardFactory } from "../../src/response";
import { testContext } from "../helpers/context";

/** 响应工厂的原始输入。 */
const RAW: AxiosResponse = { status: 200, statusText: "OK", data: { value: 7 }, headers: { trace: "header" }, config: { headers: new AxiosHeaders() } };

it("[core.opt.response] 默认工厂的解析异常仍由内核保护，快路径只用于合成与缓存重建", /** 原始响应体访问器抛错时保留 internal 事实。 */ () => {
  const bug = new TypeError("response body getter");
  const raw = {
    ...RAW,
    /** 模拟传输给出的异常访问器。 */ get data(): unknown {
      throw bug;
    },
  };
  const response = guardFactory(DEFAULT_RESPONSE_FACTORY).fromResponse(raw, testContext());
  expect(response.ok).toBe(false);
  expect(failureOf(response)?.error).toBe(bug);
  expect(failureOf(response)?.type).toBe("internal");
});

it("[core.method.parse][core.cb.create] 关闭 JSON 守卫时仅解析钩子读取响应体一次，接口工厂自行决定读取", /** 内核不重复消费使用者的响应体访问器。 */ () => {
  const read = vi.fn(/** 提供只在消费时计数的原始数据。 */ () => RAW.data);
  const raw = {
    ...RAW,
    /** 观察响应体读取次数。 */ get data() {
      return read();
    },
  };
  expect(axpResponse().fromResponse(raw, testContext()).data).toBe(RAW.data);
  expect(read).toHaveBeenCalledTimes(1);
  read.mockClear();
  const factory = axpResponse({ create: /** 接口实现不需要响应体。 */ () => new AxpResponse({ status: RAW.status }) });
  expect(factory.fromResponse(raw, testContext()).ok).toBe(true);
  expect(read).not.toHaveBeenCalled();
});

it("[core.method.parse][core.opt.type] parse 可覆盖并接收 raw，派生与显式字段不重新解析", /** 基类负责赋值，子类钩子只返回结果。 */ () => {
  const parse = vi.fn(/** 定制数据与消息。 */ (body: unknown, raw: AxiosResponse) => ({ code: "0000", data: body, message: String(raw.headers.trace) }));
  /** 字符串业务码的响应子类。 */
  class Parsed extends AxpResponse<unknown, string> {
    /** 只返回解析结果。 */
    protected override parse(body: unknown, raw: AxiosResponse) {
      return parse(body, raw);
    }
  }
  const factory = axpResponse<Parsed>({ type: Parsed });
  const ctx = testContext() as never;
  const received = factory.fromResponse(RAW, ctx);
  expect(received).toBeInstanceOf(Parsed);
  expect(received).toMatchObject({ code: "0000", data: RAW.data, message: "header", status: 200, ok: true });
  expect(parse).toHaveBeenCalledExactlyOnceWith(RAW.data, RAW);
  expect(factory.fail({ from: received }, ctx).data).toBe(RAW.data);
  for (const fields of [{ code: "0000" }, { data: 8 }, { message: null }]) {
    const response = factory.fail({ raw: RAW, ...fields }, ctx);
    expect(response.status).toBe(RAW.status);
  }
  expect(parse).toHaveBeenCalledTimes(1);
  expect(new Parsed({ raw: RAW, message: null }).message).toBeNull();
});

it("[core.method.parse][core.opt.type] parse 缺省字段由基类补齐，构造请求与上下文回落一致", /** 空钩子结果也满足默认字段契约。 */ () => {
  /** 只识别传输状态的子类。 */
  class Empty extends AxpResponse {
    /** 模拟业务转换不提供任何字段。 */
    protected override parse() {
      return {};
    }
  }
  const request = { url: "/caller" };
  const factory = axpResponse<Empty>({ type: Empty });
  const response = factory.fail({ raw: RAW }, testContext(request) as never);
  expect(response).toMatchObject({ code: 0, data: null, message: "", request, ok: true });
  expect(factory.fail({ request }, testContext() as never).request).toEqual({ method: undefined, url: request.url });
});

it("[core.method.parse] 自定义 parse 承接信封字段映射与保留完整响应体的扩展方式", /** 删除 envelope 选项后仍可通过继承表达旧定制行为。 */ () => {
  /** 使用不同字段名的业务协议。 */
  class Mapped extends AxpResponse<number, string> {
    /** 由子类约定字段映射。 */
    protected override parse(body: unknown) {
      const fields = body as { /** 业务码。 */ c: string; /** 数据。 */ d: number; /** 消息。 */ m: string };
      return { code: fields.c, data: fields.d, message: fields.m };
    }
  }
  /** 保留完整响应体的协议。 */
  class Body extends AxpResponse {
    /** 不解包任何信封。 */
    protected override parse(body: unknown) {
      return { data: body };
    }
  }
  const raw = { ...RAW, data: { c: "0000", d: 1, m: "done" } };
  expect(axpResponse<Mapped>({ type: Mapped }).fromResponse(raw, testContext() as never)).toMatchObject({ code: "0000", data: 1, message: "done", ok: true });
  const envelope = { code: 500, data: null };
  expect(axpResponse<Body>({ type: Body }).fromResponse({ ...RAW, data: envelope }, testContext() as never).data).toBe(envelope);
});

it("[core.method.fail] create 与完整工厂派生失败默认继承标记，并可覆盖原因和失败类型", /** 派生继承由内核保证。 */ () => {
  const factory = axpResponse({ create: /** 返回全新的默认对象。 */ (init) => new AxpResponse(init) });
  const ctx = testContext();
  const original = factory.fail({ failure: "network" }, ctx);
  const derived = factory.fail({ from: original, reason: "offline" }, ctx);
  expect(failureOf(derived)).toEqual({ type: "network", reason: "offline" });
  expect(failureOf(factory.fail({ from: original }, ctx))).toEqual({ type: "network", reason: undefined });
  const guarded = guardFactory({ ...factory, fail: /** 完整工厂刻意丢弃失败信息。 */ () => new AxpResponse({ status: 200 }) });
  expect(guarded.fail({ from: original }, ctx).ok).toBe(false);
  expect(failureOf(guarded.fail({ from: derived }, ctx))).toEqual({ type: "network", reason: "offline" });
  expect(failureOf(guarded.fail({ from: original, failure: "auth", reason: "expired" }, ctx))).toEqual({ type: "auth", reason: "expired" });
  expect(failureOf(original)?.reason).toBeUndefined();
  const bug = new Error("inherited internal");
  const internal = factory.fail({ failure: "internal", error: bug }, ctx);
  expect(failureOf(factory.fail({ from: internal }, ctx))?.error).toBe(bug);
  expect(failureOf(guarded.fail({ from: internal }, ctx))?.error).toBe(bug);
  expect(failureOf(factory.fail({ failure: "internal" }, ctx))?.error).toBeUndefined();
});
