import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/** 包根目录 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 类型测试工程所在目录（依赖 dist，由 test/global-setup.ts 保证产物是新的） */
const TYPES_DIR = "test/types";

/** tsgo 的 JS 入口：直接用 node 启动，免得 Windows 上去碰 .cmd 垫片 */
const TSGO = path.join(path.dirname(createRequire(import.meta.url).resolve("@typescript/native-preview/package.json")), "bin/tsgo.js");

/** 不读 tsconfig（否则 "skeletonizer" 会被 paths 指到源码），按 dist 的 d.ts + package.json exports 解析包名自引用；--skipLibCheck 另外追加 */
const TSC_ARGS = ["--ignoreConfig", "--noEmit", "--module", "esnext", "--moduleResolution", "bundler", "--strict", "--lib", "dom,esnext"];

/** 一个编译场景 */
interface Scenario {
  /** 要编译的文件（相对包根） */
  files: string[];
  /** 是否连库的 d.ts 一起检查（慢，只留一个场景做；其余都是同一批 d.ts 的重复检查） */
  libCheck?: boolean;
}

/**
 * 编译场景表：每个入口对（带 CSS 版与 /js 版）只验一个——两版的 d.ts 一字不差，/js 的 d.ts 是否存在由 dist.test.ts 的 exports 检查兜底。
 * 场景相互独立，beforeAll 里并发编译。
 */
const SCENARIOS: Record<string, Scenario> = {
  coreOnly: { files: [`${TYPES_DIR}/core-only.ts`] },
  full: { files: [`${TYPES_DIR}/via-full.ts`, `${TYPES_DIR}/full-assertions.ts`] },
  global: { files: [`${TYPES_DIR}/via-global.ts`, `${TYPES_DIR}/full-assertions.ts`] },
  svg: { files: [`${TYPES_DIR}/via-svg.ts`, `${TYPES_DIR}/full-assertions.ts`] },
  // 只有这个场景连库的 d.ts 一起检查
  all: { files: [`${TYPES_DIR}/via-all.ts`, `${TYPES_DIR}/full-assertions.ts`], libCheck: true },
  // 反向对照：core-only 与完整版入口同处一个工程
  mixed: { files: [`${TYPES_DIR}/core-only.ts`, `${TYPES_DIR}/via-full.ts`] },
};

/**
 * 用 tsgo 异步编译一组文件，返回编译器输出（空串 = 通过）
 * @param scenario 编译场景
 * @returns 报错文本
 * @example await compile({ files: ["test/types/core-only.ts"] }); // ""
 */
function compile(scenario: Scenario): Promise<string> {
  const args = [TSGO, ...TSC_ARGS, "--skipLibCheck", String(!scenario.libCheck), ...scenario.files];
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: ROOT, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve(err ? `${stdout}${stderr}`.trim() || err.message : "");
    });
  });
}

/** 各场景的编译输出 */
const outputs: Record<string, string> = {};

beforeAll(async () => {
  const names = Object.keys(SCENARIOS);
  const results = await Promise.all(names.map((n) => compile(SCENARIOS[n])));
  names.forEach((n, i) => (outputs[n] = results[i]!));
}, 120_000);

describe("类型扩展（基于 dist 的 d.ts）", () => {
  it("只导入 core：text / engine / fallback / sweep / registerCustomElements 都报错，core 自己的选项和全局 skz.bone 有类型", () => {
    expect(outputs.coreOnly).toBe("");
  });

  // 每个入口（带 CSS 版与 /js 版共用一份 d.ts）一条：导入后 core 类型自动变宽，适配层 props 同步变化
  for (const entry of ["full", "global", "svg", "all"]) {
    it(`导入 ${entry} 入口后：text / engine / fallback / sweep / skz.registerCustomElements 通过，取值仍受限`, () => {
      expect(outputs[entry]).toBe("");
    });
  }

  it("反向对照：core-only 与完整版入口同处一个工程时，那些预期报错的写法不再报错（证明增强确实生效）", () => {
    expect(outputs.mixed).toContain("Unused '@ts-expect-error' directive");
  });
});
