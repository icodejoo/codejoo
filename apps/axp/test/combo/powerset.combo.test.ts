import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axpFilter from "../../src/plugins/filter";
import axpLoading from "../../src/plugins/loading";
import axpNotify from "../../src/plugins/notify";
import axpRepath from "../../src/plugins/repath";
import { isAxpResponse, type AxpKind, type AxpResponse } from "../../src/response";
import type { AxpPlugin, AxpRequestConfig } from "../../src/types";
import type { ITestEvents } from "../helpers/client";
import {
  createInvariantHarness,
  createNotifyRecorder,
  type IInvariantHarness,
} from "../helpers/invariants";
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
} as const;
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

/** 给请求配置加上假网络的延迟字段。 */
function withLatency(config: AxpRequestConfig, latency: number): AxpRequestConfig {
  return { ...config, latency } as AxpRequestConfig;
}

/** 插件表。新增插件只需在这里加一项，子集与用例自动展开。
 *
 * B3 / B4 合入后补下面五项（它们的 API 此刻还不存在，这里只留占位，不要提前 import）：
 *   { name: "retry", make: () => axpRetry<AxpResponse>({ max: 2, delay: 0 }) },
 *   { name: "auth", make: (events) => axpAuth<AxpResponse>({ tokenManager, onRefresh: countRefresh(events, refresh), onAccessExpired }) },
 *   { name: "mock", make: () => axpMock<AxpResponse>({ … }) },
 *   { name: "share", make: () => axpShare<AxpResponse>() },
 *   { name: "cache", make: () => axpCache<AxpResponse>() },
 * 其中 auth 的 onRefresh 必须用 countRefresh 包装，I5 才有数据；auth 的流程（business 401 刷新）要同步补进 FLOWS。
 */
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
];

/** 枚举插件表的全部子集（含空集），剔除不满足 needs 的。
 * @param table 插件表。
 * @returns 按位掩码从小到大排列的子集。
 * @example `subsetsOf(PLUGINS).length // 16`
 */
function subsetsOf(table: readonly IPluginEntry[]): ISubset[] {
  const subsets: ISubset[] = [];
  for (let mask = 0; mask < 1 << table.length; mask++) {
    const entries = table.filter(
      /** 掩码的第 index 位为 1 才入选。 */ (_, index) => (mask & (1 << index)) !== 0,
    );
    const names = new Set(entries.map(/** 取短名。 */ (entry) => entry.name));
    if (
      entries.some(
        /** 依赖没到齐的子集不生成。 */ (entry) =>
          entry.needs?.some(/** 缺任一依赖即失败。 */ (need) => !names.has(need)),
      )
    )
      continue;
    subsets.push({
      label: entries.length
        ? entries.map(/** 取短名。 */ (entry) => entry.name).join("+")
        : EMPTY_LABEL,
      entries,
    });
  }
  return subsets;
}

/** 假网络的统一路由：按路径前缀返回 500、网络错误或 200（回显地址）。 */
function route(config: InternalAxiosRequestConfig): RouteResult {
  const url = config.url ?? "";
  if (url.startsWith(PATH.http500))
    return { status: HTTP_ERROR, data: { code: HTTP_ERROR, message: "boom", data: null } };
  if (url.startsWith(PATH.offline))
    throw new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);
  return { status: 200, data: { code: 0, data: { url } } };
}

/** 全部脚本化流程；每个流程只管发请求和推进时间。 */
const FLOWS: IFlow[] = [
  {
    name: "成功",
    baseline: ["ok"],
    /** 带空查询字段的 GET，延迟跨过 loading 的显示窗口。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.ok, params: { page: 1, q: "" } }, LATENCY_MEDIUM));
    },
  },
  {
    name: "HTTP 500",
    baseline: ["http"],
    /** 默认 throws 的失败路径：调用方拿到的是被抛出的 R。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.http500 }, LATENCY_SHORT));
    },
  },
  {
    name: "网络错误",
    baseline: ["network"],
    /** throws: false 的失败路径：失败的 R 作为返回值。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.offline, throws: false }, LATENCY_SHORT));
    },
  },
  {
    name: "并发同 key",
    baseline: ["ok", "ok"],
    /** 两个请求参数完全相同、返回时间错开；share、cache 合入后会在此合并。 */
    async run(h) {
      for (const latency of SAME_KEY_LATENCIES)
        h.launch(withLatency({ url: PATH.same, params: { id: 1 }, throws: false }, latency));
    },
  },
  {
    name: "中途取消",
    baseline: ["cancel", "cancel"],
    /** 一个带调用方 signal、一个不带，请求停在半途时 cancelAll。 */
    async run(h) {
      h.launch(withLatency({ url: PATH.slow }, LATENCY_LONG));
      h.launch(withLatency({ url: PATH.slow, signal: new AbortController().signal }, LATENCY_LONG));
      await vi.advanceTimersByTimeAsync(CANCEL_AT);
      h.api.cancelAll("combo");
    },
  },
  {
    name: "路径变量与空字段",
    baseline: ["ok"],
    /** POST 同时带路径变量、空查询字段和空请求体字段。 */
    async run(h) {
      h.launch(
        withLatency(
          {
            method: "post",
            url: PATH.user,
            params: { id: 7, q: "", page: null },
            data: { name: "a", note: "", tag: null, nested: { x: "" } },
            throws: false,
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
const SUBSET_CASES = SUBSETS.map(
  /** 转成 [子集名, 成员]。 */ (subset): [string, IPluginEntry[]] => [subset.label, subset.entries],
);
/** it.each 的用例参数：[流程名, 流程]。 */
const FLOW_CASES = FLOWS.map(
  /** 转成 [流程名, 流程]。 */ (flow): [string, IFlow] => [flow.name, flow],
);

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
    return h.requests.map(
      /** 落定值不是响应时标成 raw，说明有 bug 被抛了出来。 */ (request) =>
        isAxpResponse(request.value) ? request.value.kind : "raw",
    );
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
  it("needs 缺失的子集不生成", /** 依赖表只影响枚举。 */ () => {
    const table: IPluginEntry[] = [
      { name: "a", make: PLUGINS[0].make },
      { name: "b", make: PLUGINS[0].make, needs: ["a"] },
    ];
    expect(subsetsOf(table).map(/** 取子集名。 */ (subset) => subset.label)).toEqual([
      EMPTY_LABEL,
      "a",
      "a+b",
    ]);
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
