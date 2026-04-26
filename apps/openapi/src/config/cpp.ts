// C++ 语言配置工厂。
// 来源：packages/quicktype-core/src/language/CPlusPlus/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureCpp(input: ConfigureCppInput = {}): CppLangConfig {
  const cfg: CppLangConfig = {
    base: {
      lang: "cpp",
      dir: input.base?.dir ?? "./types/cpp",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.cpp",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: CppPrimaryOptions = {
  "source-style": "single-source",
  "code-format": "with-getter-setter",
  wstring: "use-string",
  "const-style": "west-const",
  "just-types": false,
  namespace: "quicktype",
  "type-style": "pascal-case",
  "member-style": "underscore-case",
  "enumerator-style": "upper-underscore-case",
  boost: true,
  "hide-null-optional": false,
};

const DEFAULT_OTHERS: CppOthersOptions = {
  "include-location": "local-include",
  "enum-type": "int",
};

type NamingStyle =
  | "pascal-case"
  | "underscore-case"
  | "camel-case"
  | "upper-underscore-case"
  | "pascal-case-upper-acronyms"
  | "camel-case-upper-acronyms";

export interface ConfigureCppInput {
  base?: Partial<CppBase>;
  primary?: Partial<CppPrimaryOptions>;
  others?: Partial<CppOthersOptions>;
}

export interface CppBase extends CommonBase {
  lang: "cpp";
  inferenceFlags: InferenceFlags;
}

export interface CppLangConfig extends LangConfig {
  base: CppBase;
  primary: CppPrimaryOptions;
  others: CppOthersOptions;
}

export interface CppPrimaryOptions {
  "source-style": "single-source" | "multi-source";
  /** 用 getter/setter 类（vs 直接 struct） */
  "code-format": "with-struct" | "with-getter-setter";
  /** 字符串存储为 std::string (utf-8) 或 std::wstring (utf-16) */
  wstring: "use-string" | "use-wstring";
  /** const 放左边 (west) 或右边 (east) */
  "const-style": "west-const" | "east-const";
  "just-types": boolean;
  namespace: string;
  "type-style": NamingStyle;
  "member-style": NamingStyle;
  "enumerator-style": NamingStyle;
  /** 依赖 boost；关闭时需要 C++17 */
  boost: boolean;
  /** 是否隐藏 optional 字段的 null 值 */
  "hide-null-optional": boolean;
}

export interface CppOthersOptions {
  /** json.hpp 的包含路径风格 */
  "include-location": "local-include" | "global-include";
  /** enum class 的底层类型 */
  "enum-type": string;
}
