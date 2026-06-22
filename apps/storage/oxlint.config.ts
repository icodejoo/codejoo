import { defineConfig } from "oxlint";

import { lint as baseLint } from "../../oxlint.config.ts";

const lint = defineConfig({
  extends: [baseLint],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  // 测试文件放宽几条对无状态模块函数/字符串数组的误报规则（测试不发布，引用 JSONX.stringify、keys().sort() 等是惯用写法）
  overrides: [
    {
      files: ["test/**/*.ts"],
      rules: {
        "typescript/unbound-method": "off",
        "typescript/no-base-to-string": "off",
        "typescript/require-array-sort-compare": "off",
      },
    },
  ],
});

export { lint };
export default { lint };
