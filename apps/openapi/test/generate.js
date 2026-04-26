import { generate, configureTypescript, configureBase } from "../dist/index.es.js";
import json from "./demo.json" with { type: "json" };

generate(
  configureBase({
    // source: 'https://petstore3.swagger.io/api/v3/openapi.json',
    source: json,
  }),
  [
    configureTypescript({
      // 全部用默认；要 override 写在这里，例如：
      //   primary: { 'prefer-types': false }, // 改用 interface 替代 type alias
      //   base: { inferenceFlags: { inferDateTimes: true } },  // format: date-time → Date
    }),
  ],
).catch((e) => {
  console.error("❌ 失败:", e);
  process.exit(1);
});
