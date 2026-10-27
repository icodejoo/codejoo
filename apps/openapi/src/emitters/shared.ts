// emitter 与 runner 共用的内部小工具（不从 index.ts 导出）。

import type { OperationData } from "../schema";

/**
 * 判断一行是否是注释行。
 * 不同语言的注释引导符不同（C 系 `//`、Python 系 `#`、Haskell `--`）。
 * 注意 `#` 只有后面紧跟空白或行尾才算注释——`#pragma once`、`#include`、`#import`、`#ifndef`
 * 这类 C / C++ / ObjC 预处理指令是代码，不能剥。
 */
function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("--") || /^#(\s|$)/.test(trimmed);
}

/**
 * 剥掉 quicktype 输出顶部的"// To parse this JSON data..."用法注释。
 * 行为：删掉前导连续的注释行与空行，并去掉尾部空白；之后的内容原样保留。
 * @param src quicktype 的原始输出
 * @returns 去掉头部注释、尾部空白后的正文（不含结尾换行）
 * @example
 * stripQuicktypeHeader("// To parse...\n\n#include <x>\nint a;\n"); // "#include <x>\nint a;"
 */
export function stripQuicktypeHeader(src: string): string {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t || isCommentLine(t)) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").replace(/\s+$/, "");
}

/**
 * 把 op 的文档拼成行列表：summary、空行、description（与 summary 不同时才写）、`@deprecated`。
 * 各语言 emitter 自己负责套 `/** *\/` 或 `///` 的外壳。
 * @param op 操作数据
 * @returns 文档行；op 没有任何文档信息时返回空数组
 * @example
 * opDocLines({ summary: "查宠物", description: "按 id 查", deprecated: true, ... });
 * // ["查宠物", "", "按 id 查", "@deprecated"]
 */
export function opDocLines(op: Pick<OperationData, "summary" | "description" | "deprecated">): string[] {
  const parts: string[] = [];
  if (op.summary) parts.push(...op.summary.split("\n"));
  if (op.description && op.description !== op.summary) {
    if (parts.length) parts.push("");
    parts.push(...op.description.split("\n"));
  }
  if (op.deprecated) parts.push("@deprecated");
  return parts;
}

// ----------------------------------------------------------------------------
// 字符串字面量转义
// ----------------------------------------------------------------------------

/**
 * 转义后可安全放进单引号字面量（TS / Dart 通用）：反斜杠加倍，单引号前补反斜杠。
 * @param s 原始字符串（如 URL path）
 * @returns 转义后的字符串（不含外层引号）
 * @example
 * escapeSingleQuoted("/it's"); // 结果是 /it\'s（单引号前多了一个反斜杠）
 */
export function escapeSingleQuoted(s: string): string {
  return s.replace(/[\\']/g, (c) => "\\" + c);
}

/**
 * 转义后可安全放进 Dart 单引号字符串：在 {@link escapeSingleQuoted} 之上再转义 `$`（否则会被当成插值）。
 * @param s 原始字符串
 * @returns 转义后的字符串（不含外层引号）
 * @example
 * escapeDartString("/a/$id"); // 结果是 /a/\$id（$ 前多了一个反斜杠）
 */
export function escapeDartString(s: string): string {
  return escapeSingleQuoted(s).replace(/\$/g, (c) => "\\" + c);
}

// ----------------------------------------------------------------------------
// Dart 登记表字段名
// ----------------------------------------------------------------------------

/** Dart 保留字与内置标识符：直接拿来当字段名会产出非法代码 */
const DART_RESERVED_WORDS: ReadonlySet<string> = new Set(
  "abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield".split(
    " ",
  ),
);

/**
 * 为 Dart 登记表分配一个合法且唯一的字段名，并登记进 used。
 * 命中保留字先追加 `_`；与已用名重复再追加数字后缀（2、3…）。
 * @param name 期望的字段名（通常是 lowerCamelCase 的 op 名）
 * @param used 已分配的字段名集合（会被就地更新）
 * @returns 最终分配到的字段名
 * @example
 * const used = new Set<string>();
 * allocateDartFieldName("class", used); // "class_"
 * allocateDartFieldName("findById", used); // "findById"
 * allocateDartFieldName("findById", used); // "findById2"
 */
export function allocateDartFieldName(name: string, used: Set<string>): string {
  const base = DART_RESERVED_WORDS.has(name) ? `${name}_` : name;
  let final = base;
  for (let n = 2; used.has(final); n++) final = `${base}${n}`;
  used.add(final);
  return final;
}
