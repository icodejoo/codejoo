// Elm 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Elm/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureElm(input: ConfigureElmInput = {}): ElmLangConfig {
  const cfg: ElmLangConfig = {
    base: {
      lang: "elm",
      dir: input.base?.dir ?? "./types/elm",
      fileHeader: input.base?.fileHeader ?? "-- !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "QuickType.elm",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: {},
  };
  return cfg;
}

const DEFAULT_PRIMARY: ElmPrimaryOptions = {
  "just-types": false,
  "array-type": "array",
  module: "QuickType",
};

export interface ConfigureElmInput {
  base?: Partial<ElmBase>;
  primary?: Partial<ElmPrimaryOptions>;
}

export interface ElmBase extends CommonBase {
  lang: "elm";
  inferenceFlags: InferenceFlags;
}

export interface ElmLangConfig extends LangConfig {
  base: ElmBase;
  primary: ElmPrimaryOptions;
  others: object; // 无 secondary 选项
}

export interface ElmPrimaryOptions {
  "just-types": boolean;
  "array-type": "array" | "list";
  /** 生成模块名（应与文件名匹配） */
  module: string;
}
