import { sleep } from './http.ts';
import { checkServer, evaluateLocal } from './assertions.ts';
import type { Observed } from './assertions.ts';
import { createClient } from './client-factory.ts';
import type { AcceptConfig } from './config.ts';
import {
  DEFAULT_RUN_TIMEOUT_MS, DNS_FAIL_HOST, INFLIGHT_DRAIN_MS, SERVER_RETRY_INTERVAL_MS, SERVER_RETRY_MS,
} from './constants.ts';
import type { NetworkName } from './constants.ts';
import { resolveExpectation } from './expect.ts';
import { EventLog, PendingTracker } from './events.ts';
import { domainOf } from './loader.ts';
import type { Observation } from './matchers.ts';
import { openProxy, swapHost } from './netem-client.ts';
import type { NetemClient } from './netem-client.ts';
import { RunEnvironment } from './run-env.ts';
import type { ProxyEndpoint } from './run-env.ts';
import { makeRunId, ServerClient } from './server-client.ts';
import { drainFired, newStepState, runStep } from './steps.ts';
import { TokenStore } from './tokens.ts';
import type { Expectation, PlanEntry, RunResult, Scenario } from './types.ts';

/** 执行一次运行所需的共享依赖 */
export interface RunnerDeps {
  config: AcceptConfig;
  netem: NetemClient;
  /** 本次执行器进程的会话标识（runId 前缀） */
  session: string;
}

/** 超时哨兵 */
const TIMEOUT = Symbol('run-timeout');

/** 等待指定毫秒 */

/**
 * 并发上限内批量执行异步任务，结果顺序与输入一致。
 * @param items 输入
 * @param limit 并发数
 * @param fn 处理函数
 */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 等 loading 的延迟关闭定时器触发后再取事件快照的余量 */
const LOADING_CLOSE_MARGIN_MS = 60;

/**
 * 场景结束后、取事件快照前需要额外等待的时间：loading 配了 delay_close_ms 时，
 * 最后一个 hide 要在最后一个请求结束后过 delay_close_ms 才触发，不等的话会误判"loading 未成对"。
 * @param sc 场景
 * @returns 毫秒数，没有延迟关闭时为 0
 */
export function settleDelayMs(sc: Scenario): number {
  const close = Number((sc.client?.plugins?.loading as { delay_close_ms?: number } | undefined)?.delay_close_ms ?? 0);
  return close > 0 ? close + LOADING_CLOSE_MARGIN_MS : 0;
}

/** 收集声明了 from_cache 的请求 id（需要探测是否到达服务器） */
export function reachIdsOf(exp: Expectation): Set<string> {
  return new Set(Object.entries(exp.results ?? {}).filter(([, r]) => r.from_cache !== undefined).map(([id]) => id));
}

/**
 * 反复观测服务端直到断言通过或超时。
 * 服务端有些字段（aborted、peak_inflight）是延迟落账的，所以断言失败时稍等再看。
 * @param read 读取观测的函数
 * @param check 断言函数，返回失败原因
 * @returns 最后一次的观测与失败原因
 */
export async function observeUntil(
  read: () => Promise<Observation>,
  check: (obs: Observation) => string[],
): Promise<{ obs: Observation; fails: string[] }> {
  const deadline = Date.now() + SERVER_RETRY_MS;
  for (;;) {
    const obs = await read();
    const fails = check(obs);
    if (!fails.length || Date.now() >= deadline) return { obs, fails };
    await sleep(SERVER_RETRY_INTERVAL_MS);
  }
}

/**
 * 执行计划里的一项运行：建代理 → 组装客户端 → 解释 steps → 断言 → 通用断言 → 清理。
 * 任何基础设施错误（netem 连不上、服务器连不上）都归为 failed，并写明原因。
 * @param entry 计划条目（decision 必须是 run）
 * @param seq 本次运行的序号（用于 runId）
 * @param deps 共享依赖
 * @returns 运行结果：通过或失败（跳过的条目不应传入）
 */
export async function runEntry(entry: PlanEntry, seq: number, deps: RunnerDeps): Promise<RunResult> {
  const { scenario: sc, network, style, adapter } = entry;
  const base = { key: entry.key, scenarioId: sc.id, domain: domainOf(sc.id), network, style, adapter };
  const started = Date.now();
  const fail = (reasons: string[], runId?: string): RunResult => ({ ...base, status: 'failed', reasons, durationMs: Date.now() - started, runId });

  const exp = resolveExpectation(sc, network, style);
  if (!exp) return fail(['没有匹配的预期（expect 未覆盖该网络与风格）']);
  if (entry.issues.length) return fail(entry.issues.map((i) => `映射不了: ${i}`));

  const runId = makeRunId(deps.session, seq, sc.id);
  const server = new ServerClient(deps.config.server, runId, style);
  const events = new EventLog();
  const tracker = new PendingTracker();
  const tokens = new TokenStore();
  const open = (n: string): Promise<ProxyEndpoint> => openProxy(deps.netem, deps.config.server, n as NetworkName);
  let proxy: ProxyEndpoint | undefined;
  try {
    if (network !== 'dns') proxy = await open(network);
  } catch (e) {
    return fail([`netem: ${(e as Error).message}`], runId);
  }
  const client = createClient({
    adapter,
    baseURL: proxy ? proxy.baseURL : swapHost(deps.config.server, DNS_FAIL_HOST),
    baseTimeoutMs: sc.client?.base_timeout_ms,
    plugins: sc.client?.plugins,
    tokens,
    hooks: {
      loading: events.onLoading,
      notify: events.onNotify,
      refresh: events.onRefresh,
      expired: (t) => events.onExpired(t),
      denied: (t) => events.onDenied(t),
      unauthenticated: (t) => events.onUnauthenticated(t),
      expiredMarked: (t) => events.markExpired(t),
    },
    getStyle: () => server.style,
    runId,
  });
  const env = new RunEnvironment({
    client, server, netem: deps.netem, tokens, events, tracker,
    serverUrl: deps.config.server,
    proxy,
    reachIds: reachIdsOf(exp),
    openProxy: open,
  });

  const reasons: string[] = [];
  const state = newStepState();
  const timeoutMs = sc.timeout_ms ?? DEFAULT_RUN_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t0 = Date.now();
  try {
    const body = (async () => {
      for (const step of sc.steps) await runStep(step, env, state);
      await drainFired(state);
    })();
    const outcome = await Promise.race([
      body.then(() => undefined),
      new Promise<typeof TIMEOUT>((r) => { timer = setTimeout(() => r(TIMEOUT), timeoutMs); }),
    ]);
    if (outcome === TIMEOUT) reasons.push(`运行超过 ${timeoutMs}ms 仍未结束`);
  } catch (e) {
    reasons.push(`step 执行出错: ${(e as Error).message}`);
  } finally {
    if (timer) clearTimeout(timer);
    env.stopped = true;
  }
  const durationMs = Date.now() - t0;
  reasons.push(...state.errors);
  const settle = settleDelayMs(sc);
  if (settle) await sleep(settle);

  const observed: Observed = {
    records: env.records,
    order: env.order,
    events: events.snapshot(),
    pendingAfter: tracker.pending(),
    durationMs,
  };
  reasons.push(...evaluateLocal(exp, observed));

  try {
    const { fails } = await observeUntil(() => server.observe(), (obs) => checkServer(exp.server, obs));
    reasons.push(...fails);
  } catch (e) {
    reasons.push(`服务端观测失败: ${(e as Error).message}`);
  }

  client.dispose();
  const finalProxy = env.proxy;
  if (finalProxy) {
    try { await deps.netem.deleteProxy(finalProxy.id); } catch (e) { reasons.push(`netem 清理失败: ${(e as Error).message}`); }
  }
  const inflight = await drainInflight(server);
  if (inflight !== 0) reasons.push(`通用: 服务端 inflight=${inflight}，应为 0`);
  try { await server.reset(); } catch { /* 清理失败不影响结论 */ }

  const unique = [...new Set(reasons)];
  return { ...base, status: unique.length ? 'failed' : 'passed', reasons: unique, durationMs: Date.now() - started, runId };
}

/**
 * 等服务端 inflight 归零（代理关闭连接后需要一点时间）。
 * @param server 服务端客户端
 * @returns 最后观测到的 inflight；观测失败返回 0（观测问题已在别处报告）
 */
async function drainInflight(server: ServerClient): Promise<number> {
  const deadline = Date.now() + INFLIGHT_DRAIN_MS;
  let last = 0;
  for (;;) {
    try { last = (await server.observe()).inflight; } catch { return 0; }
    if (last === 0 || Date.now() >= deadline) return last;
    await sleep(SERVER_RETRY_INTERVAL_MS);
  }
}
