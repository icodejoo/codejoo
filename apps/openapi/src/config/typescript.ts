// TypeScript 语言配置工厂。
//
// 列出 quicktype.io UI 中 TypeScript 的全部 primary / secondary 选项与默认值。
// 用户调 configureTypescript({...}) 时只填想覆盖的字段，其余自动用默认。
//
// 来源：
//   packages/quicktype-core/src/language/TypeScriptFlow/language.ts
//   packages/quicktype-core/src/language/JavaScript/language.ts (TS 通过 ...javaScriptOptions 继承)

import { emitTypescript } from "../emitters/typescript-emitter";
import { DEFAULT_INFERENCE_FLAGS, type CommonBase, type InferenceFlags, type LangConfig } from "./shared";

// ============================================================================
// 工厂
// ============================================================================

export function configureTypescript(input: ConfigureTsInput = {}): TsLangConfig {
  const cfg: TsLangConfig = {
    base: {
      lang: "typescript",
      dir: input.base?.dir ?? "./types",
      fileHeader: input.base?.fileHeader ?? "//!!!脚本自动生成，请勿修改;\n\n",
      inferenceFlags: { ...DEFAULT_INFERENCE_FLAGS, ...input.base?.inferenceFlags },
      responseFile: input.base?.responseFile ?? "response.d.ts",
      requestFile: input.base?.requestFile ?? "request.d.ts",
      pathsFile: input.base?.pathsFile ?? "paths.d.ts",
      rootNamespace: input.base?.rootNamespace ?? "model",
      requestNamespace: input.base?.requestNamespace ?? "req",
    },
    primary: { ...DEFAULT_TS_PRIMARY, ...input.primary },
    others: { ...DEFAULT_TS_OTHERS, ...input.others },
    emitter: emitTypescript,
  };
  return cfg;
}

// ============================================================================
// 默认值
// ============================================================================

const DEFAULT_TS_PRIMARY: TsPrimaryOptions = {
  "just-types": true, // [quicktype 默认 false]  仅类型，不要 runtime converter
  "runtime-typecheck": false, // [quicktype 默认 true]   关闭运行时校验
  "nice-property-names": false, // [quicktype 默认 false]
  "explicit-unions": false, // [quicktype 默认 false]
  "prefer-unions": true, // [quicktype 默认 false]  字符串字面量联合替代 enum
  "prefer-types": true, // [quicktype 默认 false]  type 别名替代 interface
  "prefer-const-values": false, // [quicktype 默认 false]
  readonly: false, // [quicktype 默认 false]
  converters: "top-level", // [quicktype 默认 'top-level']
  "acronym-style": "original", // [quicktype 默认 'pascal']  不改写缩写大小写
};

const DEFAULT_TS_OTHERS: TsOthersOptions = {
  "runtime-typecheck-ignore-unknown-properties": false, // [quicktype 默认 false]
  "raw-type": "json", // [quicktype 默认 'json']
};

// ============================================================================
// 类型声明
// ============================================================================

export interface ConfigureTsInput {
  base?: Partial<TsBase>;
  primary?: Partial<TsPrimaryOptions>;
  others?: Partial<TsOthersOptions>;
}

export interface TsBase extends CommonBase {
  lang: "typescript";
  /** 响应模型 + 提取的 enum + 内联响应别名 → declare namespace model */
  responseFile: string;
  /** 合成的 op 请求类型 → declare namespace model.req */
  requestFile: string;
  /** Paths 联合 + PathRefs 索引 → declare namespace model */
  pathsFile: string;
  /** declare namespace 根名 */
  rootNamespace: string;
  /** request 子命名空间名（最终路径：model.req.<X>） */
  requestNamespace: string;
  inferenceFlags: InferenceFlags;
}

export interface TsLangConfig extends LangConfig {
  base: TsBase;
  primary: TsPrimaryOptions;
  others: TsOthersOptions;
}

export interface TsPrimaryOptions {
  /** 仅生成类型，不生成运行时 converters */
  "just-types": boolean;
  /** [quicktype 默认 true] 在 JSON.parse 之后做运行时类型校验 */
  "runtime-typecheck": boolean;
  /** 把 snake_case 等改写成 JS 风格的 camelCase */
  "nice-property-names": boolean;
  /** 给联合类型起独立的命名别名 */
  "explicit-unions": boolean;
  /** 用字符串字面量联合替代 enum */
  "prefer-unions": boolean;
  /** 用 type 别名替代 interface */
  "prefer-types": boolean;
  /** 单值 enum 退化为字符串字面量 */
  "prefer-const-values": boolean;
  /** 给所有字段加 readonly */
  readonly: boolean;
  /** 为哪些类型生成 converter */
  converters: "top-level" | "all-objects";
  /** 缩写词的大小写处理 */
  "acronym-style": "original" | "pascal" | "camel" | "lowerCase";
}

export interface TsOthersOptions {
  /** 配合 runtime-typecheck，遇到未知字段不报错 */
  "runtime-typecheck-ignore-unknown-properties": boolean;
  /** 输入是已 parse 的对象（any）还是 JSON 字符串（json） */
  "raw-type": "json" | "any";
}
