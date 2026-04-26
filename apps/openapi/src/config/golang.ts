// Go 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Golang/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureGo(input: ConfigureGoInput = {}): GoLangConfig {
  const cfg: GoLangConfig = {
    base: {
      lang: "go",
      dir: input.base?.dir ?? "./types/go",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.go",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: {},
  };
  return cfg;
}

const DEFAULT_PRIMARY: GoPrimaryOptions = {
  "just-types": false,
  "just-types-and-package": false,
  package: "main",
  "multi-file-output": false,
  "field-tags": "json",
  "omit-empty": false,
};

export interface ConfigureGoInput {
  base?: Partial<GoBase>;
  primary?: Partial<GoPrimaryOptions>;
}

export interface GoBase extends CommonBase {
  lang: "go";
  inferenceFlags: InferenceFlags;
}

export interface GoLangConfig extends LangConfig {
  base: GoBase;
  primary: GoPrimaryOptions;
  others: object; // 无 secondary 选项
}

export interface GoPrimaryOptions {
  "just-types": boolean;
  /** 仅类型 + package 声明，不生成 marshaling */
  "just-types-and-package": boolean;
  package: string;
  /** 每个 top-level 一个 .go 文件 */
  "multi-file-output": boolean;
  /** struct 字段需要生成的 tag 列表（逗号分隔） */
  "field-tags": string;
  /** 非 required 字段加 ",omitempty" */
  "omit-empty": boolean;
}
