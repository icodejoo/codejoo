import { defineConfig } from "vite-plus";

/** CSS 入口：基底二选一（base / explicit），变体按需叠加（global / svg / sweep），all 为基底 + 全部变体 */
const CSS_ENTRIES = ["base", "explicit", "global", "svg", "sweep", "all"] as const;

/** 自带 CSS 的变体 JS 入口（入口名 → CSS 名）：产物开头加 import "./<名字>.css"，打包器会一并引入样式 */
const STYLED_ENTRIES: Record<string, string> = { global: "global", svg: "svg", all: "all" };

/** lightningcss 的 Features.IsSelector 位：不要把 :is() 按 target 展开成 :-webkit-any / :-moz-any 多份（用到 :is 的规则本来就只在支持 :where / :has 的浏览器里生效） */
const KEEP_IS_SELECTOR = 16;

export default defineConfig({
  // demo 开发服务：npm run dev
  server: { port: 5188, open: "/demo/index.html" },
  pack: [
    {
      // JS 多入口：核心、框架适配层、变体（带 CSS / 纯 JS 两版），框架本身为外部依赖；共享代码自动拆成公共 chunk，
      // 所以同一页面里同时用核心和变体时，注册表只有一份
      entry: {
        index: "src/index.ts",
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
      target: "es2015",
      minify: true,
      outDir: "dist",
      fixedExtension: true,
      dts: { tsgo: true },
      clean: true,
      // 变体入口自带样式：只给 global / svg / all 三个入口产物加 CSS 导入，其他入口和公共 chunk 保持纯 JS（SSR 安全）。
      // tsdown 的 banner 整次构建只算一次，这里用 rolldown 的按 chunk 计算的 banner
      outputOptions: {
        banner: (chunk) => {
          const css = chunk.isEntry ? STYLED_ENTRIES[chunk.name] : undefined;
          return css ? `import "./${css}.css";` : "";
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
