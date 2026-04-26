// PHP 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Php/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configurePhp(input: ConfigurePhpInput = {}): PhpLangConfig {
  const cfg: PhpLangConfig = {
    base: {
      lang: "php",
      dir: input.base?.dir ?? "./types/php",
      fileHeader: input.base?.fileHeader ?? "<?php\n// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "Models.php",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: PhpPrimaryOptions = {
  "with-get": true,
  "fast-get": false,
  "with-set": false,
  "with-closing": false,
};

const DEFAULT_OTHERS: PhpOthersOptions = {
  "acronym-style": "pascal",
};

export interface ConfigurePhpInput {
  base?: Partial<PhpBase>;
  primary?: Partial<PhpPrimaryOptions>;
  others?: Partial<PhpOthersOptions>;
}

export interface PhpBase extends CommonBase {
  lang: "php";
  inferenceFlags: InferenceFlags;
}

export interface PhpLangConfig extends LangConfig {
  base: PhpBase;
  primary: PhpPrimaryOptions;
  others: PhpOthersOptions;
}

export interface PhpPrimaryOptions {
  /** 生成 getter */
  "with-get": boolean;
  /** 不带类型校验的 getter（更快） */
  "fast-get": boolean;
  /** 生成 setter */
  "with-set": boolean;
  /** 生成 PHP closing tag (?>) */
  "with-closing": boolean;
}

export interface PhpOthersOptions {
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
}
