import { defineConfig } from "oxlint";

import { lint as baseLint } from "../../oxlint.config.ts";

const lint = defineConfig({
  extends: [baseLint],
  // 嵌套的 example/ 子工程独立成包，不由本包 lint 管辖。
  ignorePatterns: ["**/example/**"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
});

export { lint };
export default { lint };
