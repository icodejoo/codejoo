// Scala 3 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Scala3/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureScala3(input: ConfigureScala3Input = {}): Scala3LangConfig {
  const cfg: Scala3LangConfig = {
    base: {
      lang: "scala3",
      dir: input.base?.dir ?? "./types/scala",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "Models.scala",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: Scala3PrimaryOptions = {
  framework: "just-types",
};

const DEFAULT_OTHERS: Scala3OthersOptions = {
  package: "quicktype",
};

export interface ConfigureScala3Input {
  base?: Partial<Scala3Base>;
  primary?: Partial<Scala3PrimaryOptions>;
  others?: Partial<Scala3OthersOptions>;
}

export interface Scala3Base extends CommonBase {
  lang: "scala3";
  inferenceFlags: InferenceFlags;
}

export interface Scala3LangConfig extends LangConfig {
  base: Scala3Base;
  primary: Scala3PrimaryOptions;
  others: Scala3OthersOptions;
}

export interface Scala3PrimaryOptions {
  /** 序列化框架 */
  framework: "just-types" | "circe" | "upickle";
}

export interface Scala3OthersOptions {
  package: string;
}
