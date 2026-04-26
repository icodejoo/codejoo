// Java 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Java/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureJava(input: ConfigureJavaInput = {}): JavaLangConfig {
  const cfg: JavaLangConfig = {
    base: {
      lang: "java",
      dir: input.base?.dir ?? "./types/java",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "Models.java",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: JavaPrimaryOptions = {
  "array-type": "array",
  "just-types": false,
  "datetime-provider": "java8",
  package: "io.quicktype",
  lombok: false,
};

const DEFAULT_OTHERS: JavaOthersOptions = {
  "lombok-copy-annotations": true,
  "acronym-style": "pascal",
};

export interface ConfigureJavaInput {
  base?: Partial<JavaBase>;
  primary?: Partial<JavaPrimaryOptions>;
  others?: Partial<JavaOthersOptions>;
}

export interface JavaBase extends CommonBase {
  lang: "java";
  inferenceFlags: InferenceFlags;
}

export interface JavaLangConfig extends LangConfig {
  base: JavaBase;
  primary: JavaPrimaryOptions;
  others: JavaOthersOptions;
}

export interface JavaPrimaryOptions {
  /** 数组类型：T[] 或 List<T> */
  "array-type": "array" | "list";
  "just-types": boolean;
  /** 日期时间 API：java8 (java.time) 或 legacy (Date/Calendar) */
  "datetime-provider": "java8" | "legacy";
  package: string;
  /** 用 Lombok 注解（业务侧需依赖 Project Lombok） */
  lombok: boolean;
}

export interface JavaOthersOptions {
  /** Lombok 复制 accessor 上的注解 */
  "lombok-copy-annotations": boolean;
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
}
