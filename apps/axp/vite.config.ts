import { defineConfig } from "vite-plus";
import type { Rolldown } from "vite-plus";

/** 产物语法目标：ES2015（ADR 0003 定的约束，改它要先和用户确认）；运行时 API 底线另按 ES2019。 */
const TARGET = "es2015";

/** 对外公开的插件子路径名，与 package.json 的 exports 一一对应；新增插件需同步两处。 */
const PLUGIN_NAMES = ["auth", "cache", "envs", "filter", "loading", "mock", "notify", "repath", "retry", "share"] as const;

/** unbundle 产物的插件入口文件。 */
const PLUGIN_ENTRIES = PLUGIN_NAMES.map((name) => `src/plugins/${name}.ts`);

/** 声明产物后缀；`.d.mts` 里的相对说明符必须显式写成 `.mjs` 才能被 nodenext 与 bundler 解析。 */
const DTS_FILE_SUFFIX = ".d.mts";

/** 产物里相对说明符补全后的扩展名。 */
const RUNTIME_EXT = ".mjs";

/** 已带显式扩展名的说明符不再改写，保证幂等。 */
const HAS_EXT_RE = /\.[cm]?[jt]s$/;

/** 匹配声明文件中 `declare module "<相对路径>"`，捕获前缀、引号与路径。 */
const AUGMENTATION_RE = /(\bdeclare\s+module\s+)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

/**
 * 把声明产物里的相对模块扩展说明符补成 `.mjs`。
 *
 * rolldown-plugin-dts 只改写 import/export 的说明符，`declare module "../types"` 会原样保留，
 * 而产物里的目标文件是 `types.d.mts`：nodenext 下无扩展名的相对说明符不可解析，
 * bundler 下也不会去探测 `.d.mts`，结果插件的请求选项类型增强（`retry`、`cache` 等）在消费端失效。
 * 源码里的 `declare module "../types"` 对 tsgo 与 IDE 是正确写法，故只在产物上改写。
 *
 * @returns 只处理 `.d.mts` 产物的 rolldown 插件，幂等。
 * @example `plugins: [dtsAugmentationSpecifier()]`
 */
function dtsAugmentationSpecifier(): Rolldown.Plugin {
  return {
    name: "axp:dts-augmentation-specifier",
    generateBundle: {
      // 等 dts 插件写完声明内容后再改
      order: "post",
      handler(_options, bundle) {
        for (const [fileName, output] of Object.entries(bundle)) {
          if (!fileName.endsWith(DTS_FILE_SUFFIX) || output.type !== "chunk") continue;
          output.code = output.code.replace(AUGMENTATION_RE, (whole, head: string, quote: string, path: string) => (HAS_EXT_RE.test(path) ? whole : `${head}${quote}${path}${RUNTIME_EXT}${quote}`));
        }
      },
    },
  };
}

/** rolldown-plugin-dts 对相对路径 `declare module` 的告警文本片段。 */
const KNOWN_DTS_WARNING = "will be kept as-is in the output";

/**
 * 屏蔽 dts 插件对相对路径 `declare module` 的已知告警：该写法已由 {@link dtsAugmentationSpecifier} 在产物上改写，
 * 告警只会淹没真正需要看的构建输出；其余日志照常交给 tsdown 的默认处理。
 *
 * @param defaults tsdown 已解析好的 rolldown 输入选项，其 `onLog` 会被保留并复用。
 * @returns 只覆盖 `onLog` 的选项补丁。
 */
function quietKnownDtsWarning(defaults: Rolldown.InputOptions): Rolldown.InputOptions {
  const base = defaults.onLog;
  return {
    onLog(level, log, handler) {
      if (log.message.includes(KNOWN_DTS_WARNING)) return;
      (base ?? handler)(level, log, handler);
    },
  };
}

export default defineConfig({
  pack: [
    {
      // 仅 "./min" 主动引用的单文件压缩版：自带一份模块实例，不与根入口/子路径共享状态；
      // 根入口 "." 指向下面的 unbundle 产物，避免与子路径 (cache/cancel/...) 出现两份模块实例
      entry: "src/index.ts",
      format: "esm",
      platform: "browser",
      target: TARGET,
      minify: true,
      dts: false,
      // 只清理自己的旧产物，别误删并行构建的 dist/esm
      clean: ["dist/index.*"],
      outExtensions: () => ({ js: ".min.js" }),
      deps: {
        neverBundle: ["axios"],
      },
    },
    {
      // 每个公开插件产出独立 esm 文件,支持按需 subpath 导入 (dist/esm/plugins/*.mjs);
      // 根入口 "." 同样指向本产物 (dist/esm/index.mjs),与子路径共享同一份模块实例。
      // 入口显式列出：retry-timing / auth-match / cache-store 是插件内部算法模块，不是入口，
      // 只作为依赖随插件产出（只保留被用到的导出），也不在 package.json exports 里
      entry: ["src/index.ts", ...PLUGIN_ENTRIES],
      format: "esm",
      platform: "browser",
      target: TARGET,
      fixedExtension: true,
      unbundle: true,
      outDir: "dist/esm",
      dts: { tsgo: true },
      // 声明只依据 src：默认 tsconfig 还包含 test/bench，其类型错误（如 TS2883）会混进构建输出
      tsconfig: "tsconfig.build.json",
      clean: true,
      plugins: [dtsAugmentationSpecifier()],
      inputOptions: quietKnownDtsWarning,
      // 构建本身只有几百毫秒，插件耗时占比告警没有信息量
      checks: { pluginTimings: false },
      deps: {
        neverBundle: ["axios"],
      },
    },
  ],
});
