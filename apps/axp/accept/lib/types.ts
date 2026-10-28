import type { AdapterName, NetworkName, Style } from './constants.ts';

/** 中立能力名 */
export type Capability = string;

/** 区间断言：eq / min / max */
export interface Range { eq?: number; min?: number; max?: number }

/** 单条请求结果预期 */
export interface ResultExpect {
  ok?: boolean;
  error?: string | string[];
  data?: unknown;
  hit?: number;
  from_cache?: boolean;
}

/** 服务端观测预期 */
export interface ServerExpect {
  total?: Range;
  by_key?: Record<string, Range>;
  by_path?: Record<string, Range>;
  peak_inflight?: Range;
  aborted?: Range;
}

/** 客户端事件预期 */
export interface ClientExpect {
  loading?: boolean[];
  notify?: Range;
  refresh?: Range;
  expired?: Range;
  denied?: Range;
  pending_after?: Range;
}

/** 一个网络/风格组合下的预期 */
export interface Expectation {
  skip?: string;
  results?: Record<string, ResultExpect>;
  order?: string[];
  server?: ServerExpect;
  client?: ClientExpect;
  duration_ms?: Range;
}

/** 中立的请求级选项 */
export interface RequestOptions {
  auth?: boolean;
  cache?: boolean | { ttl_ms?: number; key?: string };
  retry?: number | boolean | { max?: number; delay_ms?: number; statuses?: number[]; methods?: string[]; respect_retry_after?: boolean };
  share?: boolean | 'start' | 'end' | 'race' | 'none';
  loading?: boolean;
  silent?: boolean;
  timeout_ms?: number;
  key?: boolean | string;
  mock?: boolean;
  normalize?: boolean;
  filter?: boolean;
  breaker?: boolean;
}

/** 请求 step */
export interface RequestSpec {
  id: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  options?: RequestOptions;
  cancel_after_ms?: number;
}

/** login step 参数 */
export interface LoginSpec {
  user?: string;
  password?: string;
  access_ttl_ms?: number;
  refresh_ttl_ms?: number;
  strict_rotation?: boolean;
}

/** set_token 里 access 的取值 */
export type AccessTokenMode = 'none' | 'empty' | 'garbage' | 'bad_signature' | 'tampered_payload' | 'wrong_scheme' | 'previous' | 'keep';
/** set_token 里 refresh 的取值 */
export type RefreshTokenMode = 'none' | 'garbage' | 'previous' | 'keep';
/** set_token step 参数 */
export interface SetTokenSpec { access?: AccessTokenMode; refresh?: RefreshTokenMode }
/** revoke step 参数 */
export interface RevokeSpec { user?: string; scope?: 'all' | 'access' }
/** network step 的取值：预设名或 netem profile 对象 */
export type NetworkValue = NetworkName | Record<string, unknown>;

/** step：恰好一个键 */
export type Step =
  | { request: RequestSpec }
  | { parallel: Step[] }
  | { sequence: Step[] }
  | { fire: Step }
  | { repeat: { times: number; step: Step; id_suffix?: boolean } }
  | { wait: number }
  | { login: LoginSpec }
  | { set_token: SetTokenSpec }
  | { logout: Record<string, never> }
  | { revoke: RevokeSpec }
  | { expire_local: Record<string, never> }
  | { cancel_all: { after_ms?: number } }
  | { clear_cache: Record<string, never> }
  | { network: NetworkValue }
  | { server_reset: Record<string, never> }
  | { style: Style };

/** 中立插件配置：能力名 → 选项 */
export type PluginConfigs = Record<string, Record<string, unknown>>;

/** 一个场景（对应 scenario.schema.json） */
export interface Scenario {
  id: string;
  title: string;
  why?: string;
  tags?: string[];
  requires: Capability[];
  networks: NetworkName[];
  styles?: Style[];
  timeout_ms?: number;
  client?: { base_timeout_ms?: number; plugins?: PluginConfigs };
  steps: Step[];
  expect: Record<string, Expectation>;
  /** 加载时补充：来源文件名 */
  file?: string;
}

/** 跳过原因分类 */
export type SkipCategory = 'missing-capability' | 'not-applicable';

/** 运行计划里的一项：场景 × 网络 × 风格 × adapter */
export interface PlanEntry {
  key: string;
  scenario: Scenario;
  network: NetworkName;
  style: Style;
  adapter: AdapterName;
  /** run：执行；skip：跳过并给出原因 */
  decision: { kind: 'run' } | { kind: 'skip'; reason: string; category: SkipCategory };
  /** 中立选项映射不了的问题（空数组表示都能映射） */
  issues: string[];
}

/** 单次运行的最终状态 */
export type RunStatus = 'passed' | 'failed' | 'skipped';

/** 单次运行的结果 */
export interface RunResult {
  key: string;
  scenarioId: string;
  domain: string;
  network: NetworkName;
  style: Style;
  adapter: AdapterName;
  status: RunStatus;
  /** 失败原因（逐条）或跳过原因 */
  reasons: string[];
  durationMs: number;
  runId?: string;
}
