import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 包根目录 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 判断产物是否过期时对照的标志文件（最后生成的 d.ts 之一） */
const STAMP = path.join(ROOT, "dist/core.d.mts");

/**
 * 递归取目录下最新的修改时间
 * @param dir 目录
 * @returns 毫秒时间戳；目录不存在时为 0
 * @example newest("src");
 */
function newest(dir: string): number {
  if (!existsSync(dir)) return 0;
  let max = 0;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    max = Math.max(max, st.isDirectory() ? newest(full) : st.mtimeMs);
  }
  return max;
}

/**
 * vitest 全局准备：依赖 dist 的测试（类型测试、条件导出、打包器 fixture）开跑前，
 * dist 不存在或比源码 / 构建配置旧就先 pnpm build 一次，避免在并行的测试文件里各自构建互相踩。
 */
export default function setup(): void {
  const built = existsSync(STAMP) ? statSync(STAMP).mtimeMs : 0;
  const sources = Math.max(newest(path.join(ROOT, "src")), statSync(path.join(ROOT, "package.json")).mtimeMs, statSync(path.join(ROOT, "vite.config.ts")).mtimeMs);
  if (built >= sources) return;
  console.log("[test] dist 缺失或已过期，先执行 pnpm build");
  execSync("pnpm build", { cwd: ROOT, stdio: "inherit" });
}
