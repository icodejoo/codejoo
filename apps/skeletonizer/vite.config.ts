import { readdirSync } from "node:fs";
import { defineConfig } from "vite-plus";

/**
 * CSS 入口：取 src/styles/entries 下的 *.scss 文件名，每个各编一份压缩 CSS（新增入口只需加文件）。
 * 目前只有两个：full（完整版 = 基底 + 全部变体）和 lite（精简版）；src/styles/parts 下的拼装件不单独产出
 */
const CSS_ENTRIES = readdirSync("src/styles/entries")
  .filter((f) => f.endsWith(".scss"))
  .map((f) => f.slice(0, -".scss".length));

/** lightningcss 的 Features.IsSelector 位：不要把 :is() 按 target 展开成 :-webkit-any / :-moz-any 多份（用到 :is 的规则本来就只在支持 :where / :has 的浏览器里生效） */
const KEEP_IS_SELECTOR = 16;

/** 类型底座：lite 的 d.mts；完整版与适配层的 d.mts 都从它引类型，构建时当外部依赖 */
const LITE_TYPES = "skeletonizer/lite";

/** 所有 JS 配置共用的构建选项 */
const JS_COMMON = {
  format: "esm" as const,
  platform: "browser" as const,
  // 保留 process.env.NODE_ENV 原样（浏览器平台默认会被替换成 "production"）：开发警告由使用方的打包器按它自己的模式决定去留
  define: { "process.env.NODE_ENV": "process.env.NODE_ENV" },
  target: "es2015",
  minify: true,
  outDir: "dist",
  fixedExtension: true,
};

/**
 * 一个自包含的 JS 入口配置：单入口单文件（没有公共 chunk）；传 styled 时在产物开头加 import "./<入口名>.css"，打包器会一并引入样式。
 * @param name 入口名（也是产物文件名与同名 CSS 名）
 * @param entry 源码入口
 * @param opts clean：是否清空 dist（只有第一份配置清）；styled：是否带 CSS 导入；dts：d.mts 配置（false 不出）；external：额外的外部依赖（类型底座 skeletonizer/lite 总是外部，不用写）
 * @returns 一份 pack 配置
 * @example jsEntry("lite", "src/entries/lite.ts", { clean: true, styled: true })
 */
function jsEntry(name: string, entry: string, opts: { clean?: boolean; styled?: boolean; dts?: false | { emitDtsOnly?: boolean }; external?: string[] } = {}) {
  const { clean = false, styled = false, dts = {}, external = [] } = opts;
  return {
    ...JS_COMMON,
    entry: { [name]: entry },
    dts: dts === false ? false : { tsgo: true, ...dts },
    clean,
    deps: { neverBundle: [LITE_TYPES, ...external] },
    outputOptions: styled ? { banner: `import "./${name}.css";` } : {},
  };
}

export default defineConfig({
  // demo 开发服务：npm run dev
  server: { port: 5188, open: "/demo/index.html" },
  // 依赖 dist 的测试（类型测试、条件导出、打包器 fixture）开跑前，由全局准备保证产物是新的
  // solid-js 在 node 条件下解析到服务端构建（createEffect 不执行），测试里别名到浏览器构建；只影响测试，不碰库的打包
  test: {
    globalSetup: ["./test/global-setup.ts"],
    alias: [
      { find: /^solid-js$/, replacement: "solid-js/dist/solid.js" },
      { find: /^solid-js\/web$/, replacement: "solid-js/web/dist/web.js" },
    ],
    server: { deps: { inline: [/solid-js/] } },
  },
  pack: [
    // 注意：package.json 的 sideEffects 里 "./src/..." 几条必须保留——它们是给本包自己的构建用的（路径对应源码文件）：
    // 删掉后 rolldown 会把 core/index（mountGlobal）、full/index、full/variants/* 里"只有副作用"的顶层调用（registerExtension 等）当成无副作用摇掉。
    // "./dist/full.mjs" / "./dist/lite.mjs" 两条则是给使用方的打包器看的：它们导入即挂全局、注册扩展，必须保留；
    // 适配层与 element 没有导入副作用，不在清单里，没用到的导出可被摇掉。
    // 产物只有三类，且每个 JS 文件自包含（各一份配置，没有公共 chunk；所以同一页面不要同时引 full 和 lite）：
    // lite（core + lite.css）、full（完整版扩展 + global / svg 变体 + full.css）、框架适配层与 element（<skz-box>，只有胶水，不含 core）。
    jsEntry("lite", "src/entries/lite.ts", { clean: true, styled: true }),
    jsEntry("full", "src/entries/full.ts", { styled: true, dts: false }),
    // full 的类型入口单独构建（只出 d.mts）：类型从 skeletonizer/lite 再导出，完整版只补增强，不另生成第二份核心类型
    jsEntry("full", "src/entries/full.types.ts", { dts: { emitDtsOnly: true } }),
    // 适配层：框架本身与 skeletonizer/lite（只取类型）都是外部依赖，各自一份配置以免出共享 chunk
    jsEntry("vue", "src/vue.ts", { external: ["vue"] }),
    jsEntry("react", "src/react.ts", { external: ["react"] }),
    jsEntry("svelte", "src/svelte.ts"),
    jsEntry("solid", "src/solid.ts", { external: ["solid-js", "solid-js/web"] }),
    // <skz-box> 自定义元素：同样不含 core，经私有全局键取实现，不带 CSS（样式随 lite.css / full.css）
    jsEntry("element", "src/element.ts"),
    // CSS：每个 SCSS 入口各编一份压缩 CSS，并按最低支持线降级语法（避免产出 8 位 hex 等新写法）
    ...CSS_ENTRIES.map((name) => ({
      entry: { [name]: `src/styles/entries/${name}.scss` },
      format: "esm" as const,
      platform: "browser" as const,
      dts: false,
      clean: false,
      css: { fileName: `${name}.css`, minify: true, target: ["chrome88", "firefox84", "safari14", "edge88"], lightningcss: { exclude: KEEP_IS_SELECTOR } },
    })),
  ],
});
