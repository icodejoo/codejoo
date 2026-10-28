/** 全局常量：环境变量名、默认值、能力集合、网络/风格枚举。同一字面量只在这里出现一次。 */

/** 响应风格 */
export type Style = "http" | "business";
/** 网络预设名 */
export type NetworkName = "normal" | "weak" | "lossy" | "offline" | "blackhole" | "flap" | "dns";
/** adapter 名（axios 的 http / fetch 两种） */
export type AdapterName = "http" | "fetch";

/** 全部风格，顺序即报告列顺序 */
export const ALL_STYLES: readonly Style[] = ["http", "business"];
/** 全部网络预设，顺序即报告列顺序 */
export const ALL_NETWORKS: readonly NetworkName[] = ["normal", "weak", "lossy", "offline", "blackhole", "flap", "dns"];
/** 全部 adapter */
export const ALL_ADAPTERS: readonly AdapterName[] = ["http", "fetch"];

/** 环境变量名：测试服务器地址 */
export const ENV_SERVER = "TESTKIT_SERVER";
/** 环境变量名：netem 控制地址 */
export const ENV_NETEM = "TESTKIT_NETEM";
/** 环境变量名：场景目录 */
export const ENV_SCENARIOS = "TESTKIT_SCENARIOS";

/** 测试服务器默认地址 */
export const DEFAULT_SERVER = "http://127.0.0.1:47080";
/** netem 控制 API 默认地址 */
export const DEFAULT_NETEM = "http://127.0.0.1:47090";
/** 场景目录默认位置 */
export const DEFAULT_SCENARIOS = "E:/workspaces/api-ws-demo/testkit/scenarios";

/** DNS 失败网络使用的不可解析域名（CONTRACT §6） */
export const DNS_FAIL_HOST = "nonexistent.invalid";

/** 单次运行的默认总超时（schema 默认值） */
export const DEFAULT_RUN_TIMEOUT_MS = 20000;
/** 旁路（直连服务器/netem 控制面）请求的超时 */
export const BYPASS_TIMEOUT_MS = 10000;
/** expire_local 里重新登录所用的极短 access 有效期 */
export const EXPIRE_LOCAL_TTL_MS = 1;
/** expire_local 登录后等待令牌过期的时间 */
export const EXPIRE_LOCAL_WAIT_MS = 30;
/** 服务端断言失败后重新观测的最长时间（等 aborted 等延迟落账的字段） */
export const SERVER_RETRY_MS = 2000;
/** 服务端断言重新观测的间隔 */
export const SERVER_RETRY_INTERVAL_MS = 200;
/** 清理后等待服务端 inflight 归零的最长时间 */
export const INFLIGHT_DRAIN_MS = 3000;

/** flap 网络的时间表：先断 1500ms 再恢复（CONTRACT §6） */
export const FLAP_SCHEDULE: ReadonlyArray<{ at_ms: number; profile: string }> = [
  { at_ms: 0, profile: "offline" },
  { at_ms: 1500, profile: "normal" },
];

/** 请求头：运行轮次 */
export const HEADER_RUN = "X-Test-Run";
/** 请求头：响应风格 */
export const HEADER_STYLE = "X-Test-Style";

/** 受保护路径的默认前缀 */
export const PRIVATE_PREFIX = "/t/private";
/** mock 服务的路径前缀（CONTRACT §4.1） */
export const MOCK_PREFIX = "/t/mock";
/** 默认的可重试状态（schema 中立默认值，比 axp 默认少 408/429） */
export const DEFAULT_RETRY_STATUSES: readonly number[] = [500, 502, 503, 504];
/** 默认可重试的幂等方法（大写） */
export const DEFAULT_RETRY_METHODS: readonly string[] = ["GET", "PUT", "HEAD", "DELETE", "OPTIONS"];

/** 内核直接具备的能力（不再是插件）：取消、key 服务、归一化响应、日志开关 */
export const KERNEL_CAPABILITIES: readonly string[] = ["cancel", "key", "normalize", "log"];
/** 由内置插件提供的能力 */
export const PLUGIN_CAPABILITIES: readonly string[] = ["auth", "cache", "retry", "share", "loading", "mock", "notify", "repath", "filter", "envs"];
/** axp 具备的能力名（CONTRACT §7，内核 + 插件）；不在其中的能力，场景直接跳过 */
export const SUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set([...PLUGIN_CAPABILITIES, ...KERNEL_CAPABILITIES]);
