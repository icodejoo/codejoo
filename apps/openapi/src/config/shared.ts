// 跨语言共享的配置类型与工厂。
//
// 设计：
//   - BaseConfig：完全与语言无关的预处理策略（OpenAPI 来源、严格对象、命名冲突等）。
//                 由 generate() 第一个参数传入，整条 pipeline 共用。
//   - LangConfig：每种语言独立持有 { base, primary, others, emitter? } 四段：
//       base    ：该语言的所有"非 quicktype 渲染选项"配置（dir、文件名、inferenceFlags 等）
//       primary ：quicktype.io UI 主选项区
//       others  ：quicktype.io UI "Other" 折叠区
//       emitter ：可选。runner 跑完 quicktype 后调用，做后处理（如 TS 切分、Dart paths 登记表）；
//                 不设则把 quicktype 原始输出整体落到 base.modelsFile。
//
// 扩展新语言：在 config/ 下新增 <lang>.ts，导出 configure<Lang>(input) 返回 LangConfig 即可。
// 大多数语言不需要 emitter——runner 会用默认逻辑写盘。

import type { InputData, JSONSchemaInput } from "quicktype-core";

import type { MegaSchemaResult } from "../schema";

// ============================================================================
// 工厂：base config（填默认值）
// ============================================================================

export function configureBase(input: ConfigureBaseInput): BaseConfig {
  return {
    source: input.source,
    strictObjects: input.strictObjects ?? true,
    httpMethodOrder: input.httpMethodOrder ?? ["get", "post", "put", "delete", "patch", "options", "head"],
    conflictSuffix: input.conflictSuffix ?? ((base, n) => `${base}$${n}`),
  };
}

// ============================================================================
// 默认 inference flags
// ============================================================================

export const DEFAULT_INFERENCE_FLAGS: InferenceFlags = {
  inferMaps: false,
  inferEnums: false,
  inferUuids: false,
  inferDateTimes: false,
  inferIntegerStrings: false,
  inferBooleanStrings: false,
  combineClasses: true,
  ignoreJsonRefs: true,
};

// ============================================================================
// 类型声明
// ============================================================================

/**
 * 顶层入口的"基础配置"——只装与语言无关的项。
 * 凡是与语言有关的（哪怕"看起来通用"，如 inferenceFlags），都放进对应 LangConfig.base。
 */
export interface ConfigureBaseInput {
  /**
   * OpenAPI doc 来源，5 种形态自动识别：
   *   1. 已解析对象（如 `import json from './openapi.json'`）
   *   2. http/https URL，自动 fetch
   *   3. 内联 JSON 字符串（trim 后以 `{` 或 `[` 开头）
   *   4. 内联 YAML 字符串（含换行的字符串）
   *   5. 本地文件路径（.json / .yaml / .yml）
   *
   * 全部归一为 JS 对象 → mega-schema → JSON.stringify → quicktype 单 source 渲染。
   */
  source: string | Record<string, unknown>;
  /** 是否在 normalize 阶段给"显式有 properties 但没设 additionalProperties"的 object 注入 false（默认 true） */
  strictObjects?: boolean;
  /** 同一 path 下方法的处理顺序（影响 PathRefs 中字段顺序与 req 名分配优先级） */
  httpMethodOrder?: readonly string[];
  /** 命名冲突消歧：(base='Pet', n=1) => 'Pet$1' */
  conflictSuffix?: (base: string, n: number) => string;
}

export interface BaseConfig {
  source: string | Record<string, unknown>;
  strictObjects: boolean;
  httpMethodOrder: readonly string[];
  conflictSuffix: (base: string, n: number) => string;
}

/**
 * quicktype 全局 inference flags（packages/quicktype-core/src/Inference.ts）。
 * 每种语言独立一份——quicktype() 每次调用时影响 TypeGraph 构建与 stringTypeMapping。
 */
export interface InferenceFlags {
  inferMaps: boolean;
  inferEnums: boolean;
  inferUuids: boolean;
  inferDateTimes: boolean;
  inferIntegerStrings: boolean;
  inferBooleanStrings: boolean;
  combineClasses: boolean;
  ignoreJsonRefs: boolean;
}

export interface EmitOutput {
  /** 相对 base.dir 的文件名 */
  filename: string;
  content: string;
}

/**
 * 每种语言 base 的最小公共形状。各 <lang>.ts 在此基础上扩展自己的 file 命名等。
 */
export interface CommonBase {
  /** quicktype 的语言标识（'typescript' / 'dart' / 'java' / 'kotlin' / ...） */
  lang: string;
  /** 输出目录（相对项目根） */
  dir: string;
  /** 文件头注释 */
  fileHeader: string;
  /** 全局 inference flags（per-language） */
  inferenceFlags: InferenceFlags;
  /**
   * 默认 emitter 缺失时使用的单文件输出名。自定义 emitter（如 TS/Dart）可不设此字段。
   * 若 emitter 与 modelsFile 都未设，runner 会抛错。
   */
  modelsFile?: string;
}

/**
 * runner 跑完 quicktype 后传给 emitter 回调的全部上下文。
 * emitter 内部可读 raw 做字符串后处理，也可拿 inputData/schemaInput 再次调用 quicktype 等。
 */
export interface EmitContext {
  /** quicktype 原始输出（result.lines.join('\n')） */
  raw: string;
  /** OpenAPI doc 处理后的全部 op / 模型元数据 */
  meta: MegaSchemaResult;
  /** runner 喂给 quicktype 的 InputData（emitter 可二次跑 quicktype 等） */
  inputData: InputData;
  /** runner 喂给 quicktype 的 JSONSchemaInput */
  schemaInput: JSONSchemaInput;
  /** 当前语言的完整 LangConfig（emitter 内部按需 cast 到具体的 TsLangConfig / DartLangConfig 等） */
  cfg: LangConfig;
}

/**
 * 每种语言的配置完整形态。runner 只用 base.dir / base.lang / emitter / primary / others。
 *
 * primary/others 故意使用宽松的 `object` 类型——这样具名 key 的 TsPrimaryOptions
 * / DartPrimaryOptions 等 interface 都能 extends LangConfig 而不需要写 index signature。
 */
export interface LangConfig {
  base: CommonBase;
  /** quicktype.io UI 默认展开的主选项区 */
  primary: object;
  /** quicktype.io UI 折叠在 "Other" 区的次要选项 */
  others: object;
  /** 可选——若不设，runner 把 quicktype 原始输出整体落到 base.modelsFile */
  emitter?: (ctx: EmitContext) => Promise<EmitOutput[]> | EmitOutput[];
}
