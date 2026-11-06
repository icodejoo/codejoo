import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, runVitest } from "./test-infra.mjs";

// 清除旧报告，防止失败运行误读上次结果；目标固定在项目 coverage 目录。
rmSync(resolve(ROOT, "coverage"), { recursive: true, force: true });
process.exitCode = runVitest(["-c", "scripts/vitest.all.config.ts", "--coverage", ...process.argv.slice(2)]);
