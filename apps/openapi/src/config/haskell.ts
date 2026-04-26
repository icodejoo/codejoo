// Haskell 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Haskell/language.ts
// 注意：源码声明的 fileExtension 是 'haskell' 而非 'hs'；这里默认仍用 .hs（更常规）。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureHaskell(input: ConfigureHaskellInput = {}): HaskellLangConfig {
  const cfg: HaskellLangConfig = {
    base: {
      lang: "haskell",
      dir: input.base?.dir ?? "./types/haskell",
      fileHeader: input.base?.fileHeader ?? "-- !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "QuickType.hs",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: {},
  };
  return cfg;
}

const DEFAULT_PRIMARY: HaskellPrimaryOptions = {
  "just-types": false,
  "array-type": "array",
  module: "QuickType",
};

export interface ConfigureHaskellInput {
  base?: Partial<HaskellBase>;
  primary?: Partial<HaskellPrimaryOptions>;
}

export interface HaskellBase extends CommonBase {
  lang: "haskell";
  inferenceFlags: InferenceFlags;
}

export interface HaskellLangConfig extends LangConfig {
  base: HaskellBase;
  primary: HaskellPrimaryOptions;
  others: object; // 无 secondary 选项
}

export interface HaskellPrimaryOptions {
  "just-types": boolean;
  "array-type": "array" | "list";
  /** 生成模块名（应与文件名匹配） */
  module: string;
}
