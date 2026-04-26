// Python 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Python/language.ts
// python-version 控制 typeHints 与 dataClasses 是否启用。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configurePython(input: ConfigurePythonInput = {}): PythonLangConfig {
  const cfg: PythonLangConfig = {
    base: {
      lang: "python",
      dir: input.base?.dir ?? "./types/python",
      fileHeader: input.base?.fileHeader ?? "# !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.py",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: PythonPrimaryOptions = {
  "python-version": "3.6",
};

const DEFAULT_OTHERS: PythonOthersOptions = {
  "just-types": false,
  "nice-property-names": true,
  "pydantic-base-model": false,
};

export interface ConfigurePythonInput {
  base?: Partial<PythonBase>;
  primary?: Partial<PythonPrimaryOptions>;
  others?: Partial<PythonOthersOptions>;
}

export interface PythonBase extends CommonBase {
  lang: "python";
  inferenceFlags: InferenceFlags;
}

export interface PythonLangConfig extends LangConfig {
  base: PythonBase;
  primary: PythonPrimaryOptions;
  others: PythonOthersOptions;
}

export interface PythonPrimaryOptions {
  /** Python 版本——3.5 无 type hints；3.6+ 有 type hints；3.7+ 有 dataclasses */
  "python-version": "3.5" | "3.6" | "3.7";
}

export interface PythonOthersOptions {
  /** 仅类型，不生成 from/to dict converters */
  "just-types": boolean;
  /** 字段名改写为 Pythonic 风格 */
  "nice-property-names": boolean;
  /** 用 pydantic.BaseModel（业务侧需要 pydantic 运行时） */
  "pydantic-base-model": boolean;
}
