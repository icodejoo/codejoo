// TypeScript 后处理 emitter（不调 quicktype，runner 已经跑好并把 raw 传进 EmitContext）。
//
// 职责：
//   1. T[] → Array<T> 增强可读性（quicktype TS renderer 硬编码 [] 语法，无 option）
//   2. enum-like block 提到 namespace 顶部（quicktype 按 TypeGraph 顺序输出，无 option）
//   3. 按类型名切成两组（response 模型集 vs 合成 req 集）
//   4. 给 req 块内对响应类型的引用补 model. 前缀
//   5. 包装到 declare namespace model / model.req
//   6. ref-alias 的 `interface X extends model.Y {}` 手写补到 request 末尾（含 op 注释）
//   7. 手写 paths.d.ts（labeled tuple 索引接口）

import type { TsLangConfig } from "../config/typescript";
import type { EmitContext, EmitOutput } from "../config/shared";
import { opKey, type MegaSchemaResult, type OperationData, type ReqInfo, type ResponseRef, type Schema } from "../schema";

// ============================================================================
// 入口：emit
// ============================================================================

export function emitTypescript(ctx: EmitContext): EmitOutput[] {
  const cfg = ctx.cfg as TsLangConfig;
  const { responseFile, requestFile } = splitAndWrap(ctx.raw, ctx.meta, cfg);
  return [
    { filename: cfg.base.responseFile, content: responseFile },
    { filename: cfg.base.requestFile, content: requestFile },
    { filename: cfg.base.pathsFile, content: emitPaths(ctx.meta, cfg) },
  ];
}

// ============================================================================
// 切分 + 包装
// ============================================================================

function splitAndWrap(quicktypeOutput: string, meta: MegaSchemaResult, cfg: TsLangConfig): { responseFile: string; requestFile: string } {
  // 后处理 #1：T[] → Array<T>（注释行不动，保留 JSDoc 中的原始示例）
  const transformed = bracketArrayToGeneric(quicktypeOutput);
  const blocks = parseBlocks(transformed);

  const reqNames = new Set<string>();
  for (const info of meta.reqInfoOf.values()) {
    if (info.kind === "normal") reqNames.add(info.name);
  }

  const reqBlocks: TsBlock[] = [];
  const resBlocks: TsBlock[] = [];
  const allTypeNames = new Set<string>();
  for (const b of blocks) {
    if (b.name) allTypeNames.add(b.name);
    if (b.name && reqNames.has(b.name)) reqBlocks.push(b);
    else resBlocks.push(b);
  }

  const ns = cfg.base.rootNamespace;

  // req 块内对 res 类型的引用要加 model. 前缀；req 互引则不加（同 namespace 可见）
  const needsPrefix = new Set<string>();
  for (const n of allTypeNames) if (!reqNames.has(n)) needsPrefix.add(n);

  // ref-alias / ref-alias-extends / body-alias 手写类型声明（全局放 model.req 末尾；模块作 export）。
  // schema 阶段这类 op 不写入 mega-schema（避免与底层 ref dedupe 撞名）；其内联 enum 已在
  // schema 阶段被 EnumLifter 提升为顶层 ref，emitter 此处直接走通用 ref 渲染即可。
  const mod = cfg.base.module;
  const raDecl = mod ? "export " : ""; // 模块：导出；全局：namespace 内裸声明
  const raI = mod ? "" : "  "; // 顶层缩进（全局 namespace 内 +2）
  const raPI = mod ? "  " : "    "; // extends 体内属性缩进
  const refAliasLines: string[] = [];
  for (const op of meta.ops) {
    const info = meta.reqInfoOf.get(opKey(op.path, op.method));
    if (!info) continue;
    if (info.kind !== "ref-alias" && info.kind !== "ref-alias-extends" && info.kind !== "body-alias") continue;

    const jsdoc = renderJsDoc(op, raI);
    if (jsdoc) refAliasLines.push(jsdoc);

    if (info.kind === "ref-alias") {
      refAliasLines.push(`${raI}${raDecl}interface ${info.name} extends ${ns}.${info.refName} {}`);
    } else if (info.kind === "ref-alias-extends" && info.extendsProps?.length) {
      refAliasLines.push(`${raI}${raDecl}interface ${info.name} extends ${ns}.${info.refName} {`);
      for (const prop of info.extendsProps) {
        const opt = prop.required ? "" : "?";
        const desc = typeof prop.schema?.description === "string" ? prop.schema.description : undefined;
        if (desc) refAliasLines.push(...renderPropJsDoc(desc, raPI));
        refAliasLines.push(`${raPI}${prop.name}${opt}: ${schemaToTsType(prop.schema, ns)}`);
      }
      refAliasLines.push(`${raI}}`);
    } else if (info.kind === "body-alias" && info.bodySchema) {
      refAliasLines.push(`${raI}${raDecl}type ${info.name} = ${schemaToTsType(info.bodySchema, ns)}`);
    }
  }
  const refAliasText = refAliasLines.length ? `\n\n${refAliasLines.join("\n")}` : "";

  // 后处理 #2：enum-like block 提到顶部
  const resOrdered = sortEnumsFirst(resBlocks);
  const reqOrdered = sortEnumsFirst(reqBlocks);

  if (mod) {
    // ES module：导出声明 + 命名空间导入互引。response 无依赖；request 用 `import * as model`
    // 引用 response（`model.X` 引用形态由 rewriteRefs 维持不变，model 此时是 import 别名）。
    const responseText = resOrdered.map((b) => ensureExport(b.text)).join("\n\n");
    const requestText = reqOrdered.map((b) => ensureExport(rewriteRefs(b.text, needsPrefix, ns))).join("\n\n");
    const reqNeedsModel = needsPrefix.size > 0 || refAliasLines.length > 0;
    const reqImport = reqNeedsModel ? `import type * as ${ns} from "${baseNoExt(cfg.base.responseFile)}"\n\n` : "";
    return {
      responseFile: `${cfg.base.fileHeader}${responseText}\n`,
      requestFile: `${cfg.base.fileHeader}${reqImport}${requestText}${refAliasText}\n`,
    };
  }

  const responseText = resOrdered.map((b) => indentBlock(stripBlockExport(b.text))).join("\n\n");
  const requestText = reqOrdered.map((b) => indentBlock(rewriteRefs(stripBlockExport(b.text), needsPrefix, ns))).join("\n\n");

  const requestNs = `${ns}.${cfg.base.requestNamespace}`;

  return {
    responseFile: `${cfg.base.fileHeader}declare namespace ${ns} {\n${responseText}\n}\n`,
    requestFile: `${cfg.base.fileHeader}declare namespace ${requestNs} {\n${requestText}${refAliasText}\n}\n`,
  };
}

/** 给声明块顶部声明行确保单个 `export` 前缀（块可能以 JSDoc 注释开头）。模块模式用。 */
function ensureExport(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) continue;
    lines[i] = lines[i].replace(/^(\s*)(?:export\s+|declare\s+)*/, "$1export ");
    break;
  }
  return lines.join("\n");
}

/** 文件名 → 去扩展名的相对 import 路径（`response.d.ts` → `./response`）。 */
function baseNoExt(file: string): string {
  return "./" + file.replace(/\.d\.ts$|\.ts$/, "");
}

function parseBlocks(quicktypeOutput: string): TsBlock[] {
  // 剥 quicktype 的头部注释行（连续 // + 空行）
  const lines = quicktypeOutput.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("//") || lines[i].trim() === "")) i++;
  const body = lines.slice(i).join("\n").replace(/\s+$/, "");

  // 按空行分块；再为每块抽取首个声明的类型名
  return body
    .split(/\n{2,}/)
    .map((c) => c.replace(/\s+$/, ""))
    .filter(Boolean)
    .map((text) => ({ text, name: extractDeclName(text) }));
}

function extractDeclName(chunk: string): string | null {
  for (const raw of chunk.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;
    const m = /^(?:export\s+|declare\s+)*(?:type|interface|enum|class|const)\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    return m ? m[1] : null;
  }
  return null;
}

/** 整块缩进 2 格（用于放进 declare namespace { ... }） */
function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.length ? `  ${l}` : l))
    .join("\n");
}

/** 剥每行 export/declare 前缀（保留缩进） */
function stripBlockExport(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^(\s*)(?:export|declare)\s+/, "$1"))
    .join("\n");
}

/**
 * 在非注释行中、对每个匹配 needsPrefix 的裸标识符加 model. 前缀。
 *   - 跳过 JSDoc / 行注释（确保 shape/field 注释里的原文不被改写）
 *   - 已是 model.X 形式不动（前置 . 检查）
 */
function rewriteRefs(text: string, needsPrefix: Set<string>, ns: string): string {
  if (needsPrefix.size === 0) return text;
  const names = [...needsPrefix].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\w$.])(${names.map(escapeRe).join("|")})(?![\\w$])`, "g");

  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return line;
      return line.replace(pattern, (_m, name) => `${ns}.${name}`);
    })
    .join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ----------------------------------------------------------------------------
// T[] → Array<T> 后处理
// ----------------------------------------------------------------------------

function bracketArrayToGeneric(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return line;
      return rewriteArrayBracketsInLine(line);
    })
    .join("\n");
}

function rewriteArrayBracketsInLine(line: string): string {
  let prev: string;
  let cur = line;
  do {
    prev = cur;
    cur = cur.replace(/(\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\[\]/g, "Array<$1>");
    cur = cur.replace(/(\([^()]*\))\[\]/g, (_m, paren) => `Array<${paren.slice(1, -1)}>`);
    cur = wrapTrailingGenericArray(cur);
  } while (cur !== prev);
  return cur;
}

/** 处理 `Foo<...>[]` → `Array<Foo<...>>`：从 `>[]` 出发反向找到匹配的 `Ident<` */
function wrapTrailingGenericArray(s: string): string {
  let i = s.indexOf(">[]");
  while (i !== -1) {
    let depth = 1;
    let j = i - 1;
    while (j >= 0 && depth > 0) {
      if (s[j] === ">") depth++;
      else if (s[j] === "<") depth--;
      if (depth === 0) break;
      j--;
    }
    if (depth !== 0) break;
    let k = j - 1;
    while (k >= 0 && /[\w$.]/.test(s[k])) k--;
    const start = k + 1;
    const inner = s.slice(start, i + 1);
    s = s.slice(0, start) + `Array<${inner}>` + s.slice(i + 3);
    i = s.indexOf(">[]");
  }
  return s;
}

// ----------------------------------------------------------------------------
// enum-like block 检测 + 提到顶部
// ----------------------------------------------------------------------------

function sortEnumsFirst(blocks: TsBlock[]): TsBlock[] {
  const enumLike: TsBlock[] = [];
  const rest: TsBlock[] = [];
  for (const b of blocks) {
    if (isEnumLike(b)) enumLike.push(b);
    else rest.push(b);
  }
  return [...enumLike, ...rest];
}

function isEnumLike(b: TsBlock): boolean {
  if (!b.name) return false;
  const code = b.text
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*");
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:export\s+|declare\s+)*enum\s+\w+/.test(code)) return true;
  const m = /^(?:export\s+|declare\s+)*type\s+\w+\s*=\s*(.+?);?\s*$/.exec(code);
  if (!m) return false;
  const tokens = m[1].split("|").map((t) => t.trim());
  return tokens.every((t) => /^"(?:[^"\\]|\\.)*"$/.test(t) || t === "null" || /^-?\d+(?:\.\d+)?$/.test(t));
}

// ============================================================================
// paths.d.ts 渲染
// ============================================================================

function emitPaths(meta: MegaSchemaResult, cfg: TsLangConfig): string {
  if (cfg.base.module) return emitPathsModule(meta, cfg);
  const ns = cfg.base.rootNamespace;
  const allPaths = [...new Set(meta.ops.map((o) => o.path))].sort();
  const wantPath = cfg.base.emitPathRefs;
  const wantMethod = cfg.base.emitMethodRefs;
  // JSDoc 只挂一处（避免 PathRefs / MethodRefs 重复一份注释徒增解析体积）：
  // 优先放在 PathRefs；若不产 PathRefs，则放到 MethodRefs，保证文档始终存在且只存一份。
  const docOnPath = wantPath;
  const docOnMethod = wantMethod && !wantPath;

  let out = cfg.base.fileHeader;
  out += `declare namespace ${ns} {\n`;

  if (allPaths.length === 0) {
    out += "  type Paths = never\n\n";
  } else {
    out += "  type Paths =\n";
    out += allPaths.map((p) => `    | '${p}'`).join("\n");
    out += "\n\n";
  }

  const blocks: string[] = [];
  if (wantPath) blocks.push(renderPathRefs(meta, allPaths, cfg, docOnPath));
  if (wantMethod) blocks.push(renderMethodRefs(meta, allPaths, cfg, docOnMethod));
  out += blocks.join("\n");

  out += "}\n";
  return out;
}

/** path-major 索引 `PathRefs`：`{ [path]: { [method]: [response, request] } }`。
 *  openapi2lang 自己的 `OpenApi`/`Request` 消费它。 */
function renderPathRefs(meta: MegaSchemaResult, allPaths: string[], cfg: TsLangConfig, withJsDoc: boolean): string {
  let out = "  interface PathRefs {\n";
  for (const p of allPaths) {
    const opsOfPath = meta.ops.filter((o) => o.path === p);
    if (opsOfPath.length === 0) {
      out += `    '${p}': {}\n`;
      continue;
    }
    out += `    '${p}': {\n`;
    for (const op of opsOfPath) {
      const reqInfo = meta.reqInfoOf.get(opKey(op.path, op.method))!;
      const resExpr = renderResponse(meta.responseRefOf.get(opKey(op.path, op.method))!, cfg);
      const reqExpr = renderReq(reqInfo, cfg);
      if (withJsDoc) {
        const jsdoc = renderJsDoc(op, "      ");
        if (jsdoc) out += `${jsdoc}\n`;
      }
      out += `      ${op.method}: [response: ${resExpr}, request: ${reqExpr}]\n`;
    }
    out += "    }\n";
  }
  out += "  }\n";
  return out;
}

/**
 * method-major 索引 `MethodRefs` —— `PathRefs` 的「方法优先」预展开版本：
 *   { [method]: { [path]: [response, request] } }
 *
 * 这是静态产物（codegen 直接写出字面结构），不是 `type X = Indexed<PathRefs>` 的
 * 类型层反转：消费者（如 axp 的 `Core<T>`）按 `T[method][path]` 做 O(1) 字面查表，
 * 零条件类型计算，对 tsserver / IDE 内存友好。
 */
const METHOD_ORDER: readonly string[] = ["get", "post", "put", "delete", "patch", "options", "head"];

function renderMethodRefs(meta: MegaSchemaResult, allPaths: string[], cfg: TsLangConfig, withJsDoc: boolean): string {
  const present = [...new Set(meta.ops.map((o) => o.method))];
  const methods: string[] = [
    ...METHOD_ORDER.filter((m) => present.includes(m)),
    ...present.filter((m) => !METHOD_ORDER.includes(m)).sort(),
  ];

  let out = "  interface MethodRefs {\n";
  for (const m of methods) {
    out += `    ${m}: {\n`;
    for (const p of allPaths) {
      const op = meta.ops.find((o) => o.path === p && o.method === m);
      if (!op) continue;
      const reqInfo = meta.reqInfoOf.get(opKey(p, m))!;
      const resExpr = renderResponse(meta.responseRefOf.get(opKey(p, m))!, cfg);
      const reqExpr = renderReq(reqInfo, cfg);
      if (withJsDoc) {
        const jsdoc = renderJsDoc(op, "      ");
        if (jsdoc) out += `${jsdoc}\n`;
      }
      out += `      '${p}': [response: ${resExpr}, request: ${reqExpr}]\n`;
    }
    out += "    }\n";
  }
  out += "  }\n";
  return out;
}

/** 模块形态的 paths：`export type Paths` + `export interface PathRefs/MethodRefs`，
 *  并按引用情况补 `import type * as model from './response'` / `* as req from './request'`。 */
function emitPathsModule(meta: MegaSchemaResult, cfg: TsLangConfig): string {
  const ns = cfg.base.rootNamespace;
  const reqAlias = cfg.base.requestNamespace;
  const allPaths = [...new Set(meta.ops.map((o) => o.path))].sort();
  const wantPath = cfg.base.emitPathRefs;
  const wantMethod = cfg.base.emitMethodRefs;
  const docOnPath = wantPath;
  const docOnMethod = wantMethod && !wantPath;

  let body = "";
  if (allPaths.length === 0) body += "export type Paths = never\n";
  else body += "export type Paths =\n" + allPaths.map((p) => `  | '${p}'`).join("\n") + "\n";
  if (wantPath) body += "\n" + dedentExport(renderPathRefs(meta, allPaths, cfg, docOnPath));
  if (wantMethod) body += "\n" + dedentExport(renderMethodRefs(meta, allPaths, cfg, docOnMethod));

  const imports: string[] = [];
  if (body.includes(`${ns}.`)) imports.push(`import type * as ${ns} from "${baseNoExt(cfg.base.responseFile)}"`);
  if (body.includes(`${reqAlias}.`)) imports.push(`import type * as ${reqAlias} from "${baseNoExt(cfg.base.requestFile)}"`);
  const importText = imports.length ? imports.join("\n") + "\n\n" : "";

  return `${cfg.base.fileHeader}${importText}${body}`;
}

/** 把 namespace 缩进的渲染块降一级缩进并给首个声明行加 `export`（模块形态用）。 */
function dedentExport(block: string): string {
  const lines = block.replace(/\n+$/, "").split("\n").map((l) => (l.startsWith("  ") ? l.slice(2) : l));
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("interface ") || t.startsWith("type ")) {
      lines[i] = "export " + lines[i];
      break;
    }
  }
  return lines.join("\n") + "\n";
}

function renderResponse(ref: ResponseRef, cfg: TsLangConfig): string {
  const ns = cfg.base.rootNamespace;
  switch (ref.kind) {
    case "ref":
      return `${ns}.${ref.name}`;
    case "array-of-ref":
      return `Array<${ns}.${ref.name}>`;
    case "array-of-primitive":
      return `Array<${ref.primitive}>`;
    case "primitive":
      return ref.primitive;
    case "map-of-primitive":
      return `Record<string, ${ref.primitive}>`;
    case "map-of-ref":
      return `Record<string, ${ns}.${ref.name}>`;
    case "inline":
      return `${ns}.${ref.reqStyleName}`;
    case "none":
      return "unknown";
  }
}

/**
 * req 元组引用规则：
 *   - empty             → `[]`（无 payload，调用时不传参）
 *   - normal / ref-alias / ref-alias-extends / body-alias
 *                       → `[payload: model.req.<name>]`
 */
function renderReq(info: ReqInfo, cfg: TsLangConfig): string {
  if (info.kind === "empty") return "[]";
  // 全局：`model.req.X`；模块：`req.X`（req = `import type * as req from './request'` 的别名）
  const reqNs = cfg.base.module ? cfg.base.requestNamespace : `${cfg.base.rootNamespace}.${cfg.base.requestNamespace}`;
  return `[payload: ${reqNs}.${info.name}]`;
}

function renderJsDoc(op: OperationData, indent: string): string | null {
  const parts: string[] = [];
  if (op.summary) op.summary.split("\n").forEach((l) => parts.push(l));
  if (op.description && op.description !== op.summary) {
    if (parts.length) parts.push("");
    op.description.split("\n").forEach((l) => parts.push(l));
  }
  if (op.deprecated) parts.push("@deprecated");
  if (parts.length === 0) return null;
  const sanitized = parts.map((l) => l.replace(/\*\//g, "*\\/"));
  if (sanitized.length === 1) return `${indent}/** ${sanitized[0]} */`;
  return `${indent}/**\n${sanitized.map((l) => `${indent} * ${l}`.replace(/\s+$/, "")).join("\n")}\n${indent} */`;
}

function renderPropJsDoc(desc: string, indent: string): string[] {
  const lines = desc.split("\n").map((l) => l.replace(/\*\//g, "*\\/"));
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`.replace(/\s+$/, "")), `${indent} */`];
}

// ============================================================================
// JSON Schema → TypeScript 类型字符串（仅用于 ref-alias-extends 的 extendsProps）
// ============================================================================

/**
 * JSON Schema → TypeScript 类型字符串。仅服务于 ref-alias-extends 的 extendsProps 与
 * body-alias 的 bodySchema —— 这两类 schema 不进 mega-schema，无法被 quicktype 渲染。
 *
 * 内联 enum 已经在 schema 阶段由 {@link EnumLifter} 提升为顶层 `$ref`，因此本函数无需
 * 再处理 enum 字面量分支：所有 enum 都以 `{ $ref: '#/definitions/<Name>' }` 形态出现，
 * 走通用 ref 分支即可输出 `model.<Name>`。
 */
function schemaToTsType(schema: Schema, ns: string): string {
  if (!schema || typeof schema !== "object") return "unknown";

  if (typeof schema.$ref === "string") {
    const m = /[/#]([^/#]+)$/.exec(schema.$ref);
    return m ? `${ns}.${m[1]}` : "unknown";
  }

  const types: string[] = Array.isArray(schema.type) ? schema.type : typeof schema.type === "string" ? [schema.type] : [];
  const hasNull = types.includes("null");
  const nonNull = types.filter((t) => t !== "null");

  const base = nonNull.length === 0 ? "unknown" : nonNull.map((t) => primToTs(t, schema, ns)).join(" | ");

  return hasNull ? `${base} | null` : base;
}

function primToTs(type: string, schema: Schema, ns: string): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return schema.items ? `Array<${schemaToTsType(schema.items, ns)}>` : "Array<unknown>";
    case "object":
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

// ============================================================================
// 类型声明
// ============================================================================

interface TsBlock {
  text: string;
  name: string | null;
}
