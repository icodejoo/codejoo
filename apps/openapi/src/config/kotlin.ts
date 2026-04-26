// Kotlin 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Kotlin/language.ts
// framework 决定使用哪个 renderer：klaxon (Klaxon)/kotlinx (KotlinX serialization)/jackson (Jackson)/just-types (无运行时依赖)

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureKotlin(input: ConfigureKotlinInput = {}): KotlinLangConfig {
  const cfg: KotlinLangConfig = {
    base: {
      lang: "kotlin",
      dir: input.base?.dir ?? "./types/kotlin",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "Models.kt",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: KotlinPrimaryOptions = {
  framework: "klaxon",
};

const DEFAULT_OTHERS: KotlinOthersOptions = {
  "acronym-style": "pascal",
  package: "quicktype",
};

export interface ConfigureKotlinInput {
  base?: Partial<KotlinBase>;
  primary?: Partial<KotlinPrimaryOptions>;
  others?: Partial<KotlinOthersOptions>;
}

export interface KotlinBase extends CommonBase {
  lang: "kotlin";
  inferenceFlags: InferenceFlags;
}

export interface KotlinLangConfig extends LangConfig {
  base: KotlinBase;
  primary: KotlinPrimaryOptions;
  others: KotlinOthersOptions;
}

export interface KotlinPrimaryOptions {
  /** 序列化框架；just-types=纯类型无运行时依赖 */
  framework: "just-types" | "jackson" | "klaxon" | "kotlinx";
}

export interface KotlinOthersOptions {
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
  package: string;
}
