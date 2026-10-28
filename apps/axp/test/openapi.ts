import { generate, configureTypescript, configureBase } from "@codejoo/openapi2lang";

await generate(
  configureBase({
    source: "./test/mock.json",
  }),
  [configureTypescript()],
);
