// JSON Schema 输出配置工厂。
// 来源：packages/quicktype-core/src/language/JSONSchema/language.ts
// 注意：JSON Schema 没有可配置的 renderer 选项；fileHeader 默认为空（保证产出是合法 JSON）。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureJsonSchema(input: ConfigureJsonSchemaInput = {}): JsonSchemaLangConfig {
  const cfg: JsonSchemaLangConfig = {
    base: {
      lang: "schema",
      dir: input.base?.dir ?? "./types/schema",
      fileHeader: input.base?.fileHeader ?? "", // JSON 文件不能有注释
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.schema.json",
    },
    primary: {},
    others: {},
  };
  return cfg;
}

export interface ConfigureJsonSchemaInput {
  base?: Partial<JsonSchemaBase>;
}

export interface JsonSchemaBase extends CommonBase {
  lang: "schema";
  inferenceFlags: InferenceFlags;
}

export interface JsonSchemaLangConfig extends LangConfig {
  base: JsonSchemaBase;
}
