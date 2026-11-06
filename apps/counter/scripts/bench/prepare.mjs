// 准备「前后对比」基准：把 git 基线（默认 HEAD）与当前工作区的 src 各打成一个 iife 包，放进 .bench/ 供 run / tick / hidden 脚本使用。
// 用法：node scripts/bench/prepare.mjs [baseRef=HEAD]
import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const out = join(root, ".bench");
const ref = process.argv[2] ?? "HEAD";

// 经 vite-plus 解析 rolldown（本包没有直接依赖它）
const requireFromVitePlus = createRequire(createRequire(join(root, "package.json")).resolve("vite-plus/package.json"));
const rolldown = await import(pathToFileURL(requireFromVitePlus.resolve("rolldown")).href);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "base"), { recursive: true });
mkdirSync(join(out, "cur"), { recursive: true });

// 基线：git archive 导出 <ref> 的 src
const prefix = execFileSync("git", ["rev-parse", "--show-prefix"], { cwd: root, encoding: "utf8" }).trim();
// 在仓库顶层执行：子目录里 git archive 的 pathspec 会再叠加当前目录前缀
const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).trim();
const tar = execFileSync("git", ["archive", `${ref}:${prefix}`, "src"], { cwd: top, maxBuffer: 64 * 1024 * 1024 });
const tmp = mkdtempSync(join(tmpdir(), "bench-base-"));
execFileSync("tar", ["-x"], { input: tar, cwd: tmp }); // 用 cwd 而非 -C：GNU tar 会把 C:\ 当成远程主机
cpSync(join(tmp, "src"), join(out, "base", "src"), { recursive: true }); // 临时目录与仓库可能不在同一磁盘，不能用 rename
rmSync(tmp, { recursive: true, force: true });
// 当前：工作区 src
cpSync(join(root, "src"), join(out, "cur", "src"), { recursive: true });

const entry = `import countdown, { tick as cdTick } from "./src/count-down/count-down";
import countup, { tick as cuTick } from "./src/count-up/count-up";
import { createRingRender } from "./src/plugins/ring";
import { createCardRender } from "./src/plugins/card";
import { createOdometerRender } from "./src/plugins/odometer";
(window as unknown as Record<string, unknown>).GTB = { countdown, countup, cdTick, cuTick, createRingRender, createCardRender, createOdometerRender };
`;
for (const v of ["base", "cur"]) {
  writeFileSync(join(out, v, "entry.ts"), entry);
  await rolldown.build({ input: join(out, v, "entry.ts"), output: { file: join(out, `${v}.js`), format: "iife" }, logLevel: "silent" });
  console.log("built", v, v === "base" ? `(ref ${ref})` : "(working tree)");
}
copyFileSync(join(import.meta.dirname, "page.html"), join(out, "bench.html"));
for (const f of readdirSync(join(root, "src", "plugins")).filter((n) => n.endsWith(".css"))) copyFileSync(join(root, "src", "plugins", f), join(out, f));
