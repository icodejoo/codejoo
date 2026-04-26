// TypeScript + Zod 配置工厂（生成 zod schemas，业务侧需要 zod 运行时）。
// 来源：packages/quicktype-core/src/language/TypeScriptZod/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureTypescriptZod(input: ConfigureTsZodInput = {}): TsZodLangConfig {
  const cfg: TsZodLangConfig = {
    base: {
      lang: "typescript-zod",
      dir: input.base?.dir ?? "./types/zod",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "schemas.ts",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: {},
  };
  return cfg;
}

const DEFAULT_PRIMARY: TsZodPrimaryOptions = {
  "just-schema": false,
};

export interface ConfigureTsZodInput {
  base?: Partial<TsZodBase>;
  primary?: Partial<TsZodPrimaryOptions>;
}

export interface TsZodBase extends CommonBase {
  lang: "typescript-zod";
  inferenceFlags: InferenceFlags;
}

export interface TsZodLangConfig extends LangConfig {
  base: TsZodBase;
  primary: TsZodPrimaryOptions;
  others: object; // 无 secondary 选项
}

export interface TsZodPrimaryOptions {
  /** 仅 schema，不导出 inferred TS 类型 */
  "just-schema": boolean;
}
