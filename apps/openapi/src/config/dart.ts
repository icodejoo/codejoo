// Dart 语言配置工厂。
//
// 列出 quicktype.io UI 中 Dart 的全部 primary / secondary 选项与默认值。
// 用户调 configureDart({...}) 时只填想覆盖的字段，其余自动用默认。
//
// 来源：packages/quicktype-core/src/language/Dart/language.ts

import { emitDart } from "../emitters/dart-emitter";
import {
  DEFAULT_INFERENCE_FLAGS,
  type CommonBase,
  type InferenceFlags,
  type LangConfig,
} from "./shared";

// ============================================================================
// 工厂
// ============================================================================

export function configureDart(input: ConfigureDartInput = {}): DartLangConfig {
  const cfg: DartLangConfig = {
    base: {
      lang: "dart",
      dir: input.base?.dir ?? "./types/dart",
      fileHeader:
        input.base?.fileHeader ??
        "// !!! 脚本自动生成，请勿修改\n// ignore_for_file: type=lint\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      modelsFile: input.base?.modelsFile ?? "models.dart",
      pathsFile: input.base?.pathsFile ?? "paths.dart",
      pathsClassName: input.base?.pathsClassName ?? "PathRefs",
    },
    primary: { ...DEFAULT_DART_PRIMARY, ...input.primary },
    others: { ...DEFAULT_DART_OTHERS, ...input.others },
    emitter: emitDart,
  };
  return cfg;
}

// ============================================================================
// 默认值
// ============================================================================

const DEFAULT_DART_PRIMARY: DartPrimaryOptions = {
  "null-safety": true, // [quicktype 默认 true]
  "just-types": false, // [quicktype 默认 false]  保留 fromJson/toJson
  "coders-in-class": false, // [quicktype 默认 false]  序列化方法不塞进类内部
  "required-props": false, // [quicktype 默认 false]
  "final-props": true, // [quicktype 默认 false]  全部字段 final
  "copy-with": false, // [quicktype 默认 false]
};

const DEFAULT_DART_OTHERS: DartOthersOptions = {
  "from-map": false, // [quicktype 默认 false]  保持 fromJson/toJson 不改名
  "use-freezed": false, // [quicktype 默认 false]
  "use-hive": false, // [quicktype 默认 false]
  "use-json-annotation": false, // [quicktype 默认 false]
  "part-name": "", // [quicktype 默认 '']    用于 freezed / json_serializable 的 part 名
};

// ============================================================================
// 类型声明
// ============================================================================

export interface ConfigureDartInput {
  base?: Partial<DartBase>;
  primary?: Partial<DartPrimaryOptions>;
  others?: Partial<DartOthersOptions>;
}

export interface DartBase extends CommonBase {
  lang: "dart";
  /** quicktype 产出的全部模型类（含 enum） */
  modelsFile: string;
  /** PathOp<Req,Res> 常量登记表 */
  pathsFile: string;
  /** PathOp 登记表所在的 class 名（PathRefs.getPetById 风格） */
  pathsClassName: string;
  inferenceFlags: InferenceFlags;
}

export interface DartLangConfig extends LangConfig {
  base: DartBase;
  primary: DartPrimaryOptions;
  others: DartOthersOptions;
}

export interface DartPrimaryOptions {
  /** [quicktype 默认 true] 生成空安全语法（String? 等） */
  "null-safety": boolean;
  /** 只输出类，不输出 fromJson/toJson */
  "just-types": boolean;
  /** 把序列化方法塞进类内部（而不是顶层函数） */
  "coders-in-class": boolean;
  /** 字段全部 required */
  "required-props": boolean;
  /** 字段全部 final */
  "final-props": boolean;
  /** 给类生成 copyWith() */
  "copy-with": boolean;
}

export interface DartOthersOptions {
  /** 把方法名 fromJson/toJson 改为 fromMap/toMap */
  "from-map": boolean;
  /** 输出 @freezed 兼容的类定义（业务侧需配合 build_runner 生成 .freezed.dart） */
  "use-freezed": boolean;
  /** 给 Hive 加 @HiveType / @HiveField 注解 */
  "use-hive": boolean;
  /** 给 json_serializable 加 @JsonKey 注解（业务侧需配合 build_runner 生成 .g.dart） */
  "use-json-annotation": boolean;
  /** part 'X.dart'; 中的 X（用于 freezed / json_serializable） */
  "part-name": string;
}
