// C (cJSON) 语言配置工厂。
// 来源：packages/quicktype-core/src/language/CJSON/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureCJson(input: ConfigureCJsonInput = {}): CJsonLangConfig {
  const cfg: CJsonLangConfig = {
    base: {
      lang: "cjson",
      dir: input.base?.dir ?? "./types/cjson",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.h",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: CJsonPrimaryOptions = {
  "type-style": "pascal-case", // [quicktype 默认 'pascal-case']
  "member-style": "underscore-case", // [quicktype 默认 'underscore-case']
  "enumerator-style": "upper-underscore-case", // [quicktype 默认 'upper-underscore-case']
};

const DEFAULT_OTHERS: CJsonOthersOptions = {
  "source-style": "single-source", // [quicktype 默认 'single-source']
  "integer-size": "int64_t", // [quicktype 默认 'int64_t']
  "hashtable-size": "64", // [quicktype 默认 '64']
  "typedef-alias": "no-typedef", // [quicktype 默认 'no-typedef']
  "print-style": "print-formatted", // [quicktype 默认 'print-formatted']
};

type NamingStyle =
  | "pascal-case"
  | "underscore-case"
  | "camel-case"
  | "upper-underscore-case"
  | "pascal-case-upper-acronyms"
  | "camel-case-upper-acronyms";

export interface ConfigureCJsonInput {
  base?: Partial<CJsonBase>;
  primary?: Partial<CJsonPrimaryOptions>;
  others?: Partial<CJsonOthersOptions>;
}

export interface CJsonBase extends CommonBase {
  lang: "cjson";
  inferenceFlags: InferenceFlags;
}

export interface CJsonLangConfig extends LangConfig {
  base: CJsonBase;
  primary: CJsonPrimaryOptions;
  others: CJsonOthersOptions;
}

export interface CJsonPrimaryOptions {
  /** 类型命名风格 */
  "type-style": NamingStyle;
  /** 成员命名风格 */
  "member-style": NamingStyle;
  /** 枚举值命名风格 */
  "enumerator-style": NamingStyle;
}

export interface CJsonOthersOptions {
  /** 源码生成方式：单文件 / 多文件 */
  "source-style": "single-source" | "multi-source";
  /** 整型 C 类型 */
  "integer-size": "int8_t" | "int16_t" | "int32_t" | "int64_t";
  /** 哈希表大小（创建 map 时使用） */
  "hashtable-size": string;
  /** 是否给 unions/structs/enums 加 typedef 别名 */
  "typedef-alias": "no-typedef" | "add-typedef";
  /** cJSON 打印风格 */
  "print-style": "print-formatted" | "print-unformatted";
}
