// TypeScript + Effect Schema 配置工厂（生成 @effect/schema 定义）。
// 来源：packages/quicktype-core/src/language/TypeScriptEffectSchema/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureTypescriptEffectSchema(
  input: ConfigureTsEffectInput = {},
): TsEffectLangConfig {
  const cfg: TsEffectLangConfig = {
    base: {
      lang: "typescript-effect-schema",
      dir: input.base?.dir ?? "./types/effect-schema",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "schemas.ts",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: {},
  };
  return cfg;
}

const DEFAULT_PRIMARY: TsEffectPrimaryOptions = {
  "just-schema": false,
};

export interface ConfigureTsEffectInput {
  base?: Partial<TsEffectBase>;
  primary?: Partial<TsEffectPrimaryOptions>;
}

export interface TsEffectBase extends CommonBase {
  lang: "typescript-effect-schema";
  inferenceFlags: InferenceFlags;
}

export interface TsEffectLangConfig extends LangConfig {
  base: TsEffectBase;
  primary: TsEffectPrimaryOptions;
  others: object; // 无 secondary 选项
}

export interface TsEffectPrimaryOptions {
  /** 仅 schema，不导出 inferred TS 类型 */
  "just-schema": boolean;
}
