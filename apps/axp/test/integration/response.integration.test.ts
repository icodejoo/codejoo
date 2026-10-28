import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import { axpResponse } from "../../src/response";
import { createTestClient, TestResponse } from "../helpers/client";

it("[core.method.toJSON] 真实 HTTP 响应排除传输循环引用并保留判定和扩展字段", /** 验证 Node HTTP adapter 的序列化。 */ async () => {
  const server = createServer(
    /** 返回业务信封。 */ (_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ code: 0, message: "done", data: { value: 1 } }));
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing TCP address");
    const url = `http://127.0.0.1:${address.port}/response`;
    const { api } = createTestClient<TestResponse>(
      [],
      {
        response: axpResponse<TestResponse>({
          /** 补充可序列化的诊断与扩展字段。 */
          create: (init) =>
            Object.assign(new TestResponse({ ...init, reason: "test", stack: "callsite" }), {
              traceId: "trace",
            }),
        }),
      },
      { adapter: "http", proxy: false },
    );
    const response = await api.get(url)(undefined, { wrap: true });
    expect(response.raw?.request).toBeDefined();
    expect(/** 尝试直接序列化原始循环引用。 */ () => JSON.stringify(response.raw?.request)).toThrow();
    const text = JSON.stringify(response);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      kind: "ok",
      status: 200,
      httpStatus: 200,
      code: 0,
      message: "done",
      data: { value: 1 },
      reason: "test",
      stack: "callsite",
      request: { method: "get", url },
      traceId: "trace",
    });
    expect(response.toJSON()).not.toHaveProperty("raw");
    expect(response.toJSON()).not.toHaveProperty("error");
  } finally {
    await new Promise<void>(
      /** 完成后关闭本地服务。 */ (resolve, reject) =>
        server.close(
          /** 转发关闭结果。 */ (error) => {
            if (error) reject(error);
            else resolve();
          },
        ),
    );
  }
});
