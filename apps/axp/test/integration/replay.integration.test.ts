import { once } from "node:events";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { expect, it, onTestFinished, vi } from "vitest";
import axpAuth, { AuthFailureAction } from "../../src/plugins/auth";
import axpMock from "../../src/plugins/mock";
import axpRetry from "../../src/plugins/retry";
import type { AxpPlugin } from "../../src/types";
import { memoryTokens } from "../helpers/b3";
import { createTestClient } from "../helpers/client";

/** 每次发送使用的非空流内容。 */
const PAYLOAD = "payload";
/** 真实接口路径。 */
const REAL_PATH = "/real";
/** mock 服务前缀。 */
const MOCK_PATH = "/mock";

/** 启动真实 HTTP 服务，首发失败、再次发送则成功，并记录收到的请求体。 */
async function replayServer(status: number) {
  const received: { /** 实际 URL。 */ url: string | undefined; /** 实际收到的请求体。 */ body: string }[] = [];
  const server = createServer(
    /** 按真实流结束事件收集请求体。 */ (request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on(
        "data",
        /** 累加已解码的流片段。 */ (chunk: string) => {
          body += chunk;
        },
      );
      request.on(
        "end",
        /** 首发失败，第二次原本会成功，便于识别空体误重放。 */ () => {
          received.push({ url: request.url, body });
          response.statusCode = received.length === 1 ? status : 200;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ code: 0, data: body }));
        },
      );
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(
    /** 不依赖 keep-alive 超时，立即关闭所有连接与监听。 */ async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing TCP address");
  return { origin: `http://127.0.0.1:${address.port}`, received };
}

it("[core.method.canReplay][retry.opt.methods] 真实 HTTP adapter 的 Readable 请求体不重试为空体，调用方收到原 503", /** 不可重放时保留首发失败。 */ async () => {
  const h = await replayServer(503);
  const { api } = createTestClient([axpRetry({ max: 1, delay: 0 })], {}, { adapter: "http", proxy: false });
  onTestFinished(/** 回收本例客户端。 */ () => api.dispose());
  let original: unknown;
  api.use({
    name: "observe-original",
    stage: "source",
    /** 保存真正首发响应。 */ async handle(_ctx, next) {
      const response = await next();
      original = response;
      return response;
    },
  });
  const failure = await api
    .put(h.origin + REAL_PATH)(Readable.from([PAYLOAD]))
    .catch(/** 保留原失败响应身份。 */ (error: unknown) => error);
  expect(failure).toBe(original);
  expect(original).toMatchObject({ ok: false, status: 503 });
  expect(h.received).toEqual([{ url: REAL_PATH, body: PAYLOAD }]);
});

it.each([AuthFailureAction.Refresh, AuthFailureAction.Replay])(
  "[core.method.canReplay][auth.cb.onRefresh] 一次性请求体不能 %s 时返回原 401，且不发起刷新",
  /** 刷新和直接重放均应保留已有响应。 */ async (action) => {
    const h = await replayServer(401);
    const onRefresh = vi.fn();
    const { api } = createTestClient([axpAuth({ tokenManager: memoryTokens(), onRefresh, onAccessExpired: vi.fn(), onFailure: /** 指定待验证的恢复动作。 */ () => action })], {}, { adapter: "http", proxy: false });
    onTestFinished(/** 回收本例客户端。 */ () => api.dispose());
    const response = await api.put(h.origin + REAL_PATH)(Readable.from([PAYLOAD]), { throws: false });
    expect(response).toMatchObject({ ok: false, status: 401 });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(h.received).toEqual([{ url: REAL_PATH, body: PAYLOAD }]);
  },
);

it("[core.method.canReplay][mock.opt.fallbackWhen] 一次性请求体探测后不能回落，返回原探测响应", /** 真实接口不再收到空体。 */ async () => {
  const h = await replayServer(404);
  const { api } = createTestClient([axpMock({ enable: true, mock: true, mockUrl: h.origin + MOCK_PATH })], {}, { adapter: "http", proxy: false });
  onTestFinished(/** 回收本例客户端。 */ () => api.dispose());
  const response = await api.put(h.origin + REAL_PATH)(Readable.from([PAYLOAD]), { throws: false });
  expect(response).toMatchObject({ ok: false, status: 404 });
  expect(h.received).toEqual([{ url: MOCK_PATH + REAL_PATH, body: PAYLOAD }]);
});

it("[core.method.canReplay][core.fn.createTransport] 自定义插件直接重放已发送流时抛原始 Error，throws=false 也不吞", /** 内核兜底不能伪装成成功或普通 HTTP 失败。 */ async () => {
  const h = await replayServer(503);
  let original: unknown;
  const replay: AxpPlugin = {
    name: "unchecked-replay",
    /** 故意不检查 canReplay，验证传输层兜底。 */ async handle(_ctx, next) {
      await next();
      const response = await next();
      original = response.error;
      return response;
    },
  };
  const { api } = createTestClient([replay], {}, { adapter: "http", proxy: false });
  onTestFinished(/** 回收本例客户端。 */ () => api.dispose());
  const failure = await api
    .put(h.origin + REAL_PATH)(Readable.from([PAYLOAD]), { throws: false })
    .catch(/** 保留落定时抛出的原始对象。 */ (error: unknown) => error);
  expect(failure).toBe(original);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe("一次性请求体已发送，不能重放；重放前请先检查 ctx.canReplay()");
  expect(h.received).toEqual([{ url: REAL_PATH, body: PAYLOAD }]);
});
