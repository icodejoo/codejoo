import type { Style } from "./constants.ts";
import type { LoginSpec, NetworkValue, RequestSpec, RevokeSpec, SetTokenSpec, Step } from "./types.ts";
import { stepKind } from "./walk.ts";

/**
 * step 解释器依赖的执行环境。解释器只负责"怎么编排"（并行、顺序、重复、后台），
 * 具体动作（发请求、登录、切网络……）全部由环境实现，因此可以用假环境做单测。
 */
export interface StepEnv {
  /** 等待若干毫秒 */
  sleep(ms: number): Promise<void>;
  /** 发请求并记录结果；请求失败不抛错，只有执行器自身出错才抛 */
  request(spec: RequestSpec, idSuffix: string): Promise<void>;
  /** 旁路登录并把令牌写入客户端 */
  login(spec: LoginSpec): Promise<void>;
  /** 篡改客户端持有的令牌 */
  setToken(spec: SetTokenSpec): void;
  /** 旁路登出并清空客户端令牌 */
  logout(): Promise<void>;
  /** 旁路让服务端强制下线 */
  revoke(spec: RevokeSpec): Promise<void>;
  /** 把客户端 access 换成已过期但签名合法的值 */
  expireLocal(): Promise<void>;
  /** 取消全部在途请求 */
  cancelAll(): void;
  /** 清空缓存 */
  clearCache(): void;
  /** 运行中切换网络 */
  network(value: NetworkValue): Promise<void>;
  /** 切换响应风格 */
  style(style: Style): void;
  /** 旁路清空服务端本轮状态 */
  serverReset(): Promise<void>;
}

/** 解释器的运行状态：fire 出去的后台任务及其错误 */
export interface StepState {
  fired: Promise<void>[];
  errors: string[];
}

/** 创建空的运行状态 */
export function newStepState(): StepState {
  return { fired: [], errors: [] };
}

/**
 * 给请求 id 追加 repeat 产生的后缀。
 * @param id 原始 id
 * @param suffix 累计后缀（如 `#2` 或 `#1#0`）
 * @example withSuffix('r', '#3') // 'r#3'
 */
export function withSuffix(id: string, suffix: string): string {
  return `${id}${suffix}`;
}

/**
 * 解释并执行一个 step（全部 16 种）。
 * - `parallel`：同时启动，全部落定后返回；
 * - `sequence`：依次执行；
 * - `fire`：启动后立即返回，任务记到 state，由 `drainFired` 在场景结束前统一等待；
 * - `repeat`：依次执行 times 次，id_suffix 不为 false 时给内部请求 id 追加 `#i`；
 * - `cancel_all`：先等 after_ms 再取消；
 * - 其余 step 直接交给环境。
 * @param step 要执行的 step
 * @param env 执行环境
 * @param state 运行状态
 * @param suffix 当前累计的 id 后缀（repeat 嵌套时使用）
 * @throws 未知 step 类型，或环境动作抛出的错误
 * @example await runStep({ parallel: [{ wait: 10 }, { wait: 20 }] }, env, newStepState())
 */
export async function runStep(step: Step, env: StepEnv, state: StepState, suffix = ""): Promise<void> {
  const kind = stepKind(step);
  const s = step as unknown as Record<string, never>;
  switch (kind) {
    case "request":
      return env.request(s.request, suffix);
    case "parallel": {
      await Promise.all((s.parallel as Step[]).map((x) => runStep(x, env, state, suffix)));
      return;
    }
    case "sequence": {
      for (const x of s.sequence as Step[]) await runStep(x, env, state, suffix);
      return;
    }
    case "fire": {
      const task = runStep(s.fire as Step, env, state, suffix).catch((e: unknown) => {
        state.errors.push(`fire 内部出错: ${(e as Error).message}`);
      });
      state.fired.push(task);
      return;
    }
    case "repeat": {
      const r = s.repeat as { times: number; step: Step; id_suffix?: boolean };
      for (let i = 0; i < r.times; i++) await runStep(r.step, env, state, r.id_suffix === false ? suffix : `${suffix}#${i}`);
      return;
    }
    case "wait":
      return env.sleep(s.wait as number);
    case "login":
      return env.login(s.login);
    case "set_token":
      return env.setToken(s.set_token);
    case "logout":
      return env.logout();
    case "revoke":
      return env.revoke(s.revoke);
    case "expire_local":
      return env.expireLocal();
    case "cancel_all": {
      const after = (s.cancel_all as { after_ms?: number }).after_ms ?? 0;
      if (after > 0) await env.sleep(after);
      env.cancelAll();
      return;
    }
    case "clear_cache":
      return env.clearCache();
    case "network":
      return env.network(s.network);
    case "style":
      return env.style(s.style as Style);
    case "server_reset":
      return env.serverReset();
    default:
      throw new Error(`未知 step: ${JSON.stringify(Object.keys(step))}`);
  }
}

/**
 * 等待所有 fire 出去的后台任务落定（场景结束前统一等待）。
 * fire 里还可能再 fire，所以循环直到没有新任务。
 * @param state 运行状态
 */
export async function drainFired(state: StepState): Promise<void> {
  while (state.fired.length) {
    const batch = state.fired.splice(0);
    await Promise.all(batch);
  }
}
