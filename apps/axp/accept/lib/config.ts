import path from "node:path";
import { parseArgs } from "node:util";
import { ALL_ADAPTERS, ALL_NETWORKS, ALL_STYLES, DEFAULT_NETEM, DEFAULT_SCENARIOS, DEFAULT_SERVER, ENV_NETEM, ENV_SCENARIOS, ENV_SERVER } from "./constants.ts";
import type { AdapterName, NetworkName, Style } from "./constants.ts";

/** 过滤条件：空数组表示不过滤 */
export interface Filters {
  /** 场景 id 前缀 */
  ids: string[];
  networks: NetworkName[];
  styles: Style[];
  adapters: AdapterName[];
}

/** 执行器的完整配置 */
export interface AcceptConfig {
  server: string;
  netem: string;
  /** 场景目录（绝对路径） */
  scenarios: string;
  filters: Filters;
  dry: boolean;
  /** 并行运行数 */
  jobs: number;
  /** 报告目录（绝对路径） */
  reportDir: string;
  /** 逐条输出通过项 */
  verbose: boolean;
}

/** 默认报告目录名（相对 accept/） */
export const REPORT_DIR_NAME = ".report";

/** 把逗号分隔字符串拆成去空白的数组 */
export function splitList(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 校验并收窄枚举型过滤值；出现未知值直接抛错，避免静默过滤成空集。
 * @param label 过滤项名称，用于报错
 * @param values 用户输入
 * @param allowed 合法取值
 * @returns 收窄后的数组
 */
export function pickEnum<T extends string>(label: string, values: string[], allowed: readonly T[]): T[] {
  for (const v of values) {
    if (!(allowed as readonly string[]).includes(v)) throw new Error(`未知的${label}: ${v}（可选 ${allowed.join(", ")}）`);
  }
  return values as T[];
}

/**
 * 解析命令行与环境变量。命令行优先于环境变量。
 * @param argv 命令行参数（不含 node 与脚本）
 * @param env 环境变量表
 * @param cwd 解析相对路径的基准目录
 * @param acceptDir accept/ 目录绝对路径，用于默认报告目录
 * @returns 完整配置
 * @example parseConfig(['--dry', '--id', 'auth.'], process.env, process.cwd(), acceptDir)
 */
export function parseConfig(argv: string[], env: Record<string, string | undefined>, cwd: string, acceptDir: string): AcceptConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      dry: { type: "boolean", default: false },
      id: { type: "string" },
      network: { type: "string" },
      style: { type: "string" },
      adapter: { type: "string" },
      jobs: { type: "string" },
      "report-dir": { type: "string" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const jobs = Number(values.jobs ?? env.TESTKIT_JOBS ?? 1);
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`--jobs 必须是正整数: ${values.jobs}`);
  return {
    server: (env[ENV_SERVER] || DEFAULT_SERVER).replace(/\/+$/, ""),
    netem: (env[ENV_NETEM] || DEFAULT_NETEM).replace(/\/+$/, ""),
    scenarios: path.resolve(cwd, env[ENV_SCENARIOS] || DEFAULT_SCENARIOS),
    filters: {
      ids: splitList(values.id ?? env.TESTKIT_ID),
      networks: pickEnum("网络", splitList(values.network ?? env.TESTKIT_NETWORK), ALL_NETWORKS),
      styles: pickEnum("风格", splitList(values.style ?? env.TESTKIT_STYLE), ALL_STYLES),
      adapters: pickEnum("adapter", splitList(values.adapter ?? env.TESTKIT_ADAPTER), ALL_ADAPTERS),
    },
    dry: values.dry === true,
    jobs,
    reportDir: path.resolve(cwd, values["report-dir"] ?? path.join(acceptDir, REPORT_DIR_NAME)),
    verbose: values.verbose === true,
  };
}
