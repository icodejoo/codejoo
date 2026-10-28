import { create as createAxios, type AxiosAdapter } from "axios";
import { bench } from "vitest";
import { createAxp } from "../src/client";
import axpAuth from "../src/plugins/auth";
import axpCache from "../src/plugins/cache";
import axpFilter from "../src/plugins/filter";
import axpLoading from "../src/plugins/loading";
import axpNotify from "../src/plugins/notify";
import axpRepath from "../src/plugins/repath";
import axpRetry from "../src/plugins/retry";
import axpShare from "../src/plugins/share";
import type { AxpResponse } from "../src/response";
import type { AxpPlugin } from "../src/types";

/** 与 B0 相同的 HTTP 成功码。 */
const HTTP_OK = 200;
/** 与 B0 相同的请求地址；不叫 URL，避免遮蔽全局 URL。 */
const BENCH_URL = "/baseline";
/** 成功业务码。 */
const BUSINESS_OK = 0;
/** 固定业务值。 */
const VALUE = 1;
/** 自检前没有发送请求。 */
const INITIAL_SENDS = 0;
/** 每个场景自检时恰好触网一次。 */
const SENDS_PER_SCENARIO = 1;
/** 直通中间件的层数梯度；0 层即无插件的对照。 */
const LAYER_COUNTS = [0, 3, 8] as const;
/** 固定缓存键，避免过期和散列干扰命中场景（与 B0 的 B4 相同）。 */
const CACHE_KEY = "baseline-cache";
/** 固定共享键（与 B0 的 B5 相同）。 */
const SHARE_KEY = "baseline-share";
/** 每组共享请求的并发数（与 B0 的 B5 相同）。 */
const CONCURRENCY = 100;
/** 单组共享请求的底层发送数。 */
const SHARED_SENDS = 1;
/** 与旧基线相同的发送计数。 */
let sends = INITIAL_SENDS;
/** 测量配置保持与 B0 一致。 */
const OPTIONS = {
  /** 正式测量至少两秒。 */
  time: 2_000,
  /** 预热半秒。 */
  warmupTime: 500,
  /** 至少一百个样本。 */
  iterations: 100,
};
/** 薄内存 adapter，与 B0 返回同一形状的新信封。 */
const adapter: AxiosAdapter = (config) => {
  sends++;
  return Promise.resolve({
    /** 成功状态。 */
    status: HTTP_OK,
    /** 状态文本。 */
    statusText: "OK",
    /** 无附加头。 */
    headers: {},
    /** 实际配置。 */
    config,
    /** 独立信封和数据对象。 */
    data: {
      /** 成功业务码。 */ code: BUSINESS_OK,
      /** 固定载荷。 */ data: { /** 业务值。 */ value: VALUE },
    },
  });
};

/** 生成指定数量的直通中间件插件，只测每多一层的调度开销。 */
function passThroughPlugins(count: number): AxpPlugin<AxpResponse>[] {
  return Array.from(
    { length: count },
    /** 每层只转交内层，不读写请求与响应。 */ (_, index) => ({
      name: `pass-${index}`,
      handle: (_ctx, next) => next(),
    }),
  );
}
/** 创建带指定层数直通中间件的客户端，传输用同一个薄 adapter。 */
function layeredClient(count: number) {
  return createAxp({ axios: createAxios({ adapter }), plugins: passThroughPlugins(count) });
}

/** 裸 axios 参照。 */
const bare = createAxios({ adapter });
/** B1 内核，无插件。 */
const plain = createAxp({ axios: createAxios({ adapter }) });
/** 各层数梯度对应的客户端。 */
const layered = LAYER_COUNTS.map(
  /** 每个梯度一个独立客户端。 */ (count) => ({
    count,
    api: layeredClient(count),
  }),
);

/** B4：只装 cache，有效期无限，预先填充后只测命中。 */
const cached = createAxp({
  axios: createAxios({ adapter }),
  plugins: [axpCache({ expires: Infinity })],
});
/** B5：只装 share，start 策略。 */
const shared = createAxp({
  axios: createAxios({ adapter }),
  plugins: [axpShare({ policy: "start" })],
});
/** B3/B6 重试预算，与 B0 同口径。 */
const RETRY_MAX = 2;
/** 不执行任何界面副作用。 */
function noop(): void {}
/** 成功不出提示。 */
function silent(): string {
  return "";
}
/** 基准里不应走到刷新。 */
function unexpectedRefresh(): never {
  throw new Error("基准不应触发刷新");
}
/** 已登录的令牌管理器，不触发刷新。 */
const tokenManager = { accessToken: "Bearer baseline", refreshToken: "baseline-refresh", set: noop, clear: noop };
/** B3：与 B0 同口径的全插件客户端；key、取消、归一化已是内核能力，不再装插件。 */
const full = createAxp({
  axios: createAxios({ adapter }),
  plugins: [
    axpFilter(),
    axpRepath(),
    axpAuth({ tokenManager, onRefresh: unexpectedRefresh, onAccessExpired: noop }),
    axpRetry({ max: RETRY_MAX }),
    axpNotify({ notify: noop, stringify: silent }),
    axpLoading({ loading: noop }),
    axpShare({ policy: "start" }),
    axpCache(),
  ],
});
/** B6：只装 retry、带 JSON 请求体的 POST 客户端。 */
const posted = createAxp({ axios: createAxios({ adapter }), plugins: [axpRetry({ max: RETRY_MAX })] });
/** 单调参数，保证全插件每次都不命中缓存。 */
let sequence = INITIAL_SENDS;
/** 全插件、缓存未命中的一次请求。 */
async function miss(): Promise<void> {
  await full.get(BENCH_URL)({ sequence: ++sequence }, { share: true, cache: true });
}
/** 带新 JSON 请求体的 POST，retry 已装但不触发。 */
async function post(): Promise<void> {
  await posted.post(BENCH_URL)({ name: "baseline", items: [VALUE, RETRY_MAX] });
}
/** 一次缓存命中请求，显式固定 key。 */
async function hit(): Promise<void> {
  await cached.get(BENCH_URL)(undefined, { key: CACHE_KEY, cache: true });
}
/** 启动一百个同 key 的 start 共享请求，等整组落定。 */
async function concurrent(): Promise<void> {
  await Promise.all(Array.from({ length: CONCURRENCY }, /** 每个订阅者使用相同的显式 key。 */ () => shared.get(BENCH_URL)(undefined, { key: SHARE_KEY, share: true })));
}

/** 取出信封解包后的业务值。 */
function businessValue(result: unknown): number {
  return (result as { /** value 字段。 */ value: number }).value;
}
/** 在计时外确认各场景的测量路径、层数及解包结果。 */
async function verify(): Promise<void> {
  sends = INITIAL_SENDS;
  await bare.get(BENCH_URL);
  if (sends !== SENDS_PER_SCENARIO) throw new Error("裸 axios 自检失败");
  for (const { count, api } of [{ count: 0, api: plain }, ...layered]) {
    sends = INITIAL_SENDS;
    // oxlint-disable-next-line no-await-in-loop -- 发送计数按场景核对，必须串行。
    const result = businessValue(await api.get(BENCH_URL)());
    if (sends !== SENDS_PER_SCENARIO || result !== VALUE || api.inspect().length !== count) throw new Error(`B2 基准路径自检失败：${count} 层`);
  }
  // B3：每次都要触网。
  sends = INITIAL_SENDS;
  await miss();
  await miss();
  if (sends !== RETRY_MAX) throw new Error("B3 必须每次触网");
  // B4：预先填充后再次请求不得触网。
  await hit();
  sends = INITIAL_SENDS;
  await hit();
  if (sends !== INITIAL_SENDS) throw new Error("B4 必须命中缓存");
  // B5：一整组并发只触网一次。
  sends = INITIAL_SENDS;
  await concurrent();
  if (sends !== SHARED_SENDS) throw new Error("B5 每组必须只触网一次");
}
await verify();

bench(
  "B1 裸 axios",
  /** 直接调用 axios，作为传输层参照。 */ async () => {
    await bare.get(BENCH_URL);
  },
  OPTIONS,
);
bench(
  "B2 createAxp 无插件",
  /** 无插件的内核路径，与 B0 的 B2 同口径。 */ async () => {
    await plain.get(BENCH_URL)();
  },
  OPTIONS,
);
for (const { count, api } of layered) {
  bench(
    `B2-${count} 直通中间件 ${count} 层`,
    /** 带指定层数直通中间件的内核路径。 */ async () => {
      await api.get(BENCH_URL)();
    },
    OPTIONS,
  );
}
bench("B3 全插件缓存未命中", miss, OPTIONS);
bench("B4 缓存命中", hit, OPTIONS);
bench("B5 share start 并发100", concurrent, OPTIONS);
bench("B6 JSON POST + retry", post, OPTIONS);
