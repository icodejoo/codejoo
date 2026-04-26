// Elixir 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Elixir/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureElixir(input: ConfigureElixirInput = {}): ElixirLangConfig {
  const cfg: ElixirLangConfig = {
    base: {
      lang: "elixir",
      dir: input.base?.dir ?? "./types/elixir",
      fileHeader: input.base?.fileHeader ?? "# !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.ex",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: {},
  };
  return cfg;
}

const DEFAULT_PRIMARY: ElixirPrimaryOptions = {
  "just-types": false,
  namespace: "",
};

export interface ConfigureElixirInput {
  base?: Partial<ElixirBase>;
  primary?: Partial<ElixirPrimaryOptions>;
}

export interface ElixirBase extends CommonBase {
  lang: "elixir";
  inferenceFlags: InferenceFlags;
}

export interface ElixirLangConfig extends LangConfig {
  base: ElixirBase;
  primary: ElixirPrimaryOptions;
  others: object; // 无 secondary 选项
}

export interface ElixirPrimaryOptions {
  "just-types": boolean;
  /** module 命名空间名（默认空表示不包裹） */
  namespace: string;
}
