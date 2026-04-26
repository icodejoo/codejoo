// C# 语言配置工厂。
// 来源：packages/quicktype-core/src/language/CSharp/language.ts
// 注意：framework='NewtonSoft' 走 Newtonsoft.Json，'SystemTextJson' 走 System.Text.Json。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureCSharp(input: ConfigureCSharpInput = {}): CSharpLangConfig {
  const cfg: CSharpLangConfig = {
    base: {
      lang: "csharp",
      dir: input.base?.dir ?? "./types/csharp",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "Models.cs",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: CSharpPrimaryOptions = {
  framework: "NewtonSoft",
  "array-type": "array",
  namespace: "QuickType",
  virtual: false,
  features: "complete",
  "check-required": false,
  "keep-property-name": false,
};

const DEFAULT_OTHERS: CSharpOthersOptions = {
  density: "normal",
  "csharp-version": "6",
  "any-type": "object",
  "number-type": "double",
  "base-class": "Object",
};

export interface ConfigureCSharpInput {
  base?: Partial<CSharpBase>;
  primary?: Partial<CSharpPrimaryOptions>;
  others?: Partial<CSharpOthersOptions>;
}

export interface CSharpBase extends CommonBase {
  lang: "csharp";
  inferenceFlags: InferenceFlags;
}

export interface CSharpLangConfig extends LangConfig {
  base: CSharpBase;
  primary: CSharpPrimaryOptions;
  others: CSharpOthersOptions;
}

export interface CSharpPrimaryOptions {
  /** 序列化框架 */
  framework: "NewtonSoft" | "SystemTextJson";
  /** 数组类型：T[] 或 List<T> */
  "array-type": "array" | "list";
  namespace: string;
  /** 生成 virtual 属性 */
  virtual: boolean;
  /** 输出粒度 */
  features: "complete" | "attributes-only" | "just-types-and-namespace" | "just-types";
  /** 必填字段缺失时报错 */
  "check-required": boolean;
  /** 保留原始字段名（不做 PascalCase 改写） */
  "keep-property-name": boolean;
}

export interface CSharpOthersOptions {
  density: "normal" | "dense";
  "csharp-version": "5" | "6";
  /** 'any' 字段的 C# 类型 */
  "any-type": "object" | "dynamic";
  /** 数字默认 C# 类型 */
  "number-type": "double" | "decimal";
  /** 基类 */
  "base-class": "EntityData" | "Object";
}
