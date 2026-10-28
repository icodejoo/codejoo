import { create as createAxios, type AxiosAdapter } from "axios";
import { bench } from "vitest";
import {
  Axp,
  axpAuth,
  axpCache,
  axpCancel,
  axpFilter,
  axpKey,
  axpLoading,
  axpNormalize,
  axpNotify,
  axpRepath,
  axpRetry,
  axpShare,
} from "../src";

/** 成功响应的 HTTP 状态。 */
const HTTP_OK = 200;
/** 基准请求地址。 */
const URL = "/baseline";
/** 每组共享请求的并发数。 */
const CONCURRENCY = 100;
/** 重试预算；成功路径不会消耗。 */
const RETRY_MAX = 2;
/** 固定缓存键，避免过期和散列干扰命中场景。 */
const CACHE_KEY = "baseline-cache";
/** 固定共享键。 */
const SHARE_KEY = "baseline-share";
/** 共享策略。 */
const SHARE_POLICY = "start";
/** 请求协议字段的开启值。 */
const ENABLED = true;
/** 每次自检发起的未命中请求数。 */
const VERIFY_MISSES = RETRY_MAX;
/** 单组共享请求的底层发送数。 */
const SHARED_SENDS = 1;
/** 测量配置：预热半秒，至少测两秒及一百个样本。 */
const OPTIONS = {
  /** 正式测量时长，单位毫秒。 */
  time: 2_000,
  /** 预热时长，单位毫秒。 */
  warmupTime: 500,
  /** 最少样本数。 */
  iterations: CONCURRENCY,
};
/** 成功业务码与初始计数。 */
const ZERO = 0;
/** 触网计数，用于在正式测量前验证场景。 */
let sends = ZERO;
/** 立即返回信封，不引入定时器、路由查找或日志。 */
const adapter: AxiosAdapter = (config) => {
  sends++;
  return Promise.resolve({
    // HTTP 状态码。
    status: HTTP_OK,
    // 成功状态文本。
    statusText: "OK",
    // 无额外响应头。
    headers: {},
    // 保留实际传输配置。
    config,
    // 每次返回独立信封及业务数据。
    data: {
      /** 成功业务码。 */
      code: ZERO,
      /** 固定业务载荷。 */
      data: {
        /** 固定业务值。 */
        value: SHARED_SENDS,
      },
    },
  });
};
/** 无副作用的通知回调。 */
function noop(): void {}
/** 成功响应无需通知。 */
function stringify(): string {
  return "";
}
/** 刷新不应发生。 */
function unexpectedRefresh(): never {
  throw new Error("基准不应触发刷新");
}
/** 为旧鉴权 API 提供固定的已有 token。 */
const tokenManager = {
  /** 旧 API 的刷新许可。 */
  canRefresh: ENABLED,
  /** 已有访问令牌。 */
  accessToken: "Bearer baseline",
  /** 已有刷新令牌。 */
  refreshToken: "baseline-refresh",
  /** 成功路径不修改令牌。 */
  set: noop,
  /** 成功路径不清空令牌。 */
  clear: noop,
};
/** 裸 axios 参照。 */
const bare = createAxios({
  /** 无定时器的内存传输。 */
  adapter,
});
/** 仅包装 Core 的客户端。 */
const plain = Axp.create(
  createAxios({
    /** 无定时器的内存传输。 */
    adapter,
  }),
);
/** 全插件成功路径客户端。 */
const full = Axp.create(
  createAxios({
    /** 无定时器的内存传输。 */
    adapter,
  }),
);
Axp.install(full.axios, {
  // 深 key 必须包含每次变化的参数。
  key: axpKey({
    /** 将参数纳入指纹。 */
    fastMode: false,
  }),
  // 旧版仍需请求级开启过滤。
  filter: axpFilter(),
  // 路径整形。
  repath: axpRepath(),
  // 旧版取消插件。
  cancel: axpCancel(),
  // 已有令牌，不触发刷新。
  auth: axpAuth({
    /** 已登录状态。 */
    tokenManager,
    /** 防止误走刷新。 */
    onRefresh: unexpectedRefresh,
    /** 成功时不触发过期通知。 */
    onAccessExpired: noop,
  }),
  // 安装但不触发重试。
  retry: axpRetry({
    /** 成功路径仍装预算。 */
    max: RETRY_MAX,
  }),
  // 成功结果不发通知。
  notify: axpNotify({
    /** 不执行界面副作用。 */
    notify: noop,
    /** 成功无提示。 */
    stringify,
  }),
  // 旧版业务失败判定。
  normalize: axpNormalize(),
  // 即时显示隐藏，不设置计时器。
  loading: axpLoading({
    /** 不执行界面副作用。 */
    loading: noop,
  }),
  // 请求级启用 start 共享。
  share: axpShare({
    /** 启用首发共享。 */
    policy: SHARE_POLICY,
  }),
  // 有限容量避免测量期间无限增长。
  cache: axpCache(),
});
/** 缓存命中专用客户端。 */
const cached = Axp.create(
  createAxios({
    /** 无定时器的内存传输。 */
    adapter,
  }),
);
Axp.install(cached.axios, {
  /** 只测缓存命中。 */
  cache: axpCache({
    /** 测量期间永不过期。 */
    expires: Infinity,
  }),
});
/** 并发共享专用客户端。 */
const shared = Axp.create(
  createAxios({
    /** 无定时器的内存传输。 */
    adapter,
  }),
);
Axp.install(shared.axios, {
  /** 共享插件。 */
  share: axpShare({
    /** 首发胜出策略。 */
    policy: SHARE_POLICY,
  }),
});
/** POST 重试插件专用客户端。 */
const posted = Axp.create(
  createAxios({
    /** 无定时器的内存传输。 */
    adapter,
  }),
);
Axp.install(posted.axios, {
  /** 安装重试但不触发。 */
  retry: axpRetry({
    /** 固定预算。 */
    max: RETRY_MAX,
  }),
});
/** 单调参数，保证全插件每次均未命中。 */
let sequence = ZERO;
/** 执行全插件未命中请求。 */
async function miss(): Promise<void> {
  await full.get(URL)(
    {
      /** 变化参数确保不命中。 */
      sequence: ++sequence,
    },
    {
      /** 旧版深度 key。 */
      key: ENABLED,
      /** 启用旧版过滤。 */
      filter: ENABLED,
      /** 启用共享但不同参数不合并。 */
      share: ENABLED,
      /** 启用缓存并持续未命中。 */
      cache: ENABLED,
    },
  );
}
/** 执行一次缓存命中请求。 */
async function hit(): Promise<void> {
  await cached.get(URL)(undefined, {
    /** 固定缓存键。 */
    key: CACHE_KEY,
    /** 启用缓存。 */
    cache: ENABLED,
  });
}
/** 启动一百个同 key 请求，等待整组落定。 */
async function concurrent(): Promise<void> {
  await Promise.all(
    Array.from(
      {
        /** 同组请求数。 */
        length: CONCURRENCY,
      },
      /** 每个订阅者使用相同显式 key。 */
      () =>
        shared.get(URL)(undefined, {
          /** 固定共享键。 */
          key: SHARE_KEY,
          /** 启用首发共享。 */
          share: ENABLED,
        }),
    ),
  );
}
/** 在计时之外验证触网次数，防止基准实际测错路径。 */
async function verify(): Promise<void> {
  let before = sends;
  await miss();
  await miss();
  if (sends - before !== VERIFY_MISSES) throw new Error("B3 必须每次触网");
  await hit();
  before = sends;
  await hit();
  if (sends !== before) throw new Error("B4 必须命中缓存");
  before = sends;
  await concurrent();
  if (sends - before !== SHARED_SENDS) throw new Error("B5 每组必须只触网一次");
}
await verify();

bench(
  "B1 裸 axios",
  /** 测量裸传输请求。 */
  async () => {
    await bare.get(URL);
  },
  OPTIONS,
);
bench(
  "B2 axp 无插件",
  /** 测量旧 Core 包装。 */
  async () => {
    await plain.get(URL)();
  },
  OPTIONS,
);
bench("B3 全插件缓存未命中", miss, OPTIONS);
bench("B4 缓存命中", hit, OPTIONS);
bench("B5 share start 并发100", concurrent, OPTIONS);
bench(
  "B6 JSON POST + retry",
  /** 每次传入新的 JSON 请求体。 */
  async () => {
    await posted.post(URL)({
      /** 字符串业务字段。 */
      name: "baseline",
      /** 数组业务字段。 */
      items: [SHARED_SENDS, RETRY_MAX],
    });
  },
  OPTIONS,
);
