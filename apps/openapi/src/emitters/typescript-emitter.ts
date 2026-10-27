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

import path from "path";

import type { TsLangConfig } from "../config/typescript";
import type { EmitContext, EmitOutput } from "../config/shared";
import { HTTP_METHOD_ORDER, opKey, type MegaSchemaResult, type OperationData, type ReqInfo, type ResponseRef, type Schema } from "../schema";
import { escapeSingleQuoted, opDocLines, stripQuicktypeHeader } from "./shared";

// ============================================================================
// 入口：emit
// ============================================================================

/**
 * TypeScript emitter：产出 response / request / paths 三个 `.d.ts`。
 * @param ctx 渲染上下文，含 quicktype 原始输出、mega-schema 元信息与 TypeScript 语言配置
 * @returns 三个文件的 `{ filename, content }`，顺序为 response、request、paths
 * @example
 * const [response, request, paths] = emitTypescript(ctx);
 * fs.writeFileSync(response.filename, response.content);
 */
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

/** 把 quicktype 输出切成 response / request 两份，补 model. 前缀、手写别名声明，并按 namespace 或模块形态包装 */
function splitAndWrap(quicktypeOutput: string, meta: MegaSchemaResult, cfg: TsLangConfig): { responseFile: string; requestFile: string } {
  // 后处理 #1：T[] → Array<T>（注释行、字符串字面量都不动）
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
  const definitions: Record<string, Schema> = meta.schema.definitions ?? {};
  const refAliasLines: string[] = [];
  for (const op of meta.ops) {
    const info = meta.reqInfoOf.get(opKey(op.path, op.method));
    if (!info) continue;
    if (info.kind !== "ref-alias" && info.kind !== "ref-alias-extends" && info.kind !== "body-alias") continue;

    const jsdoc = renderJsDoc(op, raI);
    if (jsdoc) refAliasLines.push(jsdoc);

    // 基类不是对象型（字符串/数组/enum/联合…）时 `interface extends` 非法，改走 type 别名
    const extendable = info.refName !== undefined && canExtendInterface(definitions[info.refName]);

    if (info.kind === "ref-alias") {
      refAliasLines.push(extendable ? `${raI}${raDecl}interface ${info.name} extends ${ns}.${info.refName} {}` : `${raI}${raDecl}type ${info.name} = ${ns}.${info.refName}`);
    } else if (info.kind === "ref-alias-extends" && info.extendsProps?.length) {
      refAliasLines.push(extendable ? `${raI}${raDecl}interface ${info.name} extends ${ns}.${info.refName} {` : `${raI}${raDecl}type ${info.name} = ${ns}.${info.refName} & {`);
      for (const prop of info.extendsProps) {
        const opt = prop.required ? "" : "?";
        const desc = typeof prop.schema?.description === "string" ? prop.schema.description : undefined;
        if (desc) refAliasLines.push(...renderPropJsDoc(desc, raPI));
        refAliasLines.push(`${raPI}${propertyKey(prop.name)}${opt}: ${schemaToTsType(prop.schema, ns)}`);
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
    const reqImport = reqNeedsModel ? `import type * as ${ns} from "${relativeImport(cfg.base.requestFile, cfg.base.responseFile)}"\n\n` : "";
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

/**
 * 判断某个 definition 能否作为 `interface X extends model.Y` 的基类。
 * 只有确定是对象型才返回 true：有 properties 或 type 为 object，且没有 `$ref`、oneOf/anyOf/allOf、enum，
 * type 为数组时要求全部元素都是 "object"（含 null 或其它类型都不行）。拿不准一律返回 false，调用方会退化成总是合法的 type 别名。
 */
function canExtendInterface(def: Schema): boolean {
  if (!def || typeof def !== "object" || Array.isArray(def)) return false;
  if (def.$ref !== undefined || def.oneOf || def.anyOf || def.allOf || Array.isArray(def.enum)) return false;
  const t = def.type;
  if (Array.isArray(t)) return t.length > 0 && t.every((x) => x === "object");
  if (t === undefined) return def.properties !== null && typeof def.properties === "object";
  return t === "object";
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

/**
 * 计算从 fromFile 所在目录到 toFile 的相对 import 路径（去掉 `.d.ts` / `.ts` 扩展名）。
 * 文件名可以带子目录（如 `types/request.d.ts` → `./response`，`api/req.d.ts` 引 `shared/res.d.ts` → `../shared/res`）。
 */
function relativeImport(fromFile: string, toFile: string): string {
  const from = fromFile.replace(/\\/g, "/");
  const to = toFile.replace(/\\/g, "/").replace(/\.d\.ts$|\.ts$/, "");
  // 两边都垫上根 "/"，避免 posix.relative 把相对路径按 process.cwd() 解析
  const rel = path.posix.relative(path.posix.dirname("/" + from), "/" + to);
  return rel.startsWith("./") || rel.startsWith("../") ? rel : "./" + rel;
}

/** 把 quicktype 输出按空行切成声明块；先剥掉头部用法注释 */
function parseBlocks(quicktypeOutput: string): TsBlock[] {
  const body = stripQuicktypeHeader(quicktypeOutput);

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

// ----------------------------------------------------------------------------
// 字符串字面量保护：改写代码时不碰引号里的内容
// ----------------------------------------------------------------------------

/** 匹配单行内的 `"..."` / `'...'` 字符串字面量（含反斜杠转义） */
const STRING_LITERAL_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/** 字面量占位符的定界字符（Unicode 私有区，不会出现在 quicktype 输出里） */
const MASK_CHAR = "";
const MASK_RE = new RegExp(`${MASK_CHAR}(\\d+)${MASK_CHAR}`, "g");

/**
 * 把一行里的字符串字面量先换成占位符，只对「代码部分」应用 fn，再把字面量原样还原。
 * 这样 `"items[]"`、`"Tag"` 这类带引号的属性名/字面量不会被改写，
 * 而 `("a" | "b")[]` 这种跨字面量的结构仍能被 fn 整体识别。
 */
function transformCode(line: string, fn: (maskedCode: string) => string): string {
  const literals: string[] = [];
  const masked = line.replace(STRING_LITERAL_RE, (m) => {
    literals.push(m);
    return `${MASK_CHAR}${literals.length - 1}${MASK_CHAR}`;
  });
  return fn(masked).replace(MASK_RE, (_m, i: string) => literals[Number(i)]);
}

/** 是否是 JSDoc / 行注释行（改写时要整行跳过） */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
}

/**
 * 在非注释行的代码部分，对每个匹配 needsPrefix 的裸标识符加 model. 前缀。
 *   - 跳过 JSDoc / 行注释（确保 shape/field 注释里的原文不被改写）
 *   - 字符串字面量不动（带引号的属性名、字面量类型）
 *   - 已是 model.X 形式不动（前置 . 检查）
 *   - 属性键位置不动：标识符后紧跟（可选 `?`）再跟 `:` 的是属性名，不是类型引用
 */
function rewriteRefs(text: string, needsPrefix: Set<string>, ns: string): string {
  if (needsPrefix.size === 0) return text;
  const names = [...needsPrefix].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\w$.])(${names.map(escapeRe).join("|")})(?![\\w$])(?!\\s*\\??\\s*:)`, "g");

  return text
    .split("\n")
    .map((line) => {
      if (!line.trim() || isCommentLine(line)) return line;
      return transformCode(line, (code) => code.replace(pattern, (_m, name: string) => `${ns}.${name}`));
    })
    .join("\n");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ----------------------------------------------------------------------------
// T[] → Array<T> 后处理
// ----------------------------------------------------------------------------

/** 把 quicktype 输出里的 `T[]` 改成 `Array<T>`（注释行与字符串字面量不动） */
function bracketArrayToGeneric(src: string): string {
  return src
    .split("\n")
    .map((line) => (isCommentLine(line) ? line : transformCode(line, rewriteArrayBracketsInLine)))
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

/** paths 渲染前一次性算好的共用数据：路径表、开关、按 path / (path, method) 建好的 op 索引 */
interface PathsContext {
  /** 去重排序后的全部 path */
  allPaths: string[];
  wantPath: boolean;
  wantMethod: boolean;
  /** JSDoc 挂在 PathRefs 上 */
  docOnPath: boolean;
  /** JSDoc 挂在 MethodRefs 上（仅当不产 PathRefs） */
  docOnMethod: boolean;
  /** path → 该 path 下的 op（保持 meta.ops 顺序） */
  opsByPath: Map<string, OperationData[]>;
  /** opKey(path, method) → op */
  opByKey: Map<string, OperationData>;
}

/** 构建 {@link PathsContext}；emitPaths 与 emitPathsModule 共用，避免各算一遍 */
function buildPathsContext(meta: MegaSchemaResult, cfg: TsLangConfig): PathsContext {
  const opsByPath = new Map<string, OperationData[]>();
  const opByKey = new Map<string, OperationData>();
  for (const op of meta.ops) {
    const list = opsByPath.get(op.path);
    if (list) list.push(op);
    else opsByPath.set(op.path, [op]);
    opByKey.set(opKey(op.path, op.method), op);
  }
  const wantPath = cfg.base.emitPathRefs;
  const wantMethod = cfg.base.emitMethodRefs;
  return {
    allPaths: [...opsByPath.keys()].sort(),
    wantPath,
    wantMethod,
    // JSDoc 只挂一处（避免 PathRefs / MethodRefs 重复一份注释徒增解析体积）：
    // 优先放在 PathRefs；若不产 PathRefs，则放到 MethodRefs，保证文档始终存在且只存一份。
    docOnPath: wantPath,
    docOnMethod: wantMethod && !wantPath,
    opsByPath,
    opByKey,
  };
}

/** 渲染 paths.d.ts：全局形态写 declare namespace，模块形态转交 {@link emitPathsModule} */
function emitPaths(meta: MegaSchemaResult, cfg: TsLangConfig): string {
  if (cfg.base.module) return emitPathsModule(meta, cfg);
  const ns = cfg.base.rootNamespace;
  const pc = buildPathsContext(meta, cfg);

  let out = cfg.base.fileHeader;
  out += `declare namespace ${ns} {\n`;

  if (pc.allPaths.length === 0) {
    out += "  type Paths = never\n\n";
  } else {
    out += "  type Paths =\n";
    out += pc.allPaths.map((p) => `    | '${escapeSingleQuoted(p)}'`).join("\n");
    out += "\n\n";
  }

  const blocks: string[] = [];
  if (pc.wantPath) blocks.push(renderPathRefs(meta, pc, cfg));
  if (pc.wantMethod) blocks.push(renderMethodRefs(meta, pc, cfg));
  out += blocks.join("\n");

  out += "}\n";
  return out;
}

/** path-major 索引 `PathRefs`：`{ [path]: { [method]: [response, request] } }`。
 *  openapi2lang 自己的 `OpenApi`/`Request` 消费它。 */
function renderPathRefs(meta: MegaSchemaResult, pc: PathsContext, cfg: TsLangConfig): string {
  let out = "  interface PathRefs {\n";
  for (const p of pc.allPaths) {
    const opsOfPath = pc.opsByPath.get(p) ?? [];
    const key = `'${escapeSingleQuoted(p)}'`;
    if (opsOfPath.length === 0) {
      out += `    ${key}: {}\n`;
      continue;
    }
    out += `    ${key}: {\n`;
    for (const op of opsOfPath) {
      const reqInfo = meta.reqInfoOf.get(opKey(op.path, op.method))!;
      const resExpr = renderResponse(meta.responseRefOf.get(opKey(op.path, op.method))!, cfg);
      const reqExpr = renderReq(reqInfo, cfg);
      if (pc.docOnPath) {
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
function renderMethodRefs(meta: MegaSchemaResult, pc: PathsContext, cfg: TsLangConfig): string {
  const present = [...new Set(meta.ops.map((o) => o.method))];
  const methods: string[] = [...HTTP_METHOD_ORDER.filter((m) => present.includes(m)), ...present.filter((m) => !HTTP_METHOD_ORDER.includes(m)).sort()];

  let out = "  interface MethodRefs {\n";
  for (const m of methods) {
    out += `    ${m}: {\n`;
    for (const p of pc.allPaths) {
      const op = pc.opByKey.get(opKey(p, m));
      if (!op) continue;
      const reqInfo = meta.reqInfoOf.get(opKey(p, m))!;
      const resExpr = renderResponse(meta.responseRefOf.get(opKey(p, m))!, cfg);
      const reqExpr = renderReq(reqInfo, cfg);
      if (pc.docOnMethod) {
        const jsdoc = renderJsDoc(op, "      ");
        if (jsdoc) out += `${jsdoc}\n`;
      }
      out += `      '${escapeSingleQuoted(p)}': [response: ${resExpr}, request: ${reqExpr}]\n`;
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
  const pc = buildPathsContext(meta, cfg);

  let body = "";
  if (pc.allPaths.length === 0) body += "export type Paths = never\n";
  else body += "export type Paths =\n" + pc.allPaths.map((p) => `  | '${escapeSingleQuoted(p)}'`).join("\n") + "\n";
  if (pc.wantPath) body += "\n" + dedentExport(renderPathRefs(meta, pc, cfg));
  if (pc.wantMethod) body += "\n" + dedentExport(renderMethodRefs(meta, pc, cfg));

  const imports: string[] = [];
  if (body.includes(`${ns}.`)) imports.push(`import type * as ${ns} from "${relativeImport(cfg.base.pathsFile, cfg.base.responseFile)}"`);
  if (body.includes(`${reqAlias}.`)) imports.push(`import type * as ${reqAlias} from "${relativeImport(cfg.base.pathsFile, cfg.base.requestFile)}"`);
  const importText = imports.length ? imports.join("\n") + "\n\n" : "";

  return `${cfg.base.fileHeader}${importText}${body}`;
}

/** 把 namespace 缩进的渲染块降一级缩进并给首个声明行加 `export`（模块形态用）。 */
function dedentExport(block: string): string {
  const lines = block
    .replace(/\n+$/, "")
    .split("\n")
    .map((l) => (l.startsWith("  ") ? l.slice(2) : l));
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

/** op 文档注释（JSDoc 形式）；没有文档信息返回 null */
function renderJsDoc(op: OperationData, indent: string): string | null {
  const parts = opDocLines(op);
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
// JSON Schema → TypeScript 类型字符串（仅用于 ref-alias-extends 的 extendsProps 与 body-alias）
// ============================================================================

/** 合法的 TS 标识符（可直接作属性名） */
const TS_IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** 属性名：合法标识符原样输出，否则用 JSON 字符串字面量加引号（如 `"X-Request-Id"`）。 */
function propertyKey(name: string): string {
  return TS_IDENT_RE.test(name) ? name : JSON.stringify(name);
}

/** schema 渲染出来是否是顶层联合类型（放进交叉类型时需要加括号） */
function isUnionSchema(schema: Schema): boolean {
  if (!schema || typeof schema !== "object") return false;
  if ((Array.isArray(schema.oneOf) && schema.oneOf.length > 1) || (Array.isArray(schema.anyOf) && schema.anyOf.length > 1)) return true;
  if (Array.isArray(schema.enum) && schema.enum.length > 1) return true;
  return Array.isArray(schema.type) && schema.type.length > 1;
}

/**
 * JSON Schema → TypeScript 类型字符串。仅服务于 ref-alias-extends 的 extendsProps 与
 * body-alias 的 bodySchema —— 这两类 schema 不进 mega-schema，无法被 quicktype 渲染。
 *
 * 支持：`$ref`、`const` / `enum` 字面量、oneOf/anyOf（` | `）、allOf（` & `）、
 * 带 properties 的对象（内联 `{ a: T; b?: U }`）、additionalProperties（`Record<string, T>`）、
 * 数组与基础类型。纯 `{ type: "null" }` 渲染为 `null`。
 *
 * 内联 enum 通常已在 schema 阶段由 EnumLifter 提升为顶层 `$ref`，走通用 ref 分支即可输出 `model.<Name>`。
 */
function schemaToTsType(schema: Schema, ns: string): string {
  if (!schema || typeof schema !== "object") return "unknown";

  if (typeof schema.$ref === "string") {
    const m = /[/#]([^/#]+)$/.exec(schema.$ref);
    return m ? `${ns}.${m[1]}` : "unknown";
  }

  if ("const" in schema) return JSON.stringify(schema.const) ?? "unknown";
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum.map((v: unknown) => JSON.stringify(v) ?? "unknown").join(" | ");

  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(schema[key]) && schema[key].length > 0) return schema[key].map((s: Schema) => schemaToTsType(s, ns)).join(" | ");
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return schema.allOf.map((s: Schema) => (isUnionSchema(s) ? `(${schemaToTsType(s, ns)})` : schemaToTsType(s, ns))).join(" & ");
  }

  let types: string[] = Array.isArray(schema.type) ? schema.type : typeof schema.type === "string" ? [schema.type] : [];
  // 没写 type 但有 properties / additionalProperties，按对象处理
  if (types.length === 0 && (schema.properties || schema.additionalProperties)) types = ["object"];
  const hasNull = types.includes("null");
  const nonNull = types.filter((t) => t !== "null");

  if (nonNull.length === 0) return hasNull ? "null" : "unknown";
  const base = nonNull.map((t) => primToTs(t, schema, ns)).join(" | ");
  return hasNull ? `${base} | null` : base;
}

/** 单个 JSON Schema 基础类型名 → TS 类型字符串；array / object 会继续递归 */
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
      return objectToTs(schema, ns);
    default:
      return "unknown";
  }
}

/** 对象 schema → 内联对象类型 / Record；required 决定属性是否带 `?` */
function objectToTs(schema: Schema, ns: string): string {
  const props = schema.properties;
  if (props && typeof props === "object" && Object.keys(props).length > 0) {
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    const members = Object.entries(props).map(([name, s]) => `${propertyKey(name)}${required.has(name) ? "" : "?"}: ${schemaToTsType(s, ns)}`);
    // 同时允许额外字段时追加索引签名；unknown 与任何属性类型都兼容，不会触发签名冲突
    if (schema.additionalProperties === true || (schema.additionalProperties && typeof schema.additionalProperties === "object")) members.push("[key: string]: unknown");
    return `{ ${members.join("; ")} }`;
  }
  const ap = schema.additionalProperties;
  if (ap && typeof ap === "object") return `Record<string, ${schemaToTsType(ap, ns)}>`;
  if (ap === false) return "Record<string, never>";
  return "Record<string, unknown>";
}

// ============================================================================
// 类型声明
// ============================================================================

interface TsBlock {
  text: string;
  name: string | null;
}
