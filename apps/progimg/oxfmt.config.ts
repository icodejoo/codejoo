import { defineConfig } from "oxfmt";

import { fmt as baseFmt } from "../../oxfmt.config.ts";

const fmt = defineConfig({
  ...baseFmt,
});

export { fmt };
export default { fmt };
