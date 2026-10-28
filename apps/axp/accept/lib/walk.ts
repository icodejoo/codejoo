import type { RequestSpec, Step } from "./types.ts";

/** 所有 step 类型名，执行器必须全部实现 */
export const STEP_KINDS = ["request", "parallel", "sequence", "fire", "repeat", "wait", "login", "set_token", "logout", "revoke", "expire_local", "cancel_all", "clear_cache", "network", "server_reset", "style"] as const;

/** step 类型名 */
export type StepKind = (typeof STEP_KINDS)[number];

/**
 * 取 step 的类型名（step 恰好一个键）。
 * @param step 任意 step
 * @returns 键名；结构非法时返回 undefined
 */
export function stepKind(step: Step): StepKind | undefined {
  const keys = Object.keys(step);
  return keys.length === 1 ? (keys[0] as StepKind) : undefined;
}

/**
 * 深度遍历 step 树，对每个节点调用回调（含 parallel/sequence/fire/repeat 的内层）。
 * @param steps 起始 step 列表
 * @param visit 回调，参数为 step 与其类型名
 */
export function walkSteps(steps: Step[], visit: (step: Step, kind: StepKind | undefined) => void): void {
  for (const s of steps) {
    const kind = stepKind(s);
    visit(s, kind);
    if (kind === "parallel") walkSteps((s as { parallel: Step[] }).parallel, visit);
    else if (kind === "sequence") walkSteps((s as { sequence: Step[] }).sequence, visit);
    else if (kind === "fire") walkSteps([(s as { fire: Step }).fire], visit);
    else if (kind === "repeat") walkSteps([(s as { repeat: { step: Step } }).repeat.step], visit);
  }
}

/**
 * 收集 step 树中的全部请求（不展开 repeat，仅返回模板）。
 * @param steps step 列表
 */
export function collectRequests(steps: Step[]): RequestSpec[] {
  const out: RequestSpec[] = [];
  walkSteps(steps, (s, kind) => {
    if (kind === "request") out.push((s as { request: RequestSpec }).request);
  });
  return out;
}
