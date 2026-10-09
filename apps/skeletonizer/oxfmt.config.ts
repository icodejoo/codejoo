import { defineConfig } from "oxfmt";

import { fmt as baseFmt } from "../../oxfmt.config.ts";

const fmt = defineConfig({
  ...baseFmt,
  // bench/ 是性能实验存档，demo/.tmp-* 是进行中的实验目录：都保持原样不格式化
  ignorePatterns: [...(baseFmt.ignorePatterns ?? []), "bench/**", "demo/.tmp-*/**", "demo-dist/**"],
});

export { fmt };
export default { fmt };
