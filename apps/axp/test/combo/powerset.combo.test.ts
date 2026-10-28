import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axpAuth from "../../src/plugins/auth";
import axpCache from "../../src/plugins/cache";
import axpFilter from "../../src/plugins/filter";
import axpLoading from "../../src/plugins/loading";
import axpMock from "../../src/plugins/mock";
import axpNotify from "../../src/plugins/notify";
import axpRepath from "../../src/plugins/repath";
import axpRetry from "../../src/plugins/retry";
import axpShare from "../../src/plugins/share";
import type { ITokenManager } from "../../src/objects/TokenManager";
import { isAxpResponse, type AxpKind, type AxpResponse } from "../../src/response";
import type { AxpPlugin, AxpRequestConfig } from "../../src/types";
import { guarded, memoryTokens, REFRESH_TOKEN, TOKEN_NEW } from "../helpers/b3";
import type { ITestEvents } from "../helpers/client";
import { countRefresh, createInvariantHarness, createNotifyRecorder, type IInvariantHarness } from "../helpers/invariants";
import type { RouteResult } from "../helpers/network";
import { recordEvents } from "../helpers/client";
import { loadingRecorder } from "../helpers/ui";

/** 插件表的一项：子集就是这些项的任意组合。 */
interface IPluginEntry {
  /** 子集名里显示的短名，表内唯一。 */
  name: string;
  /** 为一次运行造全新的插件对象；events 供需要观测回调的插件绑定。 */
  make: (events: ITestEvents) => AxpPlugin<AxpResponse, any>;
  /** 必须同时在场的其它插件名；子集缺任意一个就不生成。 */
  needs?: string[];
}
/** 一个子集：用于标题的名字与成员。 */
interface ISubset {
  /** 成员短名按插件表顺序用 + 连接；空集用 EMPTY_LABEL。 */
  label: string;
  /** 本子集的插件表项。 */
  entries: IPluginEntry[];
}
/** 一条脚本化流程。 */
interface IFlow {
  /** 流程名，出现在用例标题里。 */
  name: string;
  /** 无插件时每个逻辑请求应得到的 kind，只用来确认脚本没有空转，不参与 powerset 断言。 */
  baseline: AxpKind[];
  /** 只发请求、推进假时钟，不断言结果；收尾由用例统一排空并检查不变量。 */
  run(h: IInvariantHarness): Promise<void>;
}

/** 空子集的标题。 */
const EMPTY_LABEL = "无插件";
/** 假网络上的各条路径。 */
const PATH = {
  /** 恒 200。 */ ok: "/combo/ok",
  /** 恒 500。 */ http500: "/combo/http500",
  /** 抛网络错误。 */ offline: "/combo/offline",
  /** 并发同 key 的两个请求共用。 */ same: "/combo/same",
  /** 慢响应，给取消留出窗口。 */ slow: "/combo/slow",
  /** 带路径变量。 */ user: "/combo/users/:id/orders",
  /** 前两次 500，之后成功。 */ flaky: "/combo/flaky",
  /** 受保护：只认刷新后的新 token，旧 token 得到 HTTP 200 + 业务码 401。 */ auth: "/combo/auth",
} as const;
/** mock 服务器基址；探测它的请求一律 404，让 mock 插件确定地回落真实接口。 */
const MOCK_URL = "http://mock";
/** mock 服务器上没有这条接口。 */
const NOT_FOUND = 404;
/** flaky 路径前这么多次发送返回 500，之后成功。 */
const FLAKY_FAILURES = 2;
/** retry 的预算：恰好够 flaky 路径在第三次发送时成功。 */
const RETRY_MAX = 2;
/** 请求级开启 cache 与 share；插件没装时这两个字段无人读取。 */
const SOURCE_OPTIONS = { cache: true, share: true } as const;
/** 受保护路径上并发请求的参数：两个同 key，一个不同 key，同时覆盖共享与单飞刷新。 */
const AUTH_PARAMS = [{ id: 1 }, { id: 1 }, { id: 2 }] as const;
/** 受保护路径的服务端：只认刷新后的新 token，其余按业务码 401 失败。 */
const authRoute = guarded(() => TOKEN_NEW, true);
/** 短延迟：比 loading 的显示延迟更短，显示定时器会在结束前被取消。 */
const LATENCY_SHORT = 10;
/** 中延迟：比 loading 的显示延迟更长，会真正显示再隐藏。 */
const LATENCY_MEDIUM = 30;
/** 长延迟：取消流程里请求停在半途。 */
const LATENCY_LONG = 100;
/** 取消前推进的假时间，落在 loading 已显示、请求未返回之间。 */
const CANCEL_AT = 40;
/** loading 的显示与隐藏延迟（毫秒），让防闪烁定时器参与组合。 */
const LOADING_DELAY = 20;
/** 并发同 key 流程里两个请求的错开延迟，制造先后返回。 */
const SAME_KEY_LATENCIES = [20, 40] as const;
/** 服务端返回的 HTTP 500。 */
const HTTP_ERROR = 500;
/** 用例标题统一前缀。 */
const TITLE = "[combo.powerset]";
/** 有中间件的内置插件，按插件表顺序；envs 只在装卸时执行、不进链，不在其中。 */
const MIDDLEWARE_PLUGINS = ["loading", "notify", "repath", "filter", "retry", "auth", "mock", "share", "cache"];
/** 九个插件的全部子集数（含空集与全集）。 */
const SUBSET_COUNT = 512;

/** 给请求配置加上假网络的延迟字段。 */
function withLatency(config: AxpRequestConfig, latency: number): AxpRequestConfig {
  return { ...config, latency } as AxpRequestConfig;
}

/** 刷新实现：同步换上新 token。 */
function refreshToken(_response: AxpResponse, tm: ITokenManager): void {
  tm.set(TOKEN_NEW, REFRESH_TOKEN);
}

/** 插件表：九个有中间件的内置插件，子集与用例自动展开。auth 的 onRefresh 用 countRefresh 包装，I5 才有数据。 */
const PLUGINS: IPluginEntry[] = [
  {
    name: "loading",
    make: (events) =>
      axpLoading<AxpResponse>({
        loading: loadingRecorder(events),
        delay: LOADING_DELAY,
        delayClose: LOADING_DELAY,
      }),
  },
  { name: "notify", make: (events) => axpNotify<AxpResponse>(createNotifyRecorder(events)) },
  { name: "repath", make: () => axpRepath<AxpResponse>() },
  { name: "filter", make: () => axpFilter<AxpResponse>() },
  { name: "retry", make: () => axpRetry<AxpResponse>({ max: RETRY_MAX, delay: 0 }) },
  {
    name: "auth",
    make: (events) =>
      axpAuth<AxpResponse>({
        tokenManager: memoryTokens(),
        onRefresh: countRefresh(events, refreshToken),
        onAccessExpired: /** 过期通知不做任何事。 */ () => undefined,
      }),
  },
  {
    name: "mock",
    make: () => axpMock<AxpResponse>({ enable: true, mock: true, mockUrl: MOCK_URL }),
  },
  { name: "share", make: () => axpShare<AxpResponse>() },
  { name: "cache", make: () => axpCache<AxpResponse>() },
];

/** 枚举插件表的全部子集（含空集），剔除不满足 needs 的。
 * @param table 插件表。
 * @returns 按位掩码从小到大排列的子集。
 * @example `subsetsOf(PLUGINS).length // 512`
 */
function subsetsOf(table: readonly IPluginEntry[]): ISubset[] {
  const subsets: ISubset[] = [];
  for (let mask = 0; mask < 1 << table.length; mask++) {
    const entries = table.filter(/** 掩码的第 index 位为 1 才入选。 */ (_, index) => (mask & (1 << index)) !== 0);
    const names = new Set(entries.map(/** 取短名。 */ (entry) => entry.name));
    if (entries.some(/** 依赖没到齐的子集不生成。 */ (entry) => entry.needs?.some(/** 缺任一依赖即失败。 */ (need) => !names.has(need)))) continue;
    subsets.push({
      label: entries.length ? entries.map(/** 取短名。 */ (entry) => entry.name).join("+") : EMPTY_LABEL,
      entries,
    });
  }
  return subsets;
}

/** 假网络的统一路由：按路径前缀返回 404（mock 探测）、500、网络错误、业务码 401 或 200（回显地址）。 */
function route(config: InternalAxiosRequestConfig, hit: number): RouteResult {
  const url = config.url ?? "";
  if (url.startsWith(MOCK_URL)) return { status: NOT_FOUND };
  if (url.startsWith(PATH.auth)) return authRoute(config, hit) ?? {};
  if (url.startsWith(PATH.flaky) && hit <= FLAKY_FAILURES) return { status: HTTP_ERROR, data: { code: HTTP_ERROR, message: "flaky", data: null } };
  if (url.startsWith(PATH.http500)) return { status: HTTP_ERROR, data: { code: HTTP_ERROR, message: "boom", data: null } };
  if (url.startsWith(PATH.offline)) throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
  return { status: 200, data: { code: 0, data: { url } } };
}

/** 全部脚本化流程；每个流程只管发请求和推进时间。 */
const FLOWS: IFlow[] = [
  {
    name: "成功",
    baseline: ["ok", "ok"],
    /** 带空查询字段的 GET，延迟跨过 loading 的显示窗口；排空后再发一次相同请求，装了 cache 时第二次命中。 */
    async run(h) {
      const request = { url: PATH.ok, params: { page: 1, q: "" }, ...SOURCE_OPTIONS };
      h.launch(withLatency(request, LATENCY_MEDIUM));
      await h.drain();
      h.launch(withLatency(request, LATENCY_MEDIUM));
    },
  },
  {
    name: "HTTP 500",
    baseline: ["http"],
    /** 默认 throws 的失败路径：调用方拿到的是被抛出的 R；装了 retry 时三次都失败。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.http500, ...SOURCE_OPTIONS }, LATENCY_SHORT));
    },
  },
  {
    name: "HTTP 500 两次后成功",
    baseline: ["http"],
    /** 前两次发送 500、第三次成功：装了 retry 时在预算内恢复，没装则停在第一次的失败。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.flaky, throws: false, ...SOURCE_OPTIONS }, LATENCY_SHORT));
    },
  },
  {
    name: "business 401 刷新",
    baseline: ["biz", "biz", "biz"],
    /** HTTP 200 + 业务码 401：装了 auth 时单飞刷新后重放；三个请求里两个同 key、一个不同，覆盖共享与单飞。 */
    async run(h) {
      for (const params of AUTH_PARAMS) h.launch(withLatency({ url: PATH.auth, params, throws: false, ...SOURCE_OPTIONS }, LATENCY_SHORT));
    },
  },
  {
    name: "网络错误",
    baseline: ["network"],
    /** throws: false 的失败路径：失败的 R 作为返回值。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.offline, throws: false, ...SOURCE_OPTIONS }, LATENCY_SHORT));
    },
  },
  {
    name: "并发同 key",
    baseline: ["ok", "ok"],
    /** 两个请求参数完全相同、返回时间错开；装了 share、cache 时在此合并。 */
    async run(h) {
      for (const latency of SAME_KEY_LATENCIES) h.launch(withLatency({ url: PATH.same, params: { id: 1 }, throws: false, ...SOURCE_OPTIONS }, latency));
    },
  },
  {
    name: "中途取消",
    baseline: ["cancel", "cancel"],
    /** 一个带调用方 signal、一个不带，请求停在半途时 cancelAll。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.slow, ...SOURCE_OPTIONS }, LATENCY_LONG));
      h.launch(withLatency({ url: PATH.slow, signal: new AbortController().signal, ...SOURCE_OPTIONS }, LATENCY_LONG));
      await vi.advanceTimersByTimeAsync(CANCEL_AT);
      h.api.cancelAll("combo");
    },
  },
  {
    name: "单个取消",
    baseline: ["cancel", "ok"],
    /** 同 key 的两个请求，首发在半途用自己的 signal 取消；装了 share 时跟随者不受连累。 */
    async run(h) {
      const leader = new AbortController();
      h.launch(withLatency({ url: PATH.slow, signal: leader.signal, throws: false, ...SOURCE_OPTIONS }, LATENCY_LONG));
      h.launch(withLatency({ url: PATH.slow, throws: false, ...SOURCE_OPTIONS }, LATENCY_LONG));
      await vi.advanceTimersByTimeAsync(CANCEL_AT);
      leader.abort();
    },
  },
  {
    name: "路径变量与空字段",
    baseline: ["ok"],
    /** POST 同时带路径变量、空查询字段和空请求体字段；cache、share 默认不处理 POST。 */
    async run(h) {
      h.launch(
        withLatency(
          {
            method: "post",
            url: PATH.user,
            params: { id: 7, q: "", page: null },
            data: { name: "a", note: "", tag: null, nested: { x: "" } },
            throws: false,
            ...SOURCE_OPTIONS,
          },
          LATENCY_SHORT,
        ),
      );
    },
  },
];

/** 全部子集：插件表有 n 项且无 needs 时共 2^n 个。 */
const SUBSETS = subsetsOf(PLUGINS);
/** describe.each 的用例参数：标题用 %s 展开，避免对象插值给字符串加引号。 */
const SUBSET_CASES = SUBSETS.map(/** 转成 [子集名, 成员]。 */ (subset): [string, IPluginEntry[]] => [subset.label, subset.entries]);
/** it.each 的用例参数：[流程名, 流程]。 */
const FLOW_CASES = FLOWS.map(/** 转成 [流程名, 流程]。 */ (flow): [string, IFlow] => [flow.name, flow]);

/** 在假时钟上跑一个流程，排空后检查 I1–I7。
 * @param entries 本次安装的插件表项。
 * @param flow 脚本化流程。
 * @returns 夹具已销毁后的每个逻辑请求结果类别，供基线核对。
 */
async function runFlow(entries: readonly IPluginEntry[], flow: IFlow): Promise<string[]> {
  const events = recordEvents();
  const h = createInvariantHarness(
    entries.map(/** 每次运行用全新的插件对象。 */ (entry) => entry.make(events)),
    { events },
  );
  h.net.fallback(route);
  try {
    await flow.run(h);
    await h.drain();
    h.assertAll();
    return h.requests.map(/** 落定值不是响应时标成 raw，说明有 bug 被抛了出来。 */ (request) => (isAxpResponse(request.value) ? request.value.kind : "raw"));
  } finally {
    h.dispose();
  }
}

/** 所有用例共用假时钟，不做真实等待。 */
beforeEach(() => {
  vi.useFakeTimers();
});
/** 还原真实时钟。 */
afterEach(() => {
  vi.useRealTimers();
});

describe(`${TITLE} 子集枚举`, () => {
  it("覆盖 2^n 个互不相同的子集，含空集与全集", /** 位掩码枚举不重不漏。 */ () => {
    const labels = SUBSETS.map(/** 取子集名。 */ (subset) => subset.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toHaveLength(2 ** PLUGINS.length);
    expect(labels).toContain(EMPTY_LABEL);
    expect(labels).toContain(PLUGINS.map(/** 取短名。 */ (entry) => entry.name).join("+"));
  });
  it("插件表恰好是九个有中间件的内置插件，子集共 512 个", /** 对应 test-plan §5.3。 */ () => {
    expect(PLUGINS.map(/** 取短名。 */ (entry) => entry.name)).toEqual(MIDDLEWARE_PLUGINS);
    expect(SUBSETS).toHaveLength(SUBSET_COUNT);
  });
  it("needs 缺失的子集不生成", /** 依赖表只影响枚举。 */ () => {
    const table: IPluginEntry[] = [
      { name: "a", make: PLUGINS[0].make },
      { name: "b", make: PLUGINS[0].make, needs: ["a"] },
    ];
    expect(subsetsOf(table).map(/** 取子集名。 */ (subset) => subset.label)).toEqual([EMPTY_LABEL, "a", "a+b"]);
  });
});

describe(`${TITLE} 基线：无插件时流程确实在做它声明的事`, () => {
  it.each(FLOW_CASES)("%s", async (_name, flow) => {
    expect(await runFlow([], flow)).toEqual(flow.baseline);
  });
});

describe.each(SUBSET_CASES)(`${TITLE} %s`, (_label, entries) => {
  it.each(FLOW_CASES)("× %s", async (_name, flow) => {
    await runFlow(entries, flow);
  });
});
