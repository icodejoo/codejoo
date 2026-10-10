import { readdirSync } from "node:fs";
import { defineConfig } from "vite-plus";

/**
 * CSS 入口：取 src/styles/entries 下的 *.scss 文件名，每个各编一份压缩 CSS（新增入口只需加文件）。
 * core 为 core 默认样式（第 0 档 + 现代档 + 根驱动）；基底三选一（core / base 完整版 / explicit 只认显式标记），变体按需叠加（global 防火墙 + svg 降级 / svg / sweep / tofu），all 为 base + 全部变体
 */
const CSS_ENTRIES = readdirSync("src/styles/entries")
  .filter((f) => f.endsWith(".scss"))
  .map((f) => f.slice(0, -".scss".length));

/** 自带 CSS 的变体 JS 入口名：产物开头加 import "./<入口名>.css"（同名 CSS 由上面的入口生成），打包器会一并引入样式 */
const STYLED_ENTRIES = new Set(["core", "explicit", "global", "svg", "all"]);

/** lightningcss 的 Features.IsSelector 位：不要把 :is() 按 target 展开成 :-webkit-any / :-moz-any 多份（用到 :is 的规则本来就只在支持 :where / :has 的浏览器里生效） */
const KEEP_IS_SELECTOR = 16;

export default defineConfig({
  // demo 开发服务：npm run dev
  server: { port: 5188, open: "/demo/index.html" },
  // 依赖 dist 的测试（类型测试、条件导出、打包器 fixture）开跑前，由全局准备保证产物是新的
  test: { globalSetup: ["./test/global-setup.ts"] },
  pack: [
    {
      // 注意：package.json 的 sideEffects 里 "./src/..." 几条必须保留——它们是给本包自己的构建用的（路径对应源码文件）：
      // 删掉后 rolldown 会把 core/index（mountGlobal）、full/index、full/variants/* 里"只有副作用"的顶层调用（registerExtension 等）当成无副作用摇掉。
      // "./dist/*.mjs" 那条则是给使用方的打包器看的。
      // JS 多入口：core（默认带 / 不带 CSS 两版）、explicit、完整版 full、框架适配层、变体（带 CSS / 纯 JS 两版），框架本身为外部依赖；
      // 共享代码自动拆成公共 chunk，所以同一页面里同时用 core 和 full / 变体时，注册表只有一份
      entry: {
        core: "src/entries/core.ts",
        "core-js": "src/entries/core-js.ts",
        explicit: "src/entries/explicit.ts",
        "explicit-js": "src/entries/explicit-js.ts",
        full: "src/entries/full.ts",
        vue: "src/vue.ts",
        react: "src/react.ts",
        svelte: "src/svelte.ts",
        global: "src/entries/global.ts",
        "global-js": "src/entries/global-js.ts",
        svg: "src/entries/svg.ts",
        "svg-js": "src/entries/svg-js.ts",
        all: "src/entries/all.ts",
        "all-js": "src/entries/all-js.ts",
      },
      format: "esm",
      platform: "browser",
      // 保留 process.env.NODE_ENV 原样（浏览器平台默认会被替换成 "production"）：开发警告由使用方的打包器按它自己的模式决定去留
      define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
      target: "es2015",
      minify: true,
      outDir: "dist",
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
      // 带样式的入口：只给 core / explicit / global / svg / all 五个入口产物加 CSS 导入，其他入口和公共 chunk 保持纯 JS（SSR 安全）。
      // tsdown 的 banner 整次构建只算一次，这里用 rolldown 的按 chunk 计算的 banner
      outputOptions: {
        banner: (chunk) => {
          return chunk.isEntry && STYLED_ENTRIES.has(chunk.name) ? `import "./${chunk.name}.css";` : "";
        },
      },
    },
    // CSS：每个 SCSS 入口各编一份压缩 CSS，并按最低支持线降级语法（避免产出 8 位 hex 等新写法）
    ...CSS_ENTRIES.map((name) => ({
      entry: { [name]: `src/styles/entries/${name}.scss` },
      format: "esm" as const,
      platform: "browser" as const,
      dts: false,
      clean: false,
      css: { fileName: `${name}.css`, minify: true, target: ["chrome49", "firefox52", "safari10", "edge15"], lightningcss: { exclude: KEEP_IS_SELECTOR } },
    })),
  ],
});
