import { beforeEach, expect, it, vi } from "vitest";
import axpNotify from "../../src/plugins/notify";
import type { AxpResponse } from "../../src/response";
import axpShare from "../../src/plugins/share";
import { sourceClient } from "../helpers/source";
import { assertInvariants, recordEvents } from "../helpers/client";
import { notifyRecorder, legacyStringify } from "../helpers/ui";

/** 并发共享通知的固定地址。 */
const URL = "/notice-share";
/** 等待共享订阅完成的网络延迟。 */
const LATENCY = 10;

beforeEach(/** 通知计数通过假时钟推进。 */ () => vi.useFakeTimers());

it("[notify.cb.notify][share.req.share] 同一响应身份的通知按各自逻辑信号计数", /** 跟随者和领导者共享 R，但通知次数互不混淆。 */ async () => {
  const h = sourceClient([axpShare()]);
  const notify = vi.fn(notifyRecorder(h.events));
  h.api.use(axpNotify({ notify, stringify: legacyStringify }));
  h.net.on("get", URL, /** 最终失败让双方各收到通知。 */ () => ({ status: 503 }));
  const config = { url: URL, share: true, latency: LATENCY };
  const first = h.send(config);
  const follower = h.send(config);
  await vi.runAllTimersAsync();
  expect(await follower).toBe(await first);
  expect(notify).toHaveBeenCalledTimes(2);
  expect([...h.events.notify.values()]).toEqual([1, 1]);
  expect(h.net.totalStarted).toBe(1);
});

it("[notify.cb.notify] 迁移后的记录器仍能识别同一逻辑请求的重复通知", /** 用独立事件容器检查故障，夹具自身仍正常回收。 */ async () => {
  const events = recordEvents();
  const record = notifyRecorder(events);
  const h = sourceClient();
  h.api.use(
    axpNotify<AxpResponse>({
      stringify: legacyStringify,
      /** 模拟通知实现对同一请求重复记账。 */
      notify(message, response) {
        record(message, response);
        record(message, response);
      },
    }),
  );
  h.net.on("get", URL, /** 产生一次正常失败通知。 */ () => ({ status: 503 }));
  const pending = h.send({ url: URL });
  await vi.runAllTimersAsync();
  await pending;
  expect(/** I4 必须继续拒绝重复通知。 */ () => assertInvariants(h.api, events)).toThrow();
});
