// Pike 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Pike/language.ts
// 注意：Pike 没有可配置的 renderer 选项。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configurePike(input: ConfigurePikeInput = {}): PikeLangConfig {
  const cfg: PikeLangConfig = {
    base: {
      lang: "pike",
      dir: input.base?.dir ?? "./types/pike",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.pmod",
    },
    primary: {},
    others: {},
  };
  return cfg;
}

export interface ConfigurePikeInput {
  base?: Partial<PikeBase>;
}

export interface PikeBase extends CommonBase {
  lang: "pike";
  inferenceFlags: InferenceFlags;
}

export interface PikeLangConfig extends LangConfig {
  base: PikeBase;
}
