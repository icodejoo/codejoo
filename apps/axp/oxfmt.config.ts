import { defineConfig } from "oxfmt";

import { fmt as baseFmt } from "../../oxfmt.config.ts";

const fmt = defineConfig({
  ...baseFmt,
  // 归档只修相对路径，避免格式化干扰迁移审计。
  ignorePatterns: [...(baseFmt.ignorePatterns ?? []), "test/legacy/**"],
});

export { fmt };
export default { fmt };
