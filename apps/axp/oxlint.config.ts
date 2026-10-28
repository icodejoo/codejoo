import { defineConfig } from "oxlint";

import { lint as baseLint } from "../../oxlint.config.ts";

const lint = defineConfig({
  extends: [baseLint],
  // 旧架构用例不再参与后续批次的 lint 与类型分析。
  ignorePatterns: [...(baseLint.ignorePatterns ?? []), "test/legacy/**"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
});

export { lint };
export default { lint };
