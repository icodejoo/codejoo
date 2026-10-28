import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Scenario } from "./types.ts";

/** 校验脚本相对场景目录的位置（testkit/tools/validate.mjs） */
const VALIDATE_REL = path.join("..", "tools", "validate.mjs");

/** 场景加载/校验失败 */
export class LoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoaderError";
  }
}

/** 校验结果 */
export interface ValidateResult {
  /** 是否执行了校验（找不到 validate.mjs 时为 false） */
  ran: boolean;
  ok: boolean;
  /** 校验脚本的输出（失败时为错误清单） */
  output: string;
}

/**
 * 直接调用 testkit 自带的 validate.mjs 校验场景目录，复用它的全部规则，不重写一份。
 * @param dir 场景目录（绝对路径）
 * @returns 校验结果；找不到脚本时 `ran=false` 且视为通过
 */
export function validateScenarios(dir: string): ValidateResult {
  const script = path.resolve(dir, VALIDATE_REL);
  if (!fs.existsSync(script)) return { ran: false, ok: true, output: `未找到 ${script}，跳过校验` };
  const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return { ran: true, ok: r.status === 0, output };
}

/**
 * 读取目录下全部 `*.json` 场景（按文件名排序），并给每个场景补上来源文件名。
 * @param dir 场景目录（绝对路径）
 * @param opts.validate 是否先调用 validate.mjs，默认 true
 * @returns 场景数组
 * @throws LoaderError 目录不存在、JSON 非法、顶层不是数组或校验失败
 */
export function loadScenarios(dir: string, opts: { validate?: boolean } = {}): Scenario[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new LoaderError(`场景目录不存在: ${dir}`);
  if (opts.validate !== false) {
    const v = validateScenarios(dir);
    if (!v.ok) throw new LoaderError(`场景校验失败:\n${v.output}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const all: Scenario[] = [];
  for (const f of files) {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      throw new LoaderError(`${f} 不是合法 JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(data)) throw new LoaderError(`${f} 顶层必须是数组`);
    for (const sc of data as Scenario[]) all.push({ ...sc, file: f });
  }
  return all;
}

/** 场景所属领域：取 id 里第一个点之前的部分，如 `auth.deny-403` → `auth` */
export function domainOf(scenarioId: string): string {
  return scenarioId.split(".")[0] ?? scenarioId;
}
