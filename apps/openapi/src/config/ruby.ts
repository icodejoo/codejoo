// Ruby 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Ruby/language.ts
// strict / coercible 模式需要 dry-types 与 dry-struct gem。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureRuby(input: ConfigureRubyInput = {}): RubyLangConfig {
  const cfg: RubyLangConfig = {
    base: {
      lang: "ruby",
      dir: input.base?.dir ?? "./types/ruby",
      fileHeader: input.base?.fileHeader ?? "# !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.rb",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: RubyPrimaryOptions = {
  "just-types": false,
  strictness: "strict",
};

const DEFAULT_OTHERS: RubyOthersOptions = {
  namespace: "",
};

export interface ConfigureRubyInput {
  base?: Partial<RubyBase>;
  primary?: Partial<RubyPrimaryOptions>;
  others?: Partial<RubyOthersOptions>;
}

export interface RubyBase extends CommonBase {
  lang: "ruby";
  inferenceFlags: InferenceFlags;
}

export interface RubyLangConfig extends LangConfig {
  base: RubyBase;
  primary: RubyPrimaryOptions;
  others: RubyOthersOptions;
}

export interface RubyPrimaryOptions {
  "just-types": boolean;
  /** 类型严格度（strict / coercible 需要 dry-types + dry-struct） */
  strictness: "strict" | "coercible" | "none";
}

export interface RubyOthersOptions {
  /** 包裹的 module 名（空串 = 不包裹） */
  namespace: string;
}
