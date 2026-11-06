import { defineConfig } from "oxlint";

import { lint as baseLint } from "../../oxlint.config.ts";

const lint = defineConfig({
  extends: [baseLint],
  // 嵌套的 example/、mocker/ 子工程各自独立成包（有自己的 package.json 与 lint/fmt 配置），不由本包 lint 管辖。
  ignorePatterns: ["**/example/**", "**/mocker/**"],
  options: {
    typeAware: true,
    typeCheck: true,
  },
});

export { lint };
export default { lint };
