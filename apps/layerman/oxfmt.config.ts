import { defineConfig } from "oxfmt";

import { fmt as baseFmt } from "../../oxfmt.config.ts";

const fmt = defineConfig({
  ...baseFmt,
  // 嵌套的 example/ 子工程独立成包，不由本包 fmt 管辖。
  ignorePatterns: [...(baseFmt.ignorePatterns ?? []), "**/example/**"],
});

export { fmt };
export default { fmt };
