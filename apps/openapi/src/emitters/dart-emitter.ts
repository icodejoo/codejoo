// Dart 后处理 emitter（不调 quicktype，runner 已经跑好并把 raw 传进 EmitContext）。
//
// 职责：
//   1. 剥 quicktype 顶部 "// To parse this JSON data..." 用法注释 → 拼自己的 fileHeader
//   2. 手写 paths.dart（PathOp<Req,Res> 常量登记表）
//
// Dart 没有 namespace，类是平铺的，所以不需要切分；切到 freezed / json_serializable
// 由 config.others 控制，本文件无关。

import type { DartLangConfig } from "../config/dart";
import type { EmitContext, EmitOutput } from "../config/shared";
import { opCamelName, opKey, type MegaSchemaResult, type OperationData, type ReqInfo, type ResponseRef, type Schema } from "../schema";
import { allocateDartFieldName, escapeDartString, opDocLines, stripQuicktypeHeader } from "./shared";

// ============================================================================
// 入口：emit
// ============================================================================

/**
 * Dart emitter：产出 models.dart（quicktype 原文去头）与 paths.dart（手写登记表）。
 * @param ctx 渲染上下文，含 quicktype 原始输出、mega-schema 元信息与 Dart 语言配置
 * @returns 两个文件的 `{ filename, content }`，顺序为 models、paths
 * @example
 * const [models, paths] = emitDart(ctx);
 * fs.writeFileSync(models.filename, models.content);
 */
export function emitDart(ctx: EmitContext): EmitOutput[] {
  const cfg = ctx.cfg as DartLangConfig;
  return [
    { filename: cfg.base.modelsFile, content: cfg.base.fileHeader + stripQuicktypeHeader(ctx.raw) + "\n" },
    { filename: cfg.base.pathsFile, content: emitPaths(ctx.meta, cfg) },
  ];
}

// ============================================================================
// paths.dart 渲染
// ============================================================================

/** 渲染 paths.dart：每个 op 一个 `static const` 字段，字段名已去重并避开 Dart 保留字 */
function emitPaths(meta: MegaSchemaResult, cfg: DartLangConfig): string {
  let out = cfg.base.fileHeader;
  out += `import '${cfg.base.modelsFile}';\n\n`;
  out +=
    [
      "/// 类型化操作登记表条目。Req/Res 仅用于编译期类型推断，运行时仅承载 path/method。",
      "class PathOp<Req, Res> {",
      "  final String path;",
      "  final String method;",
      "  const PathOp(this.path, this.method);",
      "}",
      "",
      `class ${cfg.base.pathsClassName} {`,
    ].join("\n") + "\n";

  const usedFields = new Set<string>();
  for (const op of meta.ops) {
    const reqInfo = meta.reqInfoOf.get(opKey(op.path, op.method))!;
    const resExpr = renderResponse(meta.responseRefOf.get(opKey(op.path, op.method))!);
    const reqExpr = renderReq(reqInfo);
    const fieldName = allocateDartFieldName(opCamelName(op), usedFields);
    const doc = renderDartDoc(op, "  ");
    if (doc) out += `${doc}\n`;
    out += `  static const ${fieldName} = PathOp<${reqExpr}, ${resExpr}>('${escapeDartString(op.path)}', '${op.method.toUpperCase()}');\n`;
  }
  out += "}\n";
  return out;
}

/** 响应槽的 Dart 类型表达式 */
function renderResponse(ref: ResponseRef): string {
  switch (ref.kind) {
    case "ref":
      return ref.name;
    case "array-of-ref":
      return `List<${ref.name}>`;
    case "array-of-primitive":
      return `List<${dartPrimitive(ref.primitive)}>`;
    case "primitive":
      return dartPrimitive(ref.primitive);
    case "map-of-primitive":
      return `Map<String, ${dartPrimitive(ref.primitive)}>`;
    case "map-of-ref":
      return `Map<String, ${ref.name}>`;
    case "inline":
      return ref.reqStyleName;
    case "none":
      return "void";
  }
}

/**
 * 请求槽的 Dart 类型表达式。
 * ref-alias-extends / body-alias 不进 mega-schema，models.dart 里没有同名类，不能直接引用 `info.name`。
 */
function renderReq(info: ReqInfo): string {
  // empty 没有对应类型——用 Object?，调用方可传 null
  if (info.kind === "empty") return "Object?";
  // ref-alias 直接引用底层 component（避免空类继承的运行时成本与 json codec 复杂化）
  if (info.kind === "ref-alias" && info.refName) return info.refName;
  // Dart 端没有 ref-alias-extends 对应的合成类（TS 靠手写 interface extends 补齐），退化为 dynamic
  if (info.kind === "ref-alias-extends") return "dynamic";
  // body 本身就是请求类型，直接映射成 Dart 类型
  if (info.kind === "body-alias") return dartTypeOfSchema(info.bodySchema);
  return info.name;
}

/** op 文档注释（`///` 形式）；没有文档信息返回 null */
function renderDartDoc(op: OperationData, indent: string): string | null {
  const lines = opDocLines(op);
  if (lines.length === 0) return null;
  return lines.map((l) => `${indent}/// ${l}`.replace(/\s+$/, "")).join("\n");
}

/** 响应原始类型名 → Dart 类型；未知一律 dynamic */
function dartPrimitive(p: string): string {
  switch (p) {
    case "string":
      return "String";
    case "number":
      return "num";
    case "boolean":
      return "bool";
    default:
      return "dynamic";
  }
}

/**
 * 把 body-alias 的 JSON Schema 映射成 Dart 类型。
 * `#/definitions/X` → X；array → `List<...>`；string/integer/number/boolean → String/int/num/bool；
 * 只有 additionalProperties 的 object → `Map<String, ...>`；其余（联合、无类型等）→ dynamic。
 * type 数组含 "null" 且只剩一个非 null 类型时结果加 `?`（如 `int?`、`List<int?>`）；剩多个非 null 类型 → dynamic。
 */
function dartTypeOfSchema(schema: Schema): string {
  if (!schema || typeof schema !== "object") return "dynamic";
  if (typeof schema.$ref === "string") {
    const m = /^#\/definitions\/(.+)$/.exec(schema.$ref);
    return m ? m[1] : "dynamic";
  }
  if (schema.oneOf || schema.anyOf || schema.allOf) return "dynamic";
  if (!Array.isArray(schema.type)) return dartTypeOfBaseType(schema.type, schema);
  const nonNull: string[] = schema.type.filter((x: string) => x !== "null");
  if (nonNull.length !== 1) return "dynamic";
  const base = dartTypeOfBaseType(nonNull[0], schema);
  return schema.type.includes("null") && base !== "dynamic" ? `${base}?` : base;
}

/** 单个 JSON Schema 基础类型名 → Dart 类型（不含可空标记）；items / additionalProperties 从 schema 里取 */
function dartTypeOfBaseType(t: unknown, schema: Record<string, any>): string {
  switch (t) {
    case "string":
      return "String";
    case "integer":
      return "int";
    case "number":
      return "num";
    case "boolean":
      return "bool";
    case "array":
      return `List<${schema.items ? dartTypeOfSchema(schema.items) : "dynamic"}>`;
    case "object":
      if (!schema.properties && schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `Map<String, ${dartTypeOfSchema(schema.additionalProperties)}>`;
      }
      return "dynamic";
    default:
      return "dynamic";
  }
}
