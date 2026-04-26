// JavaScript 语言配置工厂。
// 来源：packages/quicktype-core/src/language/JavaScript/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureJavascript(input: ConfigureJsInput = {}): JsLangConfig {
  const cfg: JsLangConfig = {
    base: {
      lang: "javascript",
      dir: input.base?.dir ?? "./types/js",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.js",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: JsPrimaryOptions = {
  "runtime-typecheck": true, // [quicktype 默认 true]
};

const DEFAULT_OTHERS: JsOthersOptions = {
  "runtime-typecheck-ignore-unknown-properties": false,
  "acronym-style": "pascal",
  converters: "top-level",
  "raw-type": "json",
};

export interface ConfigureJsInput {
  base?: Partial<JsBase>;
  primary?: Partial<JsPrimaryOptions>;
  others?: Partial<JsOthersOptions>;
}

export interface JsBase extends CommonBase {
  lang: "javascript";
  inferenceFlags: InferenceFlags;
}

export interface JsLangConfig extends LangConfig {
  base: JsBase;
  primary: JsPrimaryOptions;
  others: JsOthersOptions;
}

export interface JsPrimaryOptions {
  /** [quicktype 默认 true] 在 JSON.parse 之后做运行时类型校验 */
  "runtime-typecheck": boolean;
}

export interface JsOthersOptions {
  "runtime-typecheck-ignore-unknown-properties": boolean;
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
  converters: "top-level" | "all-objects";
  "raw-type": "json" | "any";
}
