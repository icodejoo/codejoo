// JavaScript PropTypes 配置工厂（生成 React PropTypes 定义）。
// 来源：packages/quicktype-core/src/language/JavaScriptPropTypes/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureJavascriptPropTypes(input: ConfigureJsPropTypesInput = {}): JsPropTypesLangConfig {
  const cfg: JsPropTypesLangConfig = {
    base: {
      lang: "javascript-prop-types",
      dir: input.base?.dir ?? "./types/js-prop-types",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "propTypes.js",
    },
    primary: {},
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_OTHERS: JsPropTypesOthersOptions = {
  "acronym-style": "pascal",
  converters: "top-level",
  "module-system": "es6",
};

export interface ConfigureJsPropTypesInput {
  base?: Partial<JsPropTypesBase>;
  others?: Partial<JsPropTypesOthersOptions>;
}

export interface JsPropTypesBase extends CommonBase {
  lang: "javascript-prop-types";
  inferenceFlags: InferenceFlags;
}

export interface JsPropTypesLangConfig extends LangConfig {
  base: JsPropTypesBase;
  primary: object; // 无 primary 选项
  others: JsPropTypesOthersOptions;
}

export interface JsPropTypesOthersOptions {
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
  converters: "top-level" | "all-objects";
  "module-system": "common-js" | "es6";
}
