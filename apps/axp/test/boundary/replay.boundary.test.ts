import { expect, it } from "vitest";
import { createTestClient } from "../helpers/client";

it("[core.method.markReplayable][core.req.patch] 重复发送体一致，transformRequest 不污染调用方和基准请求", /** 重复发送体一致，transformRequest 不污染调用方和基准请求。 */ async () => {
  const payload = { items: [1], nested: { value: "initial" } };
  const observed: unknown[] = [];
  const { api, net } = createTestClient([
    {
      name: "replay",
      /** 标记可重放后连续调用两次 next。 */ async handle(ctx, next) {
        ctx.markReplayable();
        await next({ headers: { attempt: "first" } });
        return next();
      },
    },
  ]);
  api.axios.defaults.transformRequest = /** 在序列化前改写请求体，验证基准体不被污染。 */ (
    data,
  ) => {
    data.items.push(2);
    data.nested.value = "transformed";
    observed.push(JSON.parse(JSON.stringify(data)));
    return JSON.stringify(data);
  };
  const result = await api.post("/echo")(payload);
  expect(observed).toEqual([observed[0], observed[0]]);
  expect(JSON.parse(result as string)).toEqual({ items: [1, 2], nested: { value: "transformed" } });
  expect(payload).toEqual({ items: [1], nested: { value: "initial" } });
  expect(net.calls("post", "/echo")).toBe(2);
  expect(api.pending()).toBe(0);
});
