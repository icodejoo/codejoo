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
  /** 追加的编译参数（如 JSX 设置） */
  args?: string[];
  /** 是否连库的 d.ts 一起检查（慢，只留一个场景做；其余都是同一批 d.ts 的重复检查） */
  libCheck?: boolean;
}

/**
 * 编译场景表：lite 只导入 lite；full 导入完整版（skeletonizer）；mixed 把两者放进同一个工程。场景相互独立，beforeAll 里并发编译。
 */
const SCENARIOS: Record<string, Scenario> = {
  liteOnly: { files: [`${TYPES_DIR}/lite-only.ts`] },
  // 完整版场景连库的 d.ts 一起检查（含 full.d.mts 对 lite.d.mts 的增强与适配层 d.mts）
  full: { files: [`${TYPES_DIR}/via-full.ts`, `${TYPES_DIR}/full-assertions.ts`], libCheck: true },
  // 反向对照：lite-only 与完整版入口同处一个工程
  mixed: { files: [`${TYPES_DIR}/lite-only.ts`, `${TYPES_DIR}/via-full.ts`] },
  // JSX 里的 skz-* 属性：React / Solid 的 JSX 设置互斥，各一个场景
  reactJsxFull: { files: [`${TYPES_DIR}/jsx-react-full.tsx`], args: ["--jsx", "react-jsx"] },
  reactJsxLite: { files: [`${TYPES_DIR}/jsx-react-lite.tsx`], args: ["--jsx", "react-jsx"] },
  solidJsx: { files: [`${TYPES_DIR}/jsx-solid.tsx`], args: ["--jsx", "preserve", "--jsxImportSource", "solid-js"] },
};

/**
 * 用 tsgo 异步编译一组文件，返回编译器输出（空串 = 通过）
 * @param scenario 编译场景
 * @returns 报错文本
 * @example await compile({ files: ["test/types/lite-only.ts"] }); // ""
 */
function compile(scenario: Scenario): Promise<string> {
  const args = [TSGO, ...TSC_ARGS, "--skipLibCheck", String(!scenario.libCheck), ...(scenario.args ?? []), ...scenario.files];
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
  it("只导入 lite：text / engine / fallback 都报错、registerCustomElements 与 skz.defineSkzBox 已移除，wc 入口可用，lite 自己的选项和全局 skz.bone 有类型", () => {
    expect(outputs.liteOnly).toBe("");
  });

  it("导入完整版（skeletonizer）后：lite 类型自动变宽、适配层 props 同步变化，text / engine / fallback 通过、wc 入口可同处使用，取值仍受限", () => {
    expect(outputs.full).toBe("");
  });

  it("反向对照：lite-only 与完整版入口同处一个工程时，那些预期报错的写法不再报错（证明增强确实生效）", () => {
    expect(outputs.mixed).toContain("Unused '@ts-expect-error' directive");
  });
  it('React JSX：skz-* 属性有补全与取值检查（完整版全有，lite 的 skz-text-mode 只有 round / clip，裸属性只收 ""）', () => {
    expect(outputs.reactJsxFull).toBe("");
    expect(outputs.reactJsxLite).toBe("");
  });

  it('Solid JSX：skz-* 属性有补全与取值检查（裸属性收 true / ""，不收 false）', () => {
    expect(outputs.solidJsx).toBe("");
  });
});
