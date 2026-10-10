import { defineConfig } from "oxlint";

import { lint as baseLint } from "../../oxlint.config.ts";

const lint = defineConfig({
  extends: [baseLint],
  // bench/ 是性能实验存档，test/types 是依赖 dist 的类型测试工程（含故意的报错用例，由 test/types.test.ts 用 tsgo 单独编译），demo/.tmp-* 是进行中的实验目录，demo/main.js 是 demo 页脚本（原先内联在 html 里不被 lint），demo-dist/ 是构建产物：都不参与 lint
  ignorePatterns: ["bench/**", "test/types/**", "demo/.tmp-*/**", "demo/main.js", "demo-dist/**"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
});

export { lint };
export default { lint };
