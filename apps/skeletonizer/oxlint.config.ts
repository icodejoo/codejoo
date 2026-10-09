import { defineConfig } from "oxlint";

import { lint as baseLint } from "../../oxlint.config.ts";

const lint = defineConfig({
  extends: [baseLint],
  // bench/ 是性能实验存档，demo/.tmp-* 是进行中的实验目录，demo/main.js 是 demo 页脚本（原先内联在 html 里不被 lint），demo-dist/ 是构建产物：都不参与 lint
  ignorePatterns: ["bench/**", "demo/.tmp-*/**", "demo/main.js", "demo-dist/**"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
});

export { lint };
export default { lint };
