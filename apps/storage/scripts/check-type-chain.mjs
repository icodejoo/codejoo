import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { ROOT } from "./test-infra.mjs";

/** 在隔离临时项目中实测 oxlint 的 TS2578 和 expectTypeOf 诊断，避免运行 tsgo。 */
function main() {
  const parent = resolve(ROOT, "scripts");
  const directory = mkdtempSync(resolve(parent, "d-type-probe-"));
  if (!directory.startsWith(parent + sep)) throw new Error("拒绝清理范围外的探针目录");
  try {
    const probe = resolve(directory, "probe.ts");
    writeFileSync(
      probe,
      [
        'import { expectTypeOf } from "vitest";',
        "// @ts-expect-error 此行无错误，必须报 TS2578。",
        "export const unusedSuppression: number = 1;",
        "expectTypeOf<string>().toEqualTypeOf<number>();",
        "// @ts-expect-error 真错误必须被抑制。",
        'export const validSuppression: number = "bad";',
      ].join("\n"),
    );
    const config = resolve(directory, "tsconfig.json");
    writeFileSync(config, JSON.stringify({ extends: "../../tsconfig.json", include: ["probe.ts"] }));
    const require = createRequire(import.meta.url);
    const entry = resolve(require.resolve("vite-plus/package.json"), "../bin/vp");
    const result = spawnSync(process.execPath, [entry, "lint", "-c", "oxlint.config.ts", "--tsconfig", config, "--format=json", probe], { cwd: ROOT, encoding: "utf8" });
    if (result.error) throw result.error;
    const report = JSON.parse(result.stdout);
    const diagnostics = report.diagnostics.filter((item) => item.severity === "error");
    const unused = diagnostics.some((item) => item.code === "typescript(TS2578)");
    const typeAssertion = diagnostics.some((item) => item.code?.startsWith("typescript(") && item.labels?.some((label) => label.span?.line === 4));
    const incorrectlyUnsuppressed = diagnostics.some((item) => item.labels?.some((label) => label.span?.line === 6));
    console.log(`[type-chain] TS2578=${unused}; expectTypeOf 错配诊断=${typeAssertion}; 有效 @ts-expect-error 被尊重=${!incorrectlyUnsuppressed}`);
    if (!unused || !typeAssertion || incorrectlyUnsuppressed) {
      console.error(result.stdout, result.stderr);
      return 1;
    }
    return 0;
  } finally {
    // 仅删除由 mkdtemp 创建且确认位于本项目 scripts 内的探针目录。
    rmSync(directory, { recursive: true, force: true });
  }
}

process.exitCode = main();
