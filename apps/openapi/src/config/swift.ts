// Swift 语言配置工厂。
// 来源：packages/quicktype-core/src/language/Swift/language.ts

import type { CommonBase, LangConfig } from "./shared";
import { DEFAULT_INFERENCE_FLAGS, type InferenceFlags } from "./shared";

export function configureSwift(input: ConfigureSwiftInput = {}): SwiftLangConfig {
  const cfg: SwiftLangConfig = {
    base: {
      lang: "swift",
      dir: input.base?.dir ?? "./types/swift",
      fileHeader: input.base?.fileHeader ?? "// !!! 脚本自动生成，请勿修改\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "Models.swift",
    },
    primary: { ...DEFAULT_PRIMARY, ...input.primary },
    others: { ...DEFAULT_OTHERS, ...input.others },
  };
  return cfg;
}

const DEFAULT_PRIMARY: SwiftPrimaryOptions = {
  "just-types": false,
  initializers: true,
  "coding-keys": true,
  alamofire: false,
  "struct-or-class": "struct",
  "mutable-properties": false,
  "objective-c-support": false,
  "optional-enums": false,
  "swift-5-support": false,
  sendable: false,
  "multi-file-output": false,
};

const DEFAULT_OTHERS: SwiftOthersOptions = {
  "coding-keys-protocol": "",
  "type-prefix": "",
  density: "dense",
  "support-linux": false,
  "access-level": "internal",
  protocol: "none",
  "acronym-style": "pascal",
};

export interface ConfigureSwiftInput {
  base?: Partial<SwiftBase>;
  primary?: Partial<SwiftPrimaryOptions>;
  others?: Partial<SwiftOthersOptions>;
}

export interface SwiftBase extends CommonBase {
  lang: "swift";
  inferenceFlags: InferenceFlags;
}

export interface SwiftLangConfig extends LangConfig {
  base: SwiftBase;
  primary: SwiftPrimaryOptions;
  others: SwiftOthersOptions;
}

export interface SwiftPrimaryOptions {
  "just-types": boolean;
  /** 生成 init/mutator 方法 */
  initializers: boolean;
  /** Codable 类型显式列出 CodingKey */
  "coding-keys": boolean;
  /** 输出 Alamofire 扩展 */
  alamofire: boolean;
  /** 用 struct 还是 class */
  "struct-or-class": "struct" | "class";
  /** 用 var 而非 let */
  "mutable-properties": boolean;
  /** 继承自 NSObject + @objcMembers，便于 Obj-C 互通 */
  "objective-c-support": boolean;
  /** enum 找不到匹配 case 时设为 null */
  "optional-enums": boolean;
  /** Swift 5 兼容模式 */
  "swift-5-support": boolean;
  /** 给生成的 model 加 Sendable 标记 */
  sendable: boolean;
  /** 每个 top-level 类型一个文件 */
  "multi-file-output": boolean;
}

export interface SwiftOthersOptions {
  /** CodingKeys 实现的协议 */
  "coding-keys-protocol": string;
  /** 类型名前缀 */
  "type-prefix": string;
  density: "normal" | "dense";
  /** 支持 Linux 平台 */
  "support-linux": boolean;
  "access-level": "internal" | "public";
  /** 让类型实现 Equatable / Hashable / 都不实现 */
  protocol: "none" | "equatable" | "hashable";
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
}
