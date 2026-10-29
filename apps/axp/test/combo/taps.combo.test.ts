import { AxiosHeaders } from "axios";
import { beforeEach, expect, it, vi } from "vitest";
import axpCache from "../../src/plugins/cache";
import axpFilter from "../../src/plugins/filter";
import axpLoading from "../../src/plugins/loading";
import axpMock from "../../src/plugins/mock";
import axpNotify from "../../src/plugins/notify";
import axpRepath from "../../src/plugins/repath";
import axpRetry from "../../src/plugins/retry";
import axpShare from "../../src/plugins/share";
import type { AxpResponse } from "../../src/response";
import type { AxpPlugin, AxpRequestConfig, AxpStage } from "../../src/types";
import { authClient, failure, guarded, TOKEN_NEW, TOKEN_OLD } from "../helpers/b3";
import { settleAll } from "../helpers/source";

/** 带路径变量的接口，repath 把 `{id}` 换成 params 里的值。 */
const TEMPLATE_URL = "/users/{id}/orders";
/** repath 替换之后实际发出的地址。 */
const RESOLVED_URL = "/users/7/orders";
/** 请求参数：id 被 repath 消费，空串 q 被 filter 剥离，只剩 page。 */
const PARAMS = { id: 7, q: "", page: 2 };
/** 经过 repath 与 filter 之后的查询参数。 */
const SHAPED_PARAMS = { page: 2 };
/** 内置插件名。 */
const NAME = {
  loading: "axp:loading",
  notify: "axp:notify",
  repath: "axp:repath",
  filter: "axp:filter",
  retry: "axp:retry",
  auth: "axp:auth",
  mock: "axp:mock",
  share: "axp:share",
  cache: "axp:cache",
} as const;
/** 自定义插件名；taps 的各段按 `<name>#<序号>` 参与排序。 */
const AUDIT = "audit";
/** 缺少业务消息时的默认提示。 */
const FAILURE_MESSAGE = "status 500";
/** 测试夹具自带的观测插件名，不属于被测装配。 */
const OBSERVER = "b3-observe";
/** 每个组合用例使用独立假时钟。 */
beforeEach(() => {
  vi.useFakeTimers();
});

/** 读取请求头里的 Authorization。 */
function tokenOf(request: Readonly<AxpRequestConfig>): unknown {
  return AxiosHeaders.from(request.headers as never).get("Authorization") ?? undefined;
}
/** 一个 tap 看到的请求形态。 */
interface IRequestView {
  /** 地址。 */ url: string | undefined;
  /** 查询参数。 */ params: unknown;
  /** 本层看到的凭证。 */ token: unknown;
}
/** 截取请求视图，避免后续补丁影响已记录的值。 */
function viewOf(request: Readonly<AxpRequestConfig>): IRequestView {
  return { url: request.url, params: request.params, token: tokenOf(request) };
}

/** 装好全部九个内置插件和一个跨阶段的 taps 插件，记录各 tap 看到的请求与最终响应。
 * @param notify 通知回调，默认忽略。
 */
function client(notify: (message: string, response: AxpResponse) => unknown = () => undefined) {
  const seen = {
    /** outer 段 onRequest 的进入次数。 */ outerRequests: 0,
    /** outer 段 onResponse 看到的响应。 */ outerResponses: [] as AxpResponse[],
    /** prepare 前置 tap 看到的请求，在 repath 与 filter 之前。 */ prepareBefore: [] as IRequestView[],
    /** prepare 后置 tap 看到的请求，在 repath 与 filter 之后。 */ prepareAfter: [] as IRequestView[],
    /** credential 前置 tap 看到的请求，在 auth 注入之前。 */ credentialBefore: [] as IRequestView[],
    /** credential 后置 tap 看到的请求，在 auth 注入之后。 */ credentialAfter: [] as IRequestView[],
  };
  const audit: AxpPlugin<AxpResponse> = {
    name: AUDIT,
    taps: [
      {
        stage: "outer",
        /** 后置：排在 loading、notify 之后，看到收敛后的最终响应。 */
        onResponse(r) {
          seen.outerResponses.push(r);
        },
      },
      {
        stage: "outer",
        enforce: "pre",
        /** 前置：每个逻辑请求只进入一次。 */
        onRequest() {
          seen.outerRequests++;
        },
      },
      {
        stage: "prepare",
        enforce: "pre",
        /** 前置：记录整形前的请求，并补上要被 repath 消费的路径变量与要被 filter 剥离的空字段。 */
        onRequest(ctx) {
          seen.prepareBefore.push(viewOf(ctx.request));
          return { params: { ...(ctx.request.params as object), tail: "" } };
        },
      },
      {
        stage: "prepare",
        /** 后置：记录整形后的请求。 */
        onRequest(ctx) {
          seen.prepareAfter.push(viewOf(ctx.request));
        },
      },
      {
        stage: "credential",
        enforce: "pre",
        /** 前置：每次尝试进入一次，还没有凭证。 */
        onRequest(ctx) {
          seen.credentialBefore.push(viewOf(ctx.request));
        },
      },
      {
        stage: "credential",
        /** 后置：每次进入内层（含鉴权重放）一次，看到 auth 注入后的凭证。 */
        onRequest(ctx) {
          seen.credentialAfter.push(viewOf(ctx.request));
        },
      },
    ],
  };
  const h = authClient({}, [
    audit,
    axpLoading({ loading: () => undefined }),
    axpNotify<AxpResponse>({ notify }),
    axpRepath(),
    axpFilter(),
    axpRetry({ max: 2, delay: 0 }),
    axpMock({ enable: true }),
    axpShare(),
    axpCache(),
  ]);
  return { ...h, seen };
}

/** 按阶段与名字列出期望的 inspect 行。 */
function row(stage: AxpStage, name: string) {
  return { stage, name };
}

it("[core.method.inspect][core.opt.plugins] taps 各段与全部内置插件的顺序与 inspect() 一致：阶段固定，阶段内 pre、内置、post", /** 注册顺序打乱也不影响排序。 */ () => {
  const h = client();
  expect(h.api.inspect().filter(/** 去掉夹具自带的观测插件。 */ (item) => item.name !== OBSERVER)).toEqual([
    row("outer", `${AUDIT}#1`),
    row("outer", NAME.loading),
    row("outer", NAME.notify),
    row("outer", `${AUDIT}#0`),
    row("prepare", `${AUDIT}#2`),
    row("prepare", NAME.repath),
    row("prepare", NAME.filter),
    row("prepare", `${AUDIT}#3`),
    row("attempt", NAME.retry),
    row("credential", `${AUDIT}#4`),
    row("credential", NAME.auth),
    row("credential", `${AUDIT}#5`),
    row("source", NAME.mock),
    row("source", NAME.share),
    row("source", NAME.cache),
  ]);
});

it("[core.opt.plugins][retry.opt.max][auth.cb.onRefresh] 500 → 401 → 刷新 → 成功：outer 段只进出一次并看到最终响应，credential 前置段每次尝试一次且无凭证，后置段每次进入内层一次且带当次 token", /** 各 tap 的触发次数与内置插件的行为一一对应。 */ async () => {
  const h = client();
  h.net.on("get", RESOLVED_URL, /** 第一次 500，第二次旧 token 得到 401，之后按新 token 放行。 */ (config, hit) => (hit === 1 ? failure(500) : guarded(() => TOKEN_NEW)(config, hit)));
  const [result] = await settleAll(h.send({ url: TEMPLATE_URL, params: PARAMS }));
  expect(result.ok).toBe(true);
  expect(h.net.totalStarted).toBe(3);
  expect(h.settings.onRefresh).toHaveBeenCalledTimes(1);
  // outer：每个逻辑请求一次，响应侧看到的就是调用方拿到的那个对象。
  expect(h.seen.outerRequests).toBe(1);
  expect(h.seen.outerResponses).toHaveLength(1);
  expect(h.seen.outerResponses[0]).toBe(result);
  // credential 前置：retry 之内、auth 之外，两次尝试各一次，没有凭证；已经是 repath、filter 之后的请求。
  expect(h.seen.credentialBefore).toEqual([
    { url: RESOLVED_URL, params: SHAPED_PARAMS, token: undefined },
    { url: RESOLVED_URL, params: SHAPED_PARAMS, token: undefined },
  ]);
  // credential 后置：每次 next 进入一次，看到 auth 注入后的 token；鉴权重放换成了新 token。
  expect(h.seen.credentialAfter).toEqual([
    { url: RESOLVED_URL, params: SHAPED_PARAMS, token: TOKEN_OLD },
    { url: RESOLVED_URL, params: SHAPED_PARAMS, token: TOKEN_OLD },
    { url: RESOLVED_URL, params: SHAPED_PARAMS, token: TOKEN_NEW },
  ]);
});

it("[core.opt.plugins][repath.fn.axpRepath][filter.fn.axpFilter] prepare 前置 tap 的补丁被内置 repath、filter 继续处理，后置 tap 看到整形后的请求", /** tap 与内置插件在同一阶段内按 pre、内置、post 衔接。 */ async () => {
  const h = client();
  h.net.on(
    "get",
    RESOLVED_URL,
    guarded(() => TOKEN_OLD),
  );
  const [result] = await settleAll(h.send({ url: TEMPLATE_URL, params: PARAMS }));
  expect(result.ok).toBe(true);
  // 前置 tap 看到的是调用方原样的请求；它补上的 `tail: ""` 随后被 filter 剥离。
  expect(h.seen.prepareBefore).toEqual([{ url: TEMPLATE_URL, params: PARAMS, token: undefined }]);
  expect(h.seen.prepareAfter).toEqual([{ url: RESOLVED_URL, params: SHAPED_PARAMS, token: undefined }]);
  expect(result.request.url).toBe(RESOLVED_URL);
});

it("[core.opt.plugins][notify.cb.notify][retry.opt.max] 重试耗尽：outer 段看到的最终响应就是 notify 收到的、也是调用方拿到的那个，各自只触发一次，尽管 credential 段跑了三轮", /** 通知与 outer 响应侧都在重试收敛之后。 */ async () => {
  const notify = vi.fn();
  const seen = client(notify);
  seen.net.on("get", RESOLVED_URL, /** 一直失败。 */ () => failure(500));
  const [result] = await settleAll(seen.send({ url: TEMPLATE_URL, params: PARAMS }));
  expect(result).toMatchObject({ ok: false, status: 500 });
  expect(seen.net.totalStarted).toBe(3);
  expect(seen.seen.credentialBefore).toHaveLength(3);
  expect(seen.seen.outerResponses).toEqual([result]);
  expect(seen.seen.outerResponses[0]).toBe(result);
  expect(notify).toHaveBeenCalledExactlyOnceWith(FAILURE_MESSAGE, result);
});

it("[core.opt.plugins][cache.req.cache] 缓存命中的请求仍然穿过 credential 段的 taps（它们在 source 之外），但不触网", /** taps 的位置由阶段决定，与内层是否短路无关。 */ async () => {
  const h = client();
  h.net.on(
    "get",
    RESOLVED_URL,
    guarded(() => TOKEN_OLD),
  );
  const options = { url: TEMPLATE_URL, params: PARAMS, cache: true } as const;
  const [first] = await settleAll(h.send(options));
  const [hit] = await settleAll(h.send(options));
  expect(hit).not.toBe(first);
  expect(hit.data).toEqual(first.data);
  expect(h.net.totalStarted).toBe(1);
  expect(h.seen.credentialBefore).toHaveLength(2);
  expect(h.seen.credentialAfter).toHaveLength(2);
  expect(h.seen.outerResponses).toHaveLength(2);
  expect(h.seen.outerResponses[0]).toBe(first);
  expect(h.seen.outerResponses[1]).toBe(hit);
});
