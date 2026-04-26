// OpenAPI doc → quicktype 喂得动的 mega-schema。
//
// 流水线：
//   1. loadOpenAPI       拉取/读取 OpenAPI doc + v2→v3 归一化
//   2. forEachOperation  遍历 paths，抽 op 数据（path/query/header/body/响应）
//   3. normalizeSchema   OpenAPI → JSON Schema：nullable/title/$ref/strict-objects
//   4. synthesizeRequest 合成每个 op 的 req schema（含路径参数 + body 拍平）
//   5. buildMegaSchema   组装成 #/definitions/ 下的大 schema，由 quicktype 单 source 渲染
//
// 关键决策：
//   - 单 source + URI 尾斜杠（'#/definitions/'）让 quicktype 自动暴露所有 top-level，
//     并通过内部 typeForCanonicalRef 跨引用去重。
//   - 纯 ref body（如 PUT /pet 的 body 是 $ref Pet）不再造 req definition——否则会和
//     底层 ref 形成 dedupe 冲突，谁先谁活。直接在 paths 里引用底层名。
//   - 空 req（无任何参数与 body）不写入 definitions——quicktype 对空对象处理不可靠。
//     paths 文件单独渲染（TS Record<string,never> / Dart Object?）。
//   - v2 (Swagger 2.0) 与 v3 在结构差异较大（definitions/parameters body/responses schema 等），
//     在加载阶段一次性 normalize 到 v3 形态，后续提取代码不区分版本。

import fs from "fs/promises";
import path from "path";

import yaml from "js-yaml";

import type { BaseConfig } from "./config/shared";

// ============================================================================
// 加载
// ============================================================================
//
// 支持 JSON / YAML 两种格式；远程 URL 与本地路径都可。
// 格式判断顺序：
//   1. 看扩展名（.yaml / .yml → YAML；否则尝试 JSON）
//   2. JSON.parse 抛错时回退到 YAML 解析（兼容内容是 YAML 但无扩展名的远程 URL）

/**
 * 统一入口：把 5 种输入形态都解析成 JS 对象（最终被 buildMegaSchema → JSON.stringify 喂给 quicktype）。
 *
 * `source` 接受：
 *   1. 已解析对象       —— 直接走归一化（如 `import json from './openapi.json'`）
 *   2. 远程 URL          —— `http(s)://...`，fetch 后按内容解析
 *   3. 内联 JSON 字符串  —— 以 `{` 或 `[` 开头（trim 后），直接 JSON.parse
 *   4. 内联 YAML 字符串  —— 含换行符的字符串视为内联文本（路径不会有换行）
 *   5. 文件路径          —— 其余字符串当作绝对/相对路径，按扩展名 / 内容嗅探解析
 */
export async function loadOpenAPI(source: string | Record<string, unknown>, projectRoot: string): Promise<OpenAPIDoc> {
  // 形态 1：已是 JS 对象
  if (typeof source !== "string") {
    return convertV2ToV3(source as OpenAPIDoc);
  }

  const classified = classifySource(source);

  switch (classified.kind) {
    // 形态 3：内联 JSON 文本——sourceLabel 用伪扩展名让 parseDoc 走 JSON 优先路径
    case "inline-json":
      return convertV2ToV3(parseDoc(classified.text, "<inline.json>"));

    // 形态 4：内联 YAML 文本——伪 .yaml 扩展名让 parseDoc 直走 YAML
    case "inline-yaml":
      return convertV2ToV3(parseDoc(classified.text, "<inline.yaml>"));

    // 形态 2：远程 URL
    case "url": {
      const r = await fetch(classified.value);
      if (!r.ok) throw new Error(`fetch ${classified.value} -> ${r.status} ${r.statusText}`);
      const text = await r.text();
      return convertV2ToV3(parseDoc(text, new URL(classified.value).pathname));
    }

    // 形态 5：文件路径
    case "file": {
      const full = path.isAbsolute(classified.path) ? classified.path : path.resolve(projectRoot, classified.path);
      const text = await fs.readFile(full, "utf-8");
      return convertV2ToV3(parseDoc(text, full));
    }
  }
}

type ClassifiedSource = { kind: "url"; value: string } | { kind: "inline-json"; text: string } | { kind: "inline-yaml"; text: string } | { kind: "file"; path: string };

/**
 * 按以下优先级辨别字符串语义：
 *   url      → 以 http(s):// 开头
 *   inline-json → trim 后以 `{` 或 `[` 开头（OpenAPI 顶层是 object，普通用户也常 paste JSON）
 *   inline-yaml → 字符串含换行（文件路径不会带换行；YAML doc 至少多行）
 *   file     → 兜底，当作路径
 */
function classifySource(source: string): ClassifiedSource {
  if (/^https?:\/\//i.test(source)) {
    return { kind: "url", value: source };
  }
  const trimmed = source.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { kind: "inline-json", text: source };
  }
  if (source.includes("\n")) {
    return { kind: "inline-yaml", text: source };
  }
  return { kind: "file", path: source };
}

/**
 * 把字符串解析成 JS 对象。
 *
 * - sourceLabel 以 `.yaml`/`.yml` 结尾 → 走 YAML 解析
 * - 否则 → 先 JSON.parse，失败回退 YAML（兜底无扩展名的 YAML 流）
 */
function parseDoc(text: string, sourceLabel: string): OpenAPIDoc {
  const isYamlExt = /\.ya?ml$/i.test(sourceLabel);
  if (isYamlExt) return yaml.load(text) as OpenAPIDoc;
  try {
    return JSON.parse(text) as OpenAPIDoc;
  } catch {
    return yaml.load(text) as OpenAPIDoc;
  }
}

// ============================================================================
// Swagger 2.0 → OpenAPI 3.0 归一化
// ============================================================================
//
// 在加载阶段一次性把 v2 doc 改写成 v3 形态，后续 pipeline 完全不区分版本。
//
// 主要差异点：
//   1. 文档版本字段：     v2 `swagger: '2.0'`        v3 `openapi: '3.x.x'`
//   2. 组件 schema：      v2 `definitions`           v3 `components.schemas`
//   3. 共享 parameters/responses： v2 顶层            v3 `components.parameters/responses`
//   4. $ref 路径：        v2 `#/definitions/X`       v3 `#/components/schemas/X`
//   5. body 参数：        v2 `parameters[in=body]`   v3 `requestBody.content[mt].schema`
//   6. formData：         v2 `parameters[in=formData]` v3 `requestBody.content[multipart].schema` (object)
//   7. query/path/header 参数 schema：v2 type/format 平铺   v3 `param.schema` 包装
//   8. content type：     v2 `consumes`/`produces` 数组    v3 由 content key 决定
//   9. response schema：  v2 `responses[code].schema`      v3 `responses[code].content[mt].schema`
//  10. type:'file'：      v2 独有                    v3 用 `type:string, format:binary`
//
// 不做的事：
//   - host/basePath/schemes 转 servers（本脚本不读这些）
//   - securityDefinitions 转 components.securitySchemes（本脚本不读 security）

function convertV2ToV3(doc: OpenAPIDoc): OpenAPIDoc {
  if (!doc || typeof doc !== "object") return doc;

  // 版本检测：用 startsWith('2.') / startsWith('3.') 而非硬等，匹配 '2.0' / '2.0.1' / '3.0.3' 等。
  // 同时 String() 强转 + trim 处理两种边界：YAML 把 2.0 当 number 解析；字段含前后空格。
  const swagger = String((doc as any).swagger ?? "").trim();
  const openapi = String((doc as any).openapi ?? "").trim();

  // 'X' 或 'X.' 都算命中——后者覆盖正常 '2.0'/'3.0.3'，前者覆盖 YAML 把 2.0 解析成 number 后 String() 得到 '2' 的情况
  const matchVer = (s: string, major: string) => s === major || s.startsWith(`${major}.`);
  if (matchVer(openapi, "3")) return doc; // v3 不需要转
  if (!matchVer(swagger, "2")) {
    console.warn(`⚠️  未识别的 OpenAPI 版本（swagger='${swagger}', openapi='${openapi}'），按 v3 形态尝试处理`);
    return doc;
  }
  console.log(`📦 检测到 Swagger ${swagger}，转换为 OpenAPI 3.0`);

  const out: any = JSON.parse(JSON.stringify(doc));
  const consumesGlobal: string[] = Array.isArray(out.consumes) ? out.consumes : [];
  const producesGlobal: string[] = Array.isArray(out.produces) ? out.produces : [];

  // 共享 parameters 用于解引用 op-level $ref
  const sharedParams: Record<string, any> = out.parameters && typeof out.parameters === "object" ? out.parameters : {};

  // 1. 逐 op 转换：先解 $ref 参数，再拆 body/formData，再把 type 字段塞进 schema
  for (const [_pathKey, item] of Object.entries(out.paths || {})) {
    if (!item || typeof item !== "object") continue;
    const pi: any = item;
    if (Array.isArray(pi.parameters)) pi.parameters = convertV2Params(pi.parameters, sharedParams);

    for (const [methodKey, op] of Object.entries(pi)) {
      if (methodKey === "parameters" || !op || typeof op !== "object") continue;
      if (!HTTP_METHODS.has(methodKey.toLowerCase())) continue;
      convertV2Operation(op as any, sharedParams, consumesGlobal, producesGlobal);
    }
  }

  // 2. 组件搬迁
  out.components = out.components || {};
  if (out.definitions) out.components.schemas = { ...out.components.schemas, ...out.definitions };
  if (out.parameters) out.components.parameters = { ...out.components.parameters, ...out.parameters };
  if (out.responses) out.components.responses = { ...out.components.responses, ...out.responses };

  // 3. 全文档 $ref 路径改写
  rewriteV2Refs(out);

  // 4. 递归把所有 schema 中的 type:'file' 改成 type:'string', format:'binary'
  fixV2TypeFile(out);

  // 5. 清理 v2 顶层字段
  delete out.swagger;
  delete out.definitions;
  delete out.parameters; // 顶层 parameters（共享池），已迁到 components
  delete out.responses; // 顶层 responses（共享池），已迁到 components
  delete out.consumes;
  delete out.produces;
  delete out.host;
  delete out.basePath;
  delete out.schemes;
  delete out.securityDefinitions;
  out.openapi = "3.0.0";
  return out as OpenAPIDoc;
}

/** 把 v2 op 的 parameters / requestBody / responses / consumes / produces 全部转成 v3 形态 */
function convertV2Operation(op: any, sharedParams: Record<string, any>, consumesGlobal: string[], producesGlobal: string[]): void {
  const consumes = Array.isArray(op.consumes) ? op.consumes : consumesGlobal;
  const produces = Array.isArray(op.produces) ? op.produces : producesGlobal;

  if (Array.isArray(op.parameters)) {
    const { rest, body, formData } = splitV2Params(convertV2Params(op.parameters, sharedParams));
    op.parameters = rest;
    if (body) op.requestBody = bodyParamToRequestBody(body, consumes);
    else if (formData.length) op.requestBody = formDataToRequestBody(formData, consumes);
  }

  if (op.responses && typeof op.responses === "object") {
    for (const code of Object.keys(op.responses)) {
      const resp = op.responses[code];
      if (!resp || typeof resp !== "object" || resp.$ref) continue;
      if (resp.schema) {
        const mts = produces.length ? produces : ["application/json"];
        resp.content = {};
        for (const mt of mts) resp.content[mt] = { schema: resp.schema };
        delete resp.schema;
      }
      delete resp.examples; // v2 examples 形态与 v3 不同；后续 normalize 会再 strip example 类字段
    }
  }

  delete op.consumes;
  delete op.produces;
}

/** 解 op-level / path-level 参数中的 $ref（指向顶层共享 parameters），并把每个非 body 参数的 type 字段塞进 schema */
function convertV2Params(params: any[], sharedParams: Record<string, any>): any[] {
  const out: any[] = [];
  for (const p of params) {
    if (!p || typeof p !== "object") continue;
    let real = p;
    if (typeof p.$ref === "string") {
      const m = /^#\/parameters\/(.+)$/.exec(p.$ref);
      if (m && sharedParams[m[1]]) real = JSON.parse(JSON.stringify(sharedParams[m[1]]));
      else {
        out.push(p);
        continue;
      } // 解不出来就保留原 ref（后续会被 rewriteV2Refs 改成 v3 路径）
    }
    if (real.in === "body" || real.in === "formData") {
      out.push(real);
      continue;
    }
    out.push(v2NonBodyParamToV3(real));
  }
  return out;
}

/** v2 query/path/header 参数：把 type/format/items/enum/default/minimum/maximum/pattern 等塞进 schema */
function v2NonBodyParamToV3(p: any): any {
  if (p.schema) return p; // 已是 v3 形态
  const NON_SCHEMA_KEYS = new Set(["name", "in", "required", "description", "deprecated", "example", "allowEmptyValue", "collectionFormat", "style", "explode", "allowReserved"]);
  const head: Record<string, any> = {};
  const schemaLike: Record<string, any> = {};
  for (const [k, v] of Object.entries(p)) {
    if (NON_SCHEMA_KEYS.has(k)) head[k] = v;
    else schemaLike[k] = v;
  }
  return { ...head, schema: schemaLike };
}

function splitV2Params(params: any[]): { rest: any[]; body: any | null; formData: any[] } {
  const rest: any[] = [];
  let body: any = null;
  const formData: any[] = [];
  for (const p of params) {
    if (p?.in === "body") body = p;
    else if (p?.in === "formData") formData.push(p);
    else rest.push(p);
  }
  return { rest, body, formData };
}

function bodyParamToRequestBody(bodyParam: any, consumes: string[]): any {
  const mts = consumes.length ? consumes : ["application/json"];
  const content: Record<string, any> = {};
  for (const mt of mts) content[mt] = { schema: bodyParam.schema };
  return {
    description: bodyParam.description,
    required: !!bodyParam.required,
    content,
  };
}

function formDataToRequestBody(formParams: any[], consumes: string[]): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  let hasFile = false;
  for (const f of formParams) {
    const { name, required: req, in: _in, description, ...rest } = f;
    const schema: any = rest.type === "file" ? ((hasFile = true), { type: "string", format: "binary" }) : { ...rest };
    if (description) schema.description = description;
    properties[name] = schema;
    if (req) required.push(name);
  }
  const mt =
    consumes.find((c) => c === "multipart/form-data") ?? consumes.find((c) => c === "application/x-www-form-urlencoded") ?? (hasFile ? "multipart/form-data" : "application/x-www-form-urlencoded");
  const schema: any = { type: "object", properties };
  if (required.length) schema.required = required;
  return { required: required.length > 0, content: { [mt]: { schema } } };
}

function rewriteV2Refs(node: any): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) rewriteV2Refs(v);
    return;
  }
  if (typeof node.$ref === "string") {
    if (node.$ref.startsWith("#/definitions/")) node.$ref = "#/components/schemas/" + node.$ref.slice("#/definitions/".length);
    else if (node.$ref.startsWith("#/parameters/")) node.$ref = "#/components/parameters/" + node.$ref.slice("#/parameters/".length);
    else if (node.$ref.startsWith("#/responses/")) node.$ref = "#/components/responses/" + node.$ref.slice("#/responses/".length);
  }
  for (const v of Object.values(node)) rewriteV2Refs(v);
}

function fixV2TypeFile(node: any): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) fixV2TypeFile(v);
    return;
  }
  if (node.type === "file") {
    node.type = "string";
    if (!node.format) node.format = "binary";
  }
  for (const v of Object.values(node)) fixV2TypeFile(v);
}

// ============================================================================
// 命名工具（path + method → PascalCase / camelCase）
// ============================================================================

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "options", "head"]);

export function isHttpMethod(s: string): boolean {
  return HTTP_METHODS.has(s.toLowerCase());
}

/**
 * PascalCase。'find_by_status' → 'FindByStatus'，'2fa' → '2Fa'。
 * 在大小写边界、数字边界、非字母数字处切分。
 */
export function pascalCase(input: string): string {
  if (!input) return "";
  const parts = String(input)
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

/**
 * op 的 PascalCase 类型名。优先用 OpenAPI 的 operationId，缺失或不合法时回退到 path+method。
 *   getPetById          → GetPetById              （首选）
 *   updatePetWithForm   → UpdatePetWithForm
 *   (没有 operationId)  → GetPetByPetId           （回退：path+method）
 *
 * 不合法判定：pascalCase 后产出空串、或首字符不是字母 / _ / $（如 operationId='123abc'
 * 产出 '123Abc'，作为 TS/Dart 类型名都非法）。这种情况一并走回退。
 */
export function opTypeName(op: OperationData): string {
  if (op.operationId) {
    const pascal = pascalCase(op.operationId);
    if (pascal && /^[A-Za-z_$]/.test(pascal)) return pascal;
  }
  return pathMethodFallbackName(op.path, op.method);
}

/** op 的 lowerCamelCase 字段名（用于 Dart 注册表的 const 字段名） */
export function opCamelName(op: OperationData): string {
  const pascal = opTypeName(op);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * 回退命名：op 没有 operationId 时使用。
 *   GET /pet/{petId}        → GetPetByPetId
 *   POST /pet               → PostPet
 *   GET /pet/findByStatus   → GetPetFindByStatus
 *   GET /                   → GetRoot
 */
function pathMethodFallbackName(p: string, method: string): string {
  const segs = p.split("/").filter(Boolean);
  const pieces: string[] = [pascalCase(method)];
  if (segs.length === 0) {
    pieces.push("Root");
  } else {
    for (const s of segs) {
      const m = /^\{(.+)\}$/.exec(s);
      if (m) pieces.push("By", pascalCase(m[1]));
      else pieces.push(pascalCase(s));
    }
  }
  return pieces.join("") || "Op";
}

/** 在 used 集合中分配唯一名字；冲突时按 baseConfig.conflictSuffix 加后缀。 */
function uniqueName(name: string, used: Set<string>, baseCfg: BaseConfig): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 1;
  while (used.has(baseCfg.conflictSuffix(name, i))) i++;
  const final = baseCfg.conflictSuffix(name, i);
  used.add(final);
  return final;
}

export const opKey = (p: string, method: string): string => `${p}::${method}`;

// ============================================================================
// 遍历 op + 抽取数据
// ============================================================================

function forEachOperation(doc: OpenAPIDoc, baseCfg: BaseConfig, fn: (op: OperationData) => void): void {
  const paths = Object.keys(doc.paths || {}).sort();
  const methodOrder = baseCfg.httpMethodOrder;
  for (const p of paths) {
    const item = doc.paths![p];
    if (!item || typeof item !== "object") continue;
    // OpenAPI 允许 path-level parameters 被所有 method 继承
    const pathLevelParams: any[] = Array.isArray(item.parameters) ? item.parameters : [];
    const methods = Object.keys(item)
      .filter(isHttpMethod)
      .sort((a, b) => methodOrder.indexOf(a) - methodOrder.indexOf(b));
    for (const m of methods) {
      const op = item[m];
      if (!op || typeof op !== "object") continue;
      fn(buildOpData(p, m, op, pathLevelParams));
    }
  }
}

function buildOpData(p: string, method: string, op: any, pathLevelParams: any[]): OperationData {
  const params = mergeParams(pathLevelParams, op.parameters || []).map(toParamData);
  return {
    path: p,
    method,
    operationId: op.operationId,
    summary: op.summary,
    description: op.description,
    deprecated: op.deprecated === true,
    params,
    body: extractBody(op),
    responseSchema: extractSuccessResponse(op),
  };
}

/** 同名同 in 的 op-level param 覆盖 path-level；按 (name, in) 唯一去重。 */
function mergeParams(pathLevel: any[], opLevel: any[]): any[] {
  const k = (p: any) => `${p?.in}::${p?.name}`;
  const map = new Map<string, any>();
  for (const p of pathLevel) if (p && p.name && p.in) map.set(k(p), p);
  for (const p of opLevel) if (p && p.name && p.in) map.set(k(p), p);
  return [...map.values()];
}

function toParamData(p: any): ParamData {
  return {
    name: String(p.name),
    in: p.in,
    required: p.in === "path" ? true : !!p.required,
    schema: p.schema || { type: "string" },
    description: p.description,
    deprecated: p.deprecated,
    example: p.example,
  };
}

function extractBody(op: any): BodyData | null {
  const rb = op.requestBody;
  if (!rb || typeof rb !== "object") return null;
  const content = rb.content;
  if (!content || typeof content !== "object") return null;
  const mediaType = pickMediaType(content);
  if (!mediaType) return null;
  const schema = content[mediaType]?.schema;
  if (!schema) return null;
  return { schema, required: !!rb.required, mediaType };
}

function extractSuccessResponse(op: any): Schema | null {
  const responses = op.responses;
  if (!responses || typeof responses !== "object") return null;
  const codes = Object.keys(responses);
  // 优先 2xx，其次 default，其次第一个有 content 的
  const code = codes.find((c) => /^2\d\d$/.test(c)) || (codes.includes("default") ? "default" : codes.find((c) => responses[c]?.content)) || null;
  if (!code) return null;
  const content = responses[code]?.content;
  if (!content || typeof content !== "object") return null;
  const mediaType = pickMediaType(content);
  if (!mediaType) return null;
  return content[mediaType]?.schema ?? null;
}

function pickMediaType(content: Record<string, any>): string | null {
  const keys = Object.keys(content);
  if (!keys.length) return null;
  return keys.find((k) => k.includes("json")) || keys[0];
}

// ============================================================================
// schema 归一化（OpenAPI 3.x → JSON Schema 子集）
// ============================================================================
//
// 必须处理的方言（来自 quicktype 源码考察 + 实测）：
//   - nullable: true       → type: ["X", "null"]   （quicktype 不识别 nullable）
//   - $ref 路径重写        → #/components/schemas/X → #/definitions/X
//   - title 顶层剥离       → title 会覆盖 source name；剥掉以保证用 definitions key 命名
//   - example/examples     → quicktype 会消费 example 做推断，删掉减少噪音
//   - readOnly/writeOnly   → quicktype 不消费
//   - xml/externalDocs     → quicktype 不消费
//   - discriminator        → quicktype 不识别（等价于纯 union）
//   - format: binary       → quicktype 不识别；保留 type:'string'，下游若要 Blob/Uint8List
//                            自行后处理
//   - closed objects       → strictObjects=true 时 properties 已定义但 additionalProperties
//                            未定义的对象设为 false，避免 [key: string]: any
//
// 不动：description（quicktype 渲染为注释）、enum、oneOf/anyOf/allOf、
//   properties/required/items/additionalProperties（已显式设值）、type、其它 known format。

const STRIP_KEYS = new Set(["example", "examples", "readOnly", "writeOnly", "xml", "externalDocs", "discriminator"]);
const REF_PREFIX_OPENAPI = "#/components/schemas/";
const REF_PREFIX_TARGET = "#/definitions/";

/**
 * 深拷贝并归一化任意 schema。
 *  - stripTopTitle = true：顶层 title 被剥（用于 definitions 直接子节点）；
 *    嵌套层始终保留 title（quicktype 可用作匿名类型命名提示）。
 */
function normalizeSchema(schema: Schema, stripTopTitle: boolean, baseCfg: BaseConfig): Schema {
  return walk(schema, stripTopTitle, /*depth*/ 0, baseCfg);
}

function walk(node: any, stripTopTitle: boolean, depth: number, baseCfg: BaseConfig): any {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((v) => walk(v, false, depth + 1, baseCfg));

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("x-")) continue; // 删 OpenAPI 扩展
    if (STRIP_KEYS.has(k)) continue; // 删 quicktype 不消费的字段
    if (META_KEYS.has(k)) continue; // 元数据，下面合并进 description
    if (k === "title" && stripTopTitle && depth === 0) continue;
    if (k === "$ref" && typeof v === "string") {
      out[k] = rewriteRef(v);
      continue;
    }
    out[k] = walk(v, false, depth + 1, baseCfg);
  }

  // 把 example/default/minimum/pattern/deprecated 等 JSON Schema 元数据注入 description，
  // 让 quicktype 把它们渲染成 JSDoc tag——quicktype 自身不为这些字段产出注释。
  augmentDescription(node, out);

  applyNullable(out);
  applyStrictObjects(out, baseCfg);
  return out;
}

// 这些字段从 schema 移除，但作为 @tag 形式注入 description，由 quicktype 渲染成 JSDoc
const META_KEYS = new Set([
  "default",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "deprecated",
]);

function augmentDescription(orig: any, out: Record<string, any>): void {
  const tags: string[] = [];
  // example/examples 在 STRIP_KEYS 里，但元数据要恢复到注释中
  if (orig.example !== undefined) tags.push(`@example ${formatLiteral(orig.example)}`);
  else if (orig.examples !== undefined) {
    // OpenAPI 3 examples 多种形态：数组 / 对象 / 单值，挑第一个
    const first = pickFirstExample(orig.examples);
    if (first !== undefined) tags.push(`@example ${formatLiteral(first)}`);
  }
  if (orig.default !== undefined) tags.push(`@default ${formatLiteral(orig.default)}`);
  if (orig.pattern) tags.push(`@pattern ${orig.pattern}`);
  if (orig.minLength !== undefined) tags.push(`@minLength ${orig.minLength}`);
  if (orig.maxLength !== undefined) tags.push(`@maxLength ${orig.maxLength}`);
  if (orig.minimum !== undefined) tags.push(`@minimum ${orig.minimum}`);
  if (orig.maximum !== undefined) tags.push(`@maximum ${orig.maximum}`);
  if (orig.exclusiveMinimum !== undefined) tags.push(`@exclusiveMinimum ${orig.exclusiveMinimum}`);
  if (orig.exclusiveMaximum !== undefined) tags.push(`@exclusiveMaximum ${orig.exclusiveMaximum}`);
  if (orig.multipleOf !== undefined) tags.push(`@multipleOf ${orig.multipleOf}`);
  if (orig.minItems !== undefined) tags.push(`@minItems ${orig.minItems}`);
  if (orig.maxItems !== undefined) tags.push(`@maxItems ${orig.maxItems}`);
  if (orig.uniqueItems) tags.push("@uniqueItems");
  if (orig.deprecated) {
    tags.push(typeof orig.deprecated === "string" ? `@deprecated ${orig.deprecated}` : "@deprecated");
  }
  if (orig.readOnly) tags.push("@readonly");
  if (orig.writeOnly) tags.push("@writeonly");
  if (tags.length === 0) return;
  const existing = out.description ? String(out.description).trim() : "";
  out.description = existing ? `${existing}\n\n${tags.join("\n")}` : tags.join("\n");
}

function pickFirstExample(examples: any): unknown {
  if (Array.isArray(examples)) return examples[0];
  if (examples && typeof examples === "object") {
    const keys = Object.keys(examples);
    if (keys.length === 0) return undefined;
    const first = examples[keys[0]];
    // OpenAPI 3 examples 形态：{ name: { value: ..., summary: ... } }
    if (first && typeof first === "object" && "value" in first) return (first as any).value;
    return first;
  }
  return undefined;
}

function formatLiteral(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function rewriteRef(ref: string): string {
  return ref.startsWith(REF_PREFIX_OPENAPI) ? REF_PREFIX_TARGET + ref.slice(REF_PREFIX_OPENAPI.length) : ref;
}

/**
 * OpenAPI 3.0 nullable: true → JSON Schema 标准的 type 数组（或 oneOf 包装）。
 */
function applyNullable(node: Record<string, any>): void {
  if (node.nullable !== true) {
    if ("nullable" in node) delete node.nullable;
    return;
  }
  delete node.nullable;

  // ref + nullable → oneOf
  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    delete node.$ref;
    node.oneOf = [{ $ref: ref }, { type: "null" }];
    return;
  }
  // oneOf/anyOf + nullable → 在 union 里加 null
  for (const k of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(node[k])) {
      const has = node[k].some((s: any) => s?.type === "null");
      if (!has) node[k].push({ type: "null" });
      return;
    }
  }
  // allOf + nullable → 包一层 oneOf
  if (Array.isArray(node.allOf)) {
    node.oneOf = [{ allOf: node.allOf }, { type: "null" }];
    delete node.allOf;
    return;
  }
  // enum + nullable → 加 null literal
  if (Array.isArray(node.enum)) {
    if (!node.enum.includes(null)) node.enum.push(null);
  }
  // type + nullable → 数组化
  if (node.type === undefined) return;
  if (Array.isArray(node.type)) {
    if (!node.type.includes("null")) node.type.push("null");
  } else {
    node.type = [node.type, "null"];
  }
}

/**
 * 显式 properties 但 additionalProperties 未设值的 object 默认设为 false（避免 [key]: any）。
 * 仅对 strictObjects=true 生效；只在已显式给出 properties 的 object 上动手——单纯
 * `{ type: 'object' }` 是开放 record 意图，不破坏。
 */
function applyStrictObjects(node: Record<string, any>, baseCfg: BaseConfig): void {
  if (!baseCfg.strictObjects) return;
  if (!("properties" in node)) return;
  if ("additionalProperties" in node) return;
  const t = node.type;
  const compatible = t === undefined || t === "object" || (Array.isArray(t) && t.includes("object"));
  if (!compatible) return;
  node.additionalProperties = false;
}

// ============================================================================
// mega-schema 合成
// ============================================================================
//
// 输出结构：
//   {
//     "$id": "openapi://api.json",
//     "definitions": {
//       "Pet":  ...,           // 所有 components.schemas
//       "Order": ...,
//       "GetPetByPetId": ...   // 所有合成的 req schema
//       // 注意：纯 ref body（如 PutPet 等价 Pet）不在此——避免与底层 ref dedupe 冲突
//     }
//   }

export function buildMegaSchema(doc: OpenAPIDoc, baseCfg: BaseConfig): MegaSchemaResult {
  const refs: Record<string, Schema> = doc.components?.schemas || {};

  // 1. 名字预占：components.schemas 全部占位，避免 req 与之冲突
  const usedNames = new Set<string>(Object.keys(refs));

  // 2. components.schemas → definitions（深拷贝、归一化、剥顶层 title）
  const definitions: Record<string, Schema> = {};
  const componentNames: string[] = [];
  for (const [name, schema] of Object.entries(refs)) {
    definitions[name] = normalizeSchema(schema, /*stripTopTitle*/ true, baseCfg);
    componentNames.push(name);
  }

  // 2.5 内联 enum 提升：扫描所有 schema，把嵌套 enum 提到 definitions 顶层并替换为 $ref，
  //     让 quicktype 自然 dedupe + 命名，emitter 也无需额外的 enum 缓存池。
  const enumLifter = new EnumLifter(definitions, usedNames, baseCfg);
  for (const name of componentNames) {
    definitions[name] = enumLifter.lift(definitions[name], name);
  }

  // 3. 收集 ops
  const ops: OperationData[] = [];
  forEachOperation(doc, baseCfg, (op) => ops.push(op));

  // 4. 合成 req schema + 分类响应
  const reqInfoOf = new Map<string, ReqInfo>();
  const responseRefOf = new Map<string, ResponseRef>();

  for (const op of ops) {
    const k = opKey(op.path, op.method);
    const synth = synthesizeRequestSchema(op, baseCfg);
    if (synth.kind === "ref-alias") {
      const reqName = uniqueName(opTypeName(op), usedNames, baseCfg);
      reqInfoOf.set(k, { name: reqName, kind: "ref-alias", refName: synth.refName });
    } else if (synth.kind === "ref-alias-extends") {
      // body 是纯 ref + 有额外参数：TS 端生成 `interface X extends model.Y { param1: T; ... }`
      // 同样不写入 mega-schema，后处理手写。但 extendsProps 内的内联 enum 仍要提升，
      // 后处理才能把 enum 字段渲染成 model.<EnumName> 而非内联字面量 union。
      const reqName = uniqueName(opTypeName(op), usedNames, baseCfg);
      const liftedExtras = synth.extraProps.map((p) => ({
        ...p,
        schema: enumLifter.lift(p.schema, `${reqName}_${p.name}`),
      }));
      reqInfoOf.set(k, {
        name: reqName,
        kind: "ref-alias-extends",
        refName: synth.refName,
        extendsProps: liftedExtras,
      });
    } else if (synth.kind === "body-alias") {
      // 无额外参数 + 复杂 body → TS 端生成 `type X = Array<model.Y>` 等，不写入 mega-schema
      const reqName = uniqueName(opTypeName(op), usedNames, baseCfg);
      const lifted = enumLifter.lift(synth.schema, reqName);
      reqInfoOf.set(k, { name: reqName, kind: "body-alias", bodySchema: lifted });
    } else if (synth.kind === "empty") {
      const reqName = uniqueName(opTypeName(op), usedNames, baseCfg);
      reqInfoOf.set(k, { name: reqName, kind: "empty" });
    } else {
      const reqName = uniqueName(opTypeName(op), usedNames, baseCfg);
      definitions[reqName] = enumLifter.lift(synth.schema, reqName);
      reqInfoOf.set(k, { name: reqName, kind: "normal" });
    }
    responseRefOf.set(k, classifyResponse(op, usedNames, definitions, baseCfg));
  }

  return {
    schema: { $id: "openapi://api.json", definitions },
    componentNames,
    reqInfoOf,
    ops,
    responseRefOf,
  };
}

// ============================================================================
// 内联枚举提升器
// ----------------------------------------------------------------------------
// 把任意 schema 中嵌套的 `{ enum: [...] }` 替换成 `{ $ref: '#/definitions/<name>' }`，
// 并把对应的 enum schema 注册到 definitions 顶层。相同字面量集合复用同一类型。
//
// 这样：
//   1. quicktype 看到的所有 enum 都是顶层 named ref → 自动 dedupe + 一致命名
//   2. emitter 渲染 ref-alias-extends / body-alias 时遇到 enum 字段已是 ref 形态，
//      `schemaToTsType` 走通用 ref 分支即可，不再需要 enum 缓存池
// ============================================================================

class EnumLifter {
  private readonly byKey = new Map<string, string>();
  private readonly definitions: Record<string, Schema>;
  private readonly usedNames: Set<string>;
  private readonly baseCfg: BaseConfig;

  constructor(definitions: Record<string, Schema>, usedNames: Set<string>, baseCfg: BaseConfig) {
    this.definitions = definitions;
    this.usedNames = usedNames;
    this.baseCfg = baseCfg;
    // 把已有 components.schemas 顶层就是 enum 的预登记到池，便于跨 schema 复用现有命名
    for (const [name, schema] of Object.entries(definitions)) {
      if (Array.isArray(schema?.enum)) {
        this.byKey.set(enumKey(schema.enum), name);
      }
    }
  }

  /** 递归遍历 schema，原地把内联 enum 替换为 $ref，并把新 enum 注入 definitions */
  lift(schema: Schema, contextName: string): Schema {
    return this.walk(schema, contextName, /*propPath*/ undefined);
  }

  private walk(node: Schema, contextName: string, propName: string | undefined): Schema {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((v) => this.walk(v, contextName, propName));

    // 命中 enum：抽离为顶层 def，保留兄弟元数据（description / default / @example 等已在
    // normalize 阶段汇总到 description）让 quicktype 渲染字段注释
    if (Array.isArray(node.enum)) {
      const refName = this.registerEnum(node, contextName, propName);
      const ref: Schema = { $ref: `#/definitions/${refName}` };
      if (typeof node.description === "string" && node.description.trim()) {
        ref.description = node.description;
      }
      return ref;
    }

    // 递归子节点；object properties 用属性名做命名上下文
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "properties" && v && typeof v === "object" && !Array.isArray(v)) {
        const props: Record<string, Schema> = {};
        for (const [pn, pv] of Object.entries(v as Record<string, Schema>)) {
          props[pn] = this.walk(pv, contextName, pn);
        }
        out[k] = props;
      } else if (k === "items" || k === "additionalProperties") {
        out[k] = this.walk(v as Schema, contextName, propName);
      } else if (k === "oneOf" || k === "anyOf" || k === "allOf") {
        out[k] = Array.isArray(v) ? v.map((s) => this.walk(s, contextName, propName)) : v;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  private registerEnum(node: Schema, contextName: string, propName: string | undefined): string {
    const key = enumKey(node.enum);
    const cached = this.byKey.get(key);
    if (cached) return cached;

    const base = `${pascalCase(contextName)}${pascalCase(propName ?? "enum")}`;
    const name = uniqueName(base, this.usedNames, this.baseCfg);
    this.byKey.set(key, name);

    // 保留 enum schema 上的 description / default 等元数据，让 quicktype 渲染 JSDoc
    const enumSchema: Schema = { ...node };
    this.definitions[name] = enumSchema;
    return name;
  }
}

/** 把 enum 字面量数组标准化为查询 key（顺序无关、类型敏感） */
function enumKey(values: readonly unknown[]): string {
  return values
    .map((v) => {
      if (v === null) return "x:null";
      if (typeof v === "string") return `s:${v}`;
      if (typeof v === "number") return `n:${v}`;
      if (typeof v === "boolean") return `b:${v}`;
      return `j:${JSON.stringify(v)}`;
    })
    .slice()
    .sort()
    .join("|");
}

function synthesizeRequestSchema(op: OperationData, baseCfg: BaseConfig): SynthesizedReq {
  // path 参数永远 required；query/header 按 spec；body 按 op.body.required
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const p of op.params) {
    if (p.in === "cookie") continue; // 不暴露 cookie（通常 server 注入）
    properties[p.name] = withParamMeta(normalizeSchema(p.schema, /*stripTopTitle*/ true, baseCfg), p.description, p.deprecated);
    if (p.required) required.push(p.name);
  }

  if (op.body) {
    const refName = pureRefName(op.body.schema);

    if (refName && Object.keys(properties).length === 0) {
      // body 是纯 ref + 无其它参数 → req 类型直接是底层 ref（不再造 definition）
      return { kind: "ref-alias", refName };
    }

    if (refName) {
      // body 是纯 ref + 有额外参数（path/query/header） → 用 extends + 扩展字段，不造 definition
      const extraProps = Object.entries(properties).map(([name, schema]) => ({
        name,
        schema,
        required: required.includes(name),
      }));
      return { kind: "ref-alias-extends", refName, extraProps };
    }

    const normalizedBody = normalizeSchema(op.body.schema, /*stripTopTitle*/ true, baseCfg);
    const inlinedProps = inlineableObjectProps(normalizedBody);
    if (inlinedProps) {
      for (const [k, v] of Object.entries(inlinedProps.properties)) properties[k] = v;
      for (const r of inlinedProps.required) required.push(r);
    } else {
      if (Object.keys(properties).length === 0) {
        // 无额外参数 + 复杂 body（数组/oneOf/anyOf 等）→ body 就是整个请求类型，直接作为类型别名
        return { kind: "body-alias", schema: normalizedBody };
      }
      // 有参数 + 复杂/标量 body（string/binary/array 等无法拍平）→ body 设为 any 防止类型报错
      properties.body = {};
      if (op.body.required) required.push("body");
    }
  }

  if (Object.keys(properties).length === 0) return { kind: "empty" };

  const schema: Schema = {
    type: "object",
    properties,
    required: [...new Set(required)],
    additionalProperties: false,
  };
  if (op.summary || op.description) {
    schema.description = combineDocs(op.summary, op.description);
  }
  return { kind: "normal", schema };
}

function withParamMeta(schema: Schema, description?: string, deprecated?: boolean): Schema {
  if (!description && !deprecated) return schema;
  const out = { ...schema };
  if (description) {
    // augmentDescription 可能已把 @default/@pattern 等写入 description；param 描述应前置
    out.description = out.description ? `${description}\n\n${out.description}` : description;
  }
  if (deprecated) out.description = out.description ? `${out.description}\n\n(deprecated)` : "(deprecated)";
  return out;
}

function combineDocs(...parts: (string | undefined)[]): string {
  return parts
    .filter(Boolean)
    .map((s) => String(s).trim())
    .filter(Boolean)
    .join("\n\n");
}

function pureRefName(schema: Schema): string | null {
  if (!schema || typeof schema !== "object") return null;
  if (typeof schema.$ref !== "string") return null;
  const m = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref) ?? /^#\/definitions\/(.+)$/.exec(schema.$ref);
  return m ? m[1] : null;
}

function inlineableObjectProps(schema: Schema): { properties: Record<string, Schema>; required: string[] } | null {
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) return null;
  if (schema.oneOf || schema.anyOf || schema.allOf) return null;
  const type = pickPrimaryType(schema.type);
  if (type && type !== "object") return null;
  const props = schema.properties;
  if (!props || typeof props !== "object") return null;
  if (Object.keys(props).length === 0) return null;
  return {
    properties: props,
    required: Array.isArray(schema.required) ? [...schema.required] : [],
  };
}

function pickPrimaryType(t: any): string | undefined {
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.find((x) => x !== "null");
  return undefined;
}

// ============================================================================
// 响应分类（决定 paths 里 response 槽如何写）
// ============================================================================

function classifyResponse(op: OperationData, usedNames: Set<string>, definitions: Record<string, Schema>, baseCfg: BaseConfig): ResponseRef {
  const raw = op.responseSchema;
  if (raw == null) return { kind: "none" };

  const norm = normalizeSchema(raw, /*stripTopTitle*/ true, baseCfg);

  const ref = pureRefName(norm);
  if (ref) return { kind: "ref", name: ref };

  const primary = pickPrimaryType(norm.type);
  if (primary === "string") return { kind: "primitive", primitive: "string" };
  if (primary === "integer" || primary === "number") return { kind: "primitive", primitive: "number" };
  if (primary === "boolean") return { kind: "primitive", primitive: "boolean" };

  if (primary === "array") {
    const items = norm.items;
    const itemRef = pureRefName(items);
    if (itemRef) return { kind: "array-of-ref", name: itemRef };
    const itemPrim = pickPrimaryType(items?.type);
    if (itemPrim === "string") return { kind: "array-of-primitive", primitive: "string" };
    if (itemPrim === "integer" || itemPrim === "number") return { kind: "array-of-primitive", primitive: "number" };
    if (itemPrim === "boolean") return { kind: "array-of-primitive", primitive: "boolean" };
    return inlineResponseAlias(op, norm, usedNames, definitions, baseCfg);
  }

  if ((primary === "object" || primary === undefined) && !norm.properties) {
    const ap = norm.additionalProperties;
    if (ap && typeof ap === "object") {
      const apRef = pureRefName(ap);
      if (apRef) return { kind: "map-of-ref", name: apRef };
      const apPrim = pickPrimaryType(ap.type);
      if (apPrim === "string") return { kind: "map-of-primitive", primitive: "string" };
      if (apPrim === "integer" || apPrim === "number") return { kind: "map-of-primitive", primitive: "number" };
      if (apPrim === "boolean") return { kind: "map-of-primitive", primitive: "boolean" };
    } else if (ap === true) {
      return { kind: "map-of-primitive", primitive: "unknown" };
    } else if (primary === "object") {
      return { kind: "map-of-primitive", primitive: "unknown" };
    }
  }

  return inlineResponseAlias(op, norm, usedNames, definitions, baseCfg);
}

function inlineResponseAlias(op: OperationData, schema: Schema, usedNames: Set<string>, definitions: Record<string, Schema>, baseCfg: BaseConfig): ResponseRef {
  const base = opTypeName(op) + "Response";
  const name = uniqueName(base, usedNames, baseCfg);
  definitions[name] = schema;
  return { kind: "inline", reqStyleName: name };
}

// ============================================================================
// 类型声明
// ============================================================================

export type Schema = any;
export type OpenAPIDoc = Record<string, any>;

export interface ParamData {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required: boolean;
  schema: Schema;
  description?: string;
  deprecated?: boolean;
  example?: unknown;
}

export interface BodyData {
  schema: Schema;
  required: boolean;
  /** 选中的 mediaType */
  mediaType: string;
}

export interface OperationData {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated?: boolean;
  params: ParamData[];
  body: BodyData | null;
  responseSchema: Schema | null;
}

export interface MegaSchemaResult {
  /** 大 schema（要 JSON.stringify 后传给 quicktype） */
  schema: Record<string, any>;
  /** 所有 components.schemas 的 key（保留原顺序） */
  componentNames: string[];
  /** 每个 op 的 req 信息（key = `${path}::${method}`） */
  reqInfoOf: Map<string, ReqInfo>;
  /** op 列表（与 forEachOperation 顺序一致） */
  ops: OperationData[];
  /** op 的成功响应类型表达式 */
  responseRefOf: Map<string, ResponseRef>;
}

export interface ReqInfo {
  /** 在 model.req namespace 中的类型名（normal 时由 quicktype 产出，其余由后处理手写） */
  name: string;
  /**
   *  - 'normal'             : 有合成 schema，quicktype 会产出对应类型
   *  - 'ref-alias'          : body 是纯 ref + 无其它参数，TS 端手写 `interface X extends model.Y {}`
   *  - 'ref-alias-extends'  : body 是纯 ref + 有额外参数，TS 端手写 `interface X extends model.Y { p1: T; ... }`
   *  - 'empty'              : 无任何参数与 body，quicktype 会跳过；paths 单独渲染
   */
  kind: "normal" | "ref-alias" | "ref-alias-extends" | "body-alias" | "empty";
  /** ref-alias / ref-alias-extends 时使用——指向 components.schemas 里被复用的类型名 */
  refName?: string;
  /** ref-alias-extends 时使用——除 refName 基类外额外的拍平字段 */
  extendsProps?: Array<{ name: string; schema: Schema; required: boolean }>;
  /** body-alias 时使用——body 本身就是完整的请求类型（数组/复杂结构） */
  bodySchema?: Schema;
}

export type ResponseRef =
  | { kind: "ref"; name: string }
  | { kind: "array-of-ref"; name: string }
  | { kind: "array-of-primitive"; primitive: string }
  | { kind: "primitive"; primitive: string }
  | { kind: "map-of-primitive"; primitive: string }
  | { kind: "map-of-ref"; name: string }
  | { kind: "inline"; reqStyleName: string }
  | { kind: "none" };

type SynthesizedReq =
  | { kind: "normal"; schema: Schema }
  | { kind: "ref-alias"; refName: string }
  | {
      kind: "ref-alias-extends";
      refName: string;
      extraProps: Array<{ name: string; schema: Schema; required: boolean }>;
    }
  | { kind: "body-alias"; schema: Schema }
  | { kind: "empty" };
