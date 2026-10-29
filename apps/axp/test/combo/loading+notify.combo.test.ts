import { beforeEach, expect, it, vi } from "vitest";
import axpLoading from "../../src/plugins/loading";
import axpNotify from "../../src/plugins/notify";
import type { AxpPlugin } from "../../src/types";
import type { AxpResponse } from "../../src/response";
import { loadingRecorder, notifyRecorder, uiClient } from "../helpers/ui";
import { customResponse, type TestResponse } from "../helpers/client";

/** 默认回调的事件标签。 */
const LOADING_LABEL = "main";
/** 缺少业务消息时的默认提示。 */
const FAILURE_MESSAGE = "status 500";
/** 内置显示插件名。 */
const LOADING_NAME = "axp:loading";
/** 逻辑请求外层阶段。 */
const OUTER_STAGE = "outer";
/** 内置通知插件名。 */
const NOTIFY_NAME = "axp:notify";
/** 结果来源阶段。 */
const SOURCE_STAGE = "source";
/** 贯穿各层的追踪字段。 */
const TRACE_ID = "trace";

/** 组合时序统一使用假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 内层最终失败消息。 */
const FINAL_MESSAGE = "final failure";

it("[loading.cb.loading][notify.cb.notify] 任意注册顺序仍是一对显示隐藏和一次最终通知", /** 内置 outer 排序。 */ async () => {
  const h = uiClient();
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpNotify<AxpResponse>({ notify }));
  h.api.use(axpLoading({ loading: loadingRecorder(h.events) }));
  h.net.fallback(/** 最终 HTTP 失败。 */ () => ({ status: 500 }));
  const pending = h.send();
  await vi.runAllTimersAsync();
  const result = await pending;
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
  expect(notify).toHaveBeenCalledExactlyOnceWith(FAILURE_MESSAGE, result);
  expect(h.api.inspect()).toEqual([
    { name: LOADING_NAME, stage: OUTER_STAGE },
    { name: NOTIFY_NAME, stage: OUTER_STAGE },
  ]);
});
it("[loading.cb.loading][notify.cb.stringify][notify.combo.taps] taps 的 outer 段和 notify 看到最终 R，inspect 顺序固定", /** 跨阶段 tap 与响应身份。 */ async () => {
  const h = uiClient<TestResponse>([], { response: customResponse() });
  const results: unknown[] = [];
  const notify = vi.fn(notifyRecorder(h.events));
  const taps: AxpPlugin<TestResponse> = {
    name: "audit",
    taps: [
      {
        stage: SOURCE_STAGE,
        onResponse: /** 派生最终消息，由工厂保留扩展字段。 */ (r, ctx) => ctx.fail({ from: r, message: FINAL_MESSAGE }),
      },
      {
        stage: OUTER_STAGE,
        onResponse: /** 记录最终响应。 */ (r) => {
          results.push(r);
        },
      },
    ],
  };
  h.api.use(taps);
  h.api.use(axpNotify<TestResponse>({ notify }));
  h.api.use(axpLoading({ loading: loadingRecorder(h.events) }));
  h.net.fallback(/** 追踪字段来自假网络响应头。 */ () => ({ status: 500, headers: { "x-trace-id": TRACE_ID } }));
  const pending = h.send();
  await vi.runAllTimersAsync();
  const response = await pending;
  expect(response).toMatchObject({ message: FINAL_MESSAGE, traceId: TRACE_ID });
  expect(results).toEqual([response]);
  expect(notify).toHaveBeenCalledExactlyOnceWith(FINAL_MESSAGE, response);
  expect(h.api.inspect()).toEqual([
    { stage: OUTER_STAGE, name: LOADING_NAME },
    { stage: OUTER_STAGE, name: NOTIFY_NAME },
    { stage: OUTER_STAGE, name: "audit#1" },
    { stage: SOURCE_STAGE, name: "audit#0" },
  ]);
});
it("[loading.method.snapshot] 等待 outer pre 时卸载 loading，旧快照继续但不启动新 UI", /** 已卸载状态不得复活。 */ async () => {
  let release!: () => void;
  const gate = new Promise<void>(
    /** 保存外层放行函数。 */ (resolve) => {
      release = resolve;
    },
  );
  const h = uiClient();
  h.api.use({
    name: "gate",
    stage: OUTER_STAGE,
    enforce: "pre",
    /** 模拟逻辑请求入口等待。 */ async handle(_ctx, next) {
      await gate;
      return next();
    },
  });
  h.api.use(axpLoading({ loading: loadingRecorder(h.events) }));
  const pending = h.send();
  h.api.eject(LOADING_NAME);
  release();
  await vi.runAllTimersAsync();
  await pending;
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([]);
});

it("[core.req.throws][loading.cb.finally] 正常抛出最终失败 R 前，通知一次且 loading 已关闭", /** 落定失败不会重跑 outer。 */ async () => {
  const h = uiClient();
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpLoading({ loading: loadingRecorder(h.events) }));
  h.api.use(axpNotify<AxpResponse>({ notify }));
  h.net.fallback(/** 最终失败。 */ () => ({ status: 500 }));
  const pending = h.send({ throws: true }).catch(/** 捕获内核直接抛出的 R。 */ (response: unknown) => response);
  await vi.runAllTimersAsync();
  const response = await pending;
  expect(response).toMatchObject({ ok: false, status: 500 });
  expect(notify).toHaveBeenCalledExactlyOnceWith(FAILURE_MESSAGE, response);
  expect(h.events.loading.get(LOADING_LABEL)).toEqual([true, false]);
});
