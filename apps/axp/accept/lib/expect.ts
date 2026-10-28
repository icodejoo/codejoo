import type { NetworkName, Style } from "./constants.ts";
import type { Expectation, Scenario } from "./types.ts";

/** 通配键：对所有网络生效 */
const WILDCARD = "*";

/**
 * 按优先级给出候选键，从低到高：`*` < `*@风格` < `网络` < `网络@风格`。
 * @param network 网络预设名
 * @param style 响应风格
 */
export function expectKeys(network: NetworkName, style: Style): string[] {
  return [WILDCARD, `${WILDCARD}@${style}`, network, `${network}@${style}`];
}

/**
 * 合并某个 网络×风格 组合下的预期：优先级 网络@风格 > 网络 > *@风格 > *，
 * 高优先级的同名顶层字段整体覆盖低优先级（schema："具体预设覆盖 '*' 的同名字段"）。
 * @param scenario 场景
 * @param network 网络预设名
 * @param style 响应风格
 * @returns 合并后的预期；没有任何键命中时返回 null
 * @example resolveExpectation(sc, 'normal', 'business')
 */
export function resolveExpectation(scenario: Scenario, network: NetworkName, style: Style): Expectation | null {
  const merged: Expectation = {};
  let matched = false;
  for (const key of expectKeys(network, style)) {
    const e = scenario.expect[key];
    if (!e) continue;
    Object.assign(merged, e);
    matched = true;
  }
  return matched ? merged : null;
}
