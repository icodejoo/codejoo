// Crystal 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Crystal/language.ts
// 注意：Crystal 没有可配置的 renderer 选项（getOptions() 返回 {}）。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureCrystal(input: ConfigureCrystalInput = {}): CrystalLangConfig {
  const cfg: CrystalLangConfig = {
    base: {
      lang: "crystal",
      dir: input.base?.dir ?? "./types/crystal",
      fileHeader: input.base?.fileHeader ?? "# !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.cr",
    },
    primary: {},
    others: {},
  };
  return cfg;
}

export interface ConfigureCrystalInput {
  base?: Partial<CrystalBase>;
}

export interface CrystalBase extends CommonBase {
  lang: "crystal";
  inferenceFlags: InferenceFlags;
}

export interface CrystalLangConfig extends LangConfig {
  base: CrystalBase;
}
