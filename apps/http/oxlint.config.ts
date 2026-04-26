import { defineConfig } from "oxlint";

import { lint as baseLint } from "../../oxlint.config.ts";

const lint = defineConfig({
  extends: [baseLint],
  options: {
    typeAware: true,
    typeCheck: true,
  },
});

export { lint };
export default { lint };
