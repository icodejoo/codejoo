// Smithy4s 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Smithy4s/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureSmithy4s(input: ConfigureSmithyInput = {}): SmithyLangConfig {
  const cfg: SmithyLangConfig = {
    base: {
      lang: "smithy4s",
      dir: input.base?.dir ?? "./types/smithy",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.smithy",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: SmithyPrimaryOptions = {
  framework: "just-types",
};

const DEFAULT_OTHERS: SmithyOthersOptions = {
  package: "quicktype",
};

export interface ConfigureSmithyInput {
  base?: Partial<SmithyBase>;
  primary?: Partial<SmithyPrimaryOptions>;
  others?: Partial<SmithyOthersOptions>;
}

export interface SmithyBase extends CommonBase {
  lang: "smithy4s";
  inferenceFlags: InferenceFlags;
}

export interface SmithyLangConfig extends LangConfig {
  base: SmithyBase;
  primary: SmithyPrimaryOptions;
  others: SmithyOthersOptions;
}

export interface SmithyPrimaryOptions {
  framework: "just-types";
}

export interface SmithyOthersOptions {
  package: string;
}
