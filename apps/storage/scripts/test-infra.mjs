import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/** 项目根目录，所有命令都与调用者 cwd 无关。 */
export const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 规范化 Windows/Linux 文件位置，供报告与矩阵比较。 */
export function location(path, root = ROOT) {
  return relative(root, resolve(root, path)).replaceAll("\\", "/");
}

/** 递归列举文件；不存在的目录直接报错，避免空集合误通过。 */
export function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** 读取 Markdown 指定二级章节，禁止从别的章节借用白名单。 */
export function section(markdown, name) {
  const heading = `## ${name}`;
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`验收文档缺少章节: ${heading}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** 直接执行已安装的 vp JavaScript 入口，无 shell 拼接。 */
export function runVitest(args) {
  const require = createRequire(import.meta.url);
  const entry = resolve(require.resolve("vite-plus/package.json"), "../bin/vp");
  const result = spawnSync(process.execPath, [entry, "test", "run", ...args], { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** 读取 JSON 文件；空/损坏文件交由调用方输出明确错误。 */
export function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** 判断当前模块是否由 Node 命令行直接运行。 */
export function isMain(url) {
  return !!process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);
}
