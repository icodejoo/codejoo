// Rust 语言配置工厂（生成代码使用 serde derive 宏）。
// 来源：packages/quicktype-core/src/language/Rust/language.ts
// 注意：所有选项都是 secondary（无 primary）。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureRust(input: ConfigureRustInput = {}): RustLangConfig {
  const cfg: RustLangConfig = {
    base: {
      lang: "rust",
      dir: input.base?.dir ?? "./types/rust",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.rs",
    },
    primary: {},
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_OTHERS: RustOthersOptions = {
  density: "normal",
  visibility: "private",
  "derive-debug": false,
  "derive-clone": false,
  "derive-partial-eq": false,
  "skip-serializing-none": false,
  "edition-2018": true,
  "leading-comments": true,
};

export interface ConfigureRustInput {
  base?: Partial<RustBase>;
  others?: Partial<RustOthersOptions>;
}

export interface RustBase extends CommonBase {
  lang: "rust";
  inferenceFlags: InferenceFlags;
}

export interface RustLangConfig extends LangConfig {
  base: RustBase;
  primary: object; // 无 primary 选项
  others: RustOthersOptions;
}

export interface RustOthersOptions {
  density: "normal" | "dense";
  /** 字段可见性 */
  visibility: "private" | "crate" | "public";
  "derive-debug": boolean;
  "derive-clone": boolean;
  "derive-partial-eq": boolean;
  /** 跳过序列化 None 字段 */
  "skip-serializing-none": boolean;
  "edition-2018": boolean;
  "leading-comments": boolean;
}
