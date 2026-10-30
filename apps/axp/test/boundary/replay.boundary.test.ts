import { expect, it, vi } from "vitest";
import { createTestClient } from "../helpers/client";

it("[core.method.markReplayable][core.req.patch] 重复发送使用原引用，原地 transformRequest 会污染调用方和重放", /** 重复发送使用原引用，原地 transformRequest 会污染调用方和重放。 */ async () => {
  const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const payload = { items: [{ n: 0 }], nested: { value: "initial" } };
  const observed: unknown[] = [];
  const { api, net } = createTestClient(
    [
      {
        name: "replay",
        /** 标记可重放后连续调用两次 next。 */ async handle(ctx, next) {
          ctx.markReplayable();
          await next({ headers: { attempt: "first" } });
          return next();
        },
      },
    ],
    { debug: log },
  );
  api.axios.defaults.transformRequest = /** 在序列化前改写请求体，验证嵌套数组修改会累积。 */ (data) => {
    data.items[0].n++;
    data.nested.value = "transformed";
    observed.push(JSON.parse(JSON.stringify(data)));
    return JSON.stringify(data);
  };
  const result = await api.post("/echo")(payload);
  expect(observed).toEqual([
    { items: [{ n: 1 }], nested: { value: "transformed" } },
    { items: [{ n: 2 }], nested: { value: "transformed" } },
  ]);
  expect(JSON.parse(result as string)).toEqual({ items: [{ n: 2 }], nested: { value: "transformed" } });
  expect(payload).toEqual({ items: [{ n: 2 }], nested: { value: "initial" } });
  expect(net.calls("post", "/echo")).toBe(2);
  expect(api.pending()).toBe(0);
  expect(log.warn).toHaveBeenCalledTimes(1);
  expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("发送中请求体被原地修改"));
});

it("[core.method.markReplayable] 返回新对象的转换器保持每次发送一致和调用方不变", /** 重放无需克隆也能安全使用纯转换器。 */ async () => {
  const payload = { items: [1] };
  const { api, net } = createTestClient([
    {
      name: "replay",
      /** 保留真实重放路径。 */ async handle(ctx, next) {
        ctx.markReplayable();
        await next();
        return next();
      },
    },
  ]);
  const bodies: unknown[] = [];
  net.on(
    "post",
    "/echo",
    /** 记录每次发送。 */ (config) => {
      bodies.push(config.data);
      return {};
    },
  );
  await api.post("/echo")(payload, { transformRequest: [/** 返回新数组和新对象。 */ (data) => JSON.stringify({ ...data, items: [...data.items, 2] })] });
  expect(bodies).toEqual(['{"items":[1,2]}', '{"items":[1,2]}']);
  expect(payload).toEqual({ items: [1] });
  expect(net.totalStarted).toBe(2);
});
