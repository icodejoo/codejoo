// Flow 语言配置工厂（Facebook Flow type annotations）。
// 来源：packages/quicktype-core/src/language/TypeScriptFlow/language.ts
// 与 TypeScript 共享同一组 tsFlowOptions（继承自 javaScriptOptions）。

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureFlow(input: ConfigureFlowInput = {}): FlowLangConfig {
  const cfg: FlowLangConfig = {
    base: {
      lang: "flow",
      dir: input.base?.dir ?? "./types/flow",
      fileHeader: input.base?.fileHeader ?? "// @flow\n// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.js",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: FlowPrimaryOptions = {
  "runtime-typecheck": true, // [quicktype 默认 true]
  "just-types": false,
  "nice-property-names": false,
  "explicit-unions": false,
  "prefer-unions": false,
  "prefer-types": false,
  "prefer-const-values": false,
  readonly: false,
};

const DEFAULT_OTHERS: FlowOthersOptions = {
  "runtime-typecheck-ignore-unknown-properties": false,
  "acronym-style": "pascal",
  converters: "top-level",
  "raw-type": "json",
};

export interface ConfigureFlowInput {
  base?: Partial<FlowBase>;
  primary?: Partial<FlowPrimaryOptions>;
  others?: Partial<FlowOthersOptions>;
}

export interface FlowBase extends CommonBase {
  lang: "flow";
  inferenceFlags: InferenceFlags;
}

export interface FlowLangConfig extends LangConfig {
  base: FlowBase;
  primary: FlowPrimaryOptions;
  others: FlowOthersOptions;
}

export interface FlowPrimaryOptions {
  "runtime-typecheck": boolean;
  "just-types": boolean;
  "nice-property-names": boolean;
  "explicit-unions": boolean;
  "prefer-unions": boolean;
  "prefer-types": boolean;
  "prefer-const-values": boolean;
  readonly: boolean;
}

export interface FlowOthersOptions {
  "runtime-typecheck-ignore-unknown-properties": boolean;
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
  converters: "top-level" | "all-objects";
  "raw-type": "json" | "any";
}
