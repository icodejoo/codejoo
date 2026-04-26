// Objective-C 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Objective-C/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureObjectiveC(input: ConfigureObjcInput = {}): ObjcLangConfig {
  const cfg: ObjcLangConfig = {
    base: {
      lang: "objc",
      dir: input.base?.dir ?? "./types/objc",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "Models.m",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: ObjcPrimaryOptions = {
  features: "all",
  "just-types": false,
  "class-prefix": "",
  "extra-comments": false,
};

const DEFAULT_OTHERS: ObjcOthersOptions = {
  functions: false,
};

export interface ConfigureObjcInput {
  base?: Partial<ObjcBase>;
  primary?: Partial<ObjcPrimaryOptions>;
  others?: Partial<ObjcOthersOptions>;
}

export interface ObjcBase extends CommonBase {
  lang: "objc";
  inferenceFlags: InferenceFlags;
}

export interface ObjcLangConfig extends LangConfig {
  base: ObjcBase;
  primary: ObjcPrimaryOptions;
  others: ObjcOthersOptions;
}

export interface ObjcPrimaryOptions {
  /** 输出 interface / implementation / 二者皆有 */
  features: "all" | "interface" | "implementation";
  "just-types": boolean;
  /** 类名前缀（占位符 'PREFIX'） */
  "class-prefix": string;
  /** 额外注释 */
  "extra-comments": boolean;
}

export interface ObjcOthersOptions {
  /** 输出 C-style 函数 */
  functions: boolean;
}
