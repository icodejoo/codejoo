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
import {
  opCamelName,
  opKey,
  type MegaSchemaResult,
  type OperationData,
  type ReqInfo,
  type ResponseRef,
} from "../schema";

// ============================================================================
// 入口：emit
// ============================================================================

export function emitDart(ctx: EmitContext): EmitOutput[] {
  const cfg = ctx.cfg as DartLangConfig;
  return [
    { filename: cfg.base.modelsFile, content: stripQuicktypeHeader(ctx.raw, cfg) },
    { filename: cfg.base.pathsFile, content: emitPaths(ctx.meta, cfg) },
  ];
}

// ============================================================================
// models.dart 包装
// ============================================================================

function stripQuicktypeHeader(quicktypeOutput: string, cfg: DartLangConfig): string {
  const lines = quicktypeOutput.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("//") || lines[i].trim() === "")) i++;
  const body = lines.slice(i).join("\n").replace(/\s+$/, "");
  return cfg.base.fileHeader + body + "\n";
}

// ============================================================================
// paths.dart 渲染
// ============================================================================

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

  for (const op of meta.ops) {
    const reqInfo = meta.reqInfoOf.get(opKey(op.path, op.method))!;
    const resExpr = renderResponse(meta.responseRefOf.get(opKey(op.path, op.method))!);
    const reqExpr = renderReq(reqInfo);
    const fieldName = opCamelName(op);
    const doc = renderDartDoc(op, "  ");
    if (doc) out += `${doc}\n`;
    out += `  static const ${fieldName} = PathOp<${reqExpr}, ${resExpr}>('${op.path}', '${op.method.toUpperCase()}');\n`;
  }
  out += "}\n";
  return out;
}

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

function renderReq(info: ReqInfo): string {
  // empty 没有对应类型——用 Object?，调用方可传 null
  if (info.kind === "empty") return "Object?";
  // ref-alias 直接引用底层 component（避免空类继承的运行时成本与 json codec 复杂化）
  if (info.kind === "ref-alias" && info.refName) return info.refName;
  return info.name;
}

function renderDartDoc(op: OperationData, indent: string): string | null {
  const parts: string[] = [];
  if (op.summary) op.summary.split("\n").forEach((l) => parts.push(l));
  if (op.description && op.description !== op.summary) {
    if (parts.length) parts.push("");
    op.description.split("\n").forEach((l) => parts.push(l));
  }
  if (op.deprecated) parts.push("@deprecated");
  if (parts.length === 0) return null;
  return parts.map((l) => `${indent}/// ${l}`.replace(/\s+$/, "")).join("\n");
}

function dartPrimitive(p: string): string {
  switch (p) {
    case "string":
      return "String";
    case "number":
      return "num";
    case "boolean":
      return "bool";
    case "unknown":
      return "dynamic";
    default:
      return "dynamic";
  }
}
