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

/**
 * 支持的 HTTP 方法（小写），顺序即默认的处理顺序（影响 PathRefs 字段顺序与 req 名分配优先级）。
 *
 * @example
 * HTTP_METHOD_ORDER.includes("trace"); // true
 */
export const HTTP_METHOD_ORDER: readonly string[] = ["get", "post", "put", "delete", "patch", "options", "head", "trace"];

/** HTTP 方法集合，由 {@link HTTP_METHOD_ORDER} 构造，用于 O(1) 判断。 */
const HTTP_METHODS = new Set<string>(HTTP_METHOD_ORDER);

/** 用户自定义 conflictSuffix 的最大尝试次数，防止回调总返回已占用名字时死循环。 */
const MAX_NAME_ATTEMPTS = 10000;

/** 解析本地 `$ref` 链时的最大跳数，防环。 */
const MAX_REF_HOPS = 20;

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
 *
 * @param source 已解析对象、URL、内联 JSON/YAML 文本或文件路径
 * @param projectRoot 解析相对文件路径时的基准目录
 * @returns 归一化前的 OpenAPI 文档对象
 * @example
 * const doc = await loadOpenAPI("./openapi.yaml", process.cwd());
 */
export async function loadOpenAPI(source: string | Record<string, unknown>, projectRoot: string): Promise<OpenAPIDoc> {
  // 形态 1：已是 JS 对象
  if (typeof source !== "string") {
    return finishLoad(source, "[object]");
  }

  const classified = classifySource(source);

  switch (classified.kind) {
    // 形态 3：内联 JSON 文本——sourceLabel 用伪扩展名让 parseDoc 走 JSON 优先路径
    case "inline-json":
      return finishLoad(parseDoc(classified.text, "<inline.json>"), "<inline.json>");

    // 形态 4：内联 YAML 文本——伪 .yaml 扩展名让 parseDoc 直走 YAML
    case "inline-yaml":
      return finishLoad(parseDoc(classified.text, "<inline.yaml>"), "<inline.yaml>");

    // 形态 2：远程 URL
    case "url": {
      const r = await fetch(classified.value);
      if (!r.ok) throw new Error(`fetch ${classified.value} -> ${r.status} ${r.statusText}`);
      const text = await r.text();
      return finishLoad(parseDoc(text, new URL(classified.value).pathname), classified.value);
    }

    // 形态 5：文件路径
    case "file": {
      const full = path.isAbsolute(classified.path) ? classified.path : path.resolve(projectRoot, classified.path);
      const text = await fs.readFile(full, "utf-8");
      return finishLoad(parseDoc(text, full), full);
    }
  }
}

/**
 * 加载收尾：校验根节点必须是普通对象，再做 v2 → v3 归一化。
 * 不校验的话，null / 数组 / 标量要到 buildMegaSchema 里才以莫名其妙的方式崩。
 */
function finishLoad(doc: unknown, label: string): OpenAPIDoc {
  if (!isPlainObject(doc)) {
    const got = doc === null ? "null" : Array.isArray(doc) ? "数组" : typeof doc;
    throw new Error(`OpenAPI 文档根节点必须是对象，实际得到 ${got}（来源：${label}）`);
  }
  return convertV2ToV3(doc);
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

  // 1.5 顶层共享 responses 同样要把 schema 包进 content，否则搬到 components.responses 后读不到
  if (out.responses && typeof out.responses === "object") {
    for (const resp of Object.values(out.responses)) convertV2Response(resp, producesGlobal);
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
    for (const code of Object.keys(op.responses)) convertV2Response(op.responses[code], produces);
  }

  delete op.consumes;
  delete op.produces;
}

/**
 * 把单个 v2 response 就地转成 v3 形态：`schema` 包进 `content[mediaType].schema`，丢掉 v2 的 `examples`。
 * op 内联 response 与顶层共享 responses 共用这一份逻辑。
 * @param resp 待转换的 response 对象；`$ref` 或非对象会被忽略
 * @param produces 生效的 produces 列表；为空时用 application/json
 */
function convertV2Response(resp: any, produces: string[]): void {
  if (!resp || typeof resp !== "object" || resp.$ref) return;
  if (resp.schema) {
    const mts = produces.length ? produces : ["application/json"];
    resp.content = {};
    for (const mt of mts) resp.content[mt] = { schema: resp.schema };
    delete resp.schema;
  }
  delete resp.examples; // v2 examples 形态与 v3 不同；后续 normalize 会再 strip example 类字段
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

/** 把 v2 参数按 in 拆成三类；没有 body 参数时 body 为 null */
function splitV2Params(params: any[]): { rest: any[]; body: any; formData: any[] } {
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
  const mt = consumes.find((c) => c === "multipart/form-data") ?? consumes.find((c) => c === "application/x-www-form-urlencoded") ?? (hasFile ? "multipart/form-data" : "application/x-www-form-urlencoded");
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

/**
 * 判断字符串是不是受支持的 HTTP 方法（不区分大小写）。
 * @param s 待判断的字符串，如 path item 的键
 * @returns 是受支持的 HTTP 方法时为 true
 * @example
 * isHttpMethod("GET"); // true
 * isHttpMethod("parameters"); // false
 */
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

/**
 * 在 used 集合中分配唯一名字；冲突时按 baseConfig.conflictSuffix 加后缀。
 * conflictSuffix 是用户回调，若它始终返回已占用的名字会永远转不出来，所以设了尝试上限，超限直接报错。
 */
function uniqueName(name: string, used: Set<string>, baseCfg: BaseConfig): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  let i = 1;
  let final = baseCfg.conflictSuffix(name, i);
  while (used.has(final)) {
    if (++i > MAX_NAME_ATTEMPTS) {
      throw new Error(`为 '${name}' 分配唯一名字失败：conflictSuffix 连续 ${MAX_NAME_ATTEMPTS} 次返回已占用的名字，请检查该回调是否随 n 变化`);
    }
    final = baseCfg.conflictSuffix(name, i);
  }
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
      fn(buildOpData(doc, p, m, op, pathLevelParams));
    }
  }
}

/**
 * 解析本地 Reference Object：`{ $ref: "#/components/parameters/X" }` → 被引用的对象。
 * 沿 `$ref` 链最多跟随 {@link MAX_REF_HOPS} 跳；只认以 `#/` 开头的 JSON Pointer
 * （按 RFC 6901 §6：先整体百分号解码，再按 `/` 分段，最后 `~1` → `/`、`~0` → `~`）。
 * 非引用对象原样返回；指针找不到或成环时也返回原对象，不抛错。
 * @param doc 完整的 OpenAPI 文档
 * @param obj 可能是 Reference Object 的值
 * @returns 解析后的对象；无法解析时为传入的 obj 本身
 */
function resolveLocalRef(doc: OpenAPIDoc, obj: any): any {
  let cur = obj;
  const seen = new Set<string>();
  for (let hop = 0; hop < MAX_REF_HOPS; hop++) {
    if (!cur || typeof cur !== "object" || typeof cur.$ref !== "string" || !cur.$ref.startsWith("#/")) return cur;
    if (seen.has(cur.$ref)) return obj; // 成环
    seen.add(cur.$ref);
    let target: any = doc;
    let pointer: string = cur.$ref.slice(2);
    try {
      pointer = decodeURIComponent(pointer);
    } catch {
      // 不是合法的百分号编码，按字面处理
    }
    for (const raw of pointer.split("/")) {
      const seg = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      if (target === null || typeof target !== "object" || !Object.hasOwn(target, seg)) return obj;
      target = target[seg];
    }
    cur = target;
  }
  return obj; // 超过最大跳数
}

/** 汇总一个 op 的全部数据：参数、请求体、成功响应，引用在此处统一解开。 */
function buildOpData(doc: OpenAPIDoc, p: string, method: string, op: any, pathLevelParams: any[]): OperationData {
  const resolveAll = (list: any[]): any[] => list.map((x) => resolveLocalRef(doc, x));
  const opParams: any[] = Array.isArray(op.parameters) ? op.parameters : [];
  const params = mergeParams(resolveAll(pathLevelParams), resolveAll(opParams)).map(toParamData);
  return {
    path: p,
    method,
    operationId: op.operationId,
    summary: op.summary,
    description: op.description,
    deprecated: op.deprecated === true,
    params,
    body: extractBody(doc, op),
    responseSchema: extractSuccessResponse(doc, op),
  };
}

/** 同名同 in 的 op-level param 覆盖 path-level；按 (name, in) 唯一去重。 */
function mergeParams(pathLevel: any[], opLevel: any[]): any[] {
  const map = new Map<string, any>();
  for (const p of [...pathLevel, ...opLevel]) {
    if (p && p.name && p.in) map.set(`${p.in}::${p.name}`, p);
  }
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

/** 取 op 的请求体（先解开 requestBody 的 $ref）；没有可用的 content/schema 时返回 null */
function extractBody(doc: OpenAPIDoc, op: any): BodyData | null {
  const rb = resolveLocalRef(doc, op.requestBody);
  if (!rb || typeof rb !== "object") return null;
  const content = rb.content;
  if (!content || typeof content !== "object") return null;
  const mediaType = pickMediaType(content);
  if (!mediaType) return null;
  const schema = content[mediaType]?.schema;
  if (!schema) return null;
  return { schema, required: !!rb.required, mediaType };
}

/** 取 op 的成功响应 schema（responses[code] 的 $ref 会先解开）；没有时返回 null */
function extractSuccessResponse(doc: OpenAPIDoc, op: any): Schema {
  const responses = op.responses;
  if (!responses || typeof responses !== "object") return null;
  const codes = Object.keys(responses);
  const resolved = (c: string): any => resolveLocalRef(doc, responses[c]);
  // 优先 2xx，其次 default，其次第一个有 content 的
  const code = codes.find((c) => /^2\d\d$/.test(c)) || (codes.includes("default") ? "default" : codes.find((c) => resolved(c)?.content)) || null;
  if (!code) return null;
  const content = resolved(code)?.content;
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

/** 值是「名字 → schema」字典的关键字：字典本身不是 schema，只有每个值才是（键是业务名字，不能当关键字处理）。 */
const SCHEMA_MAP_KEYS = new Set(["properties", "patternProperties", "definitions", "$defs", "dependentSchemas"]);

/** 值是纯数据（字面量）的关键字：不能当 schema 递归，按原样拷贝。 */
const DATA_KEYS = new Set(["enum", "const"]);

/** 是否为普通对象（非 null、非数组） */
function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** 对「名字 → schema」字典的每个值应用 fn，键原样保留 */
function mapSchemaDict(dict: Record<string, any>, fn: (schema: Schema) => Schema): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, schema] of Object.entries(dict)) out[name] = fn(schema);
  return out;
}

/** 递归归一化一个 schema 节点（返回新对象，不改源）；`properties` 等字典与 enum/const 数据有各自的处理 */
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
    if (DATA_KEYS.has(k)) {
      // enum / const 的值是数据；必须深拷贝，否则 applyNullable 往 enum 里 push null 会污染源文档
      out[k] = structuredClone(v);
      continue;
    }
    if (SCHEMA_MAP_KEYS.has(k) && isPlainObject(v)) {
      // 字典的键是属性名等业务名字（可能叫 default / example / x-foo…），只归一化各个值
      out[k] = mapSchemaDict(v, (s) => walk(s, false, depth + 1, baseCfg));
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

/** 把 example / default 值转成注释里的文本：字符串原样，其余 JSON 化，序列化失败给占位 */
function formatLiteral(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserializable]"; // 循环引用、BigInt 等序列化不了的值
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
// allOf 拍平
// ============================================================================
//
// strictObjects 下每个带 properties 的对象都被标成 additionalProperties:false，
// quicktype 对多个这样的对象做 allOf 交集时会求出空对象（`interface B {}`）。
// 所以在归一化之后、交给 quicktype 之前，先把「全是对象」的 allOf 手工合并成单个对象。

/**
 * 归一化之后的 schema 树里，把成员全是对象型的 `allOf` 合并成单个对象（返回新树，不改入参）。
 *
 * 合并规则：properties 合并（同名且内容不同的属性合成 `allOf: [...]` 保留交集约束）、required 取并集、
 * 节点自身的 properties/required 与其它兄弟键（description 等）保留；单成员 allOf 别名包装会被解开后再合并。
 * additionalProperties：strictObjects 下为 false，若有成员显式给了非 false 的值则沿用它；
 * strictObjects=false 时任一方显式写了 false 就是 false，否则沿用成员给的值（没有就不设）。
 * 以下情况原样保留 allOf，交给 quicktype：
 *   - 任一成员不是纯对象型（含 oneOf/anyOf/enum/嵌套未能拍平的 allOf、可空类型、非本地引用等）
 *   - 引用成环
 *   - 只有一个成员且节点自身没有 properties（本来就没有交集问题，保留 `$ref` 能让 quicktype 复用已有类型）
 *
 * @param schema 已归一化的 schema（`$ref` 已改写为 `#/definitions/X`）
 * @param definitions 已归一化的 definitions，用来解析 `#/definitions/X` 成员
 * @param baseCfg 基础配置，只读 strictObjects
 * @param visiting 正在展开的 definition 名字集合（防环），调用方可传入自身名字
 * @returns 拍平后的新 schema
 */
function flattenAllOf(schema: Schema, definitions: Record<string, Schema>, baseCfg: BaseConfig, visiting: Set<string> = new Set()): Schema {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map((s) => flattenAllOf(s, definitions, baseCfg, visiting));

  // 先递归子节点；字典键与 enum/const 数据不能当关键字处理
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (DATA_KEYS.has(k)) out[k] = v;
    else if (SCHEMA_MAP_KEYS.has(k) && isPlainObject(v)) out[k] = mapSchemaDict(v, (s) => flattenAllOf(s, definitions, baseCfg, visiting));
    else out[k] = flattenAllOf(v, definitions, baseCfg, visiting);
  }

  if (!Array.isArray(out.allOf)) return out;
  return mergeAllOf(out, definitions, baseCfg, visiting) ?? out;
}

/** 判断一个（已拍平的）成员是否是可合并的纯对象型：有 properties 或 type 含 object，且没有联合/枚举/嵌套 allOf */
function isMergeableObject(m: any): boolean {
  if (!isPlainObject(m)) return false;
  if (m.$ref !== undefined || m.oneOf || m.anyOf || m.allOf || Array.isArray(m.enum)) return false;
  const t = m.type;
  if (Array.isArray(t)) return t.includes("object") && !t.includes("null"); // 可空对象合并会丢掉 null，放弃
  if (t !== undefined && t !== "object") return false;
  return t === "object" || isPlainObject(m.properties);
}

/**
 * 解析一个 allOf 成员：`#/definitions/X` 引用先拍平后取出，
 * 遇到「只有单个成员、自身没有 properties」的 allOf 包装就继续解开（成员是 `$ref` 接着解析，是内联对象直接用）。
 * 解析过程中经过的 definition 名都会临时登记到 visiting 防环；非本地引用、成环、找不到时返回 null。
 */
function resolveAllOfMember(m: any, definitions: Record<string, Schema>, baseCfg: BaseConfig, visiting: Set<string>): any {
  const entered: string[] = [];
  try {
    let cur = m;
    for (;;) {
      if (isPlainObject(cur) && typeof cur.$ref === "string") {
        const name = /^#\/definitions\/(.+)$/.exec(cur.$ref)?.[1];
        if (name === undefined || visiting.has(name) || !Object.hasOwn(definitions, name)) return null;
        visiting.add(name);
        entered.push(name);
        cur = flattenAllOf(definitions[name], definitions, baseCfg, visiting);
      } else if (isPlainObject(cur) && Array.isArray(cur.allOf) && cur.allOf.length === 1 && !isPlainObject(cur.properties)) {
        cur = cur.allOf[0];
      } else {
        return cur;
      }
    }
  } finally {
    for (const name of entered) visiting.delete(name);
  }
}

/**
 * 把同名属性并入 properties：已存在且内容不同时合成 `{ allOf: [已有, 新的] }`，保留两边约束且不依赖成员顺序；
 * 已有值本身就是冲突合成的 allOf（synthesized 里登记过）则把新的追加进去，内容相同不重复添加。
 */
function mergeProperty(properties: Record<string, any>, synthesized: Set<string>, key: string, next: any): void {
  if (!Object.hasOwn(properties, key)) {
    properties[key] = next;
    return;
  }
  const nextJson = JSON.stringify(next);
  if (synthesized.has(key)) {
    const list: any[] = properties[key].allOf;
    if (!list.some((s) => JSON.stringify(s) === nextJson)) list.push(next);
  } else if (JSON.stringify(properties[key]) !== nextJson) {
    properties[key] = { allOf: [properties[key], next] };
    synthesized.add(key);
  }
}

/** 尝试合并 node.allOf；不满足条件（见 {@link flattenAllOf}）返回 null */
function mergeAllOf(node: Record<string, any>, definitions: Record<string, Schema>, baseCfg: BaseConfig, visiting: Set<string>): Schema {
  const hasOwnProps = isPlainObject(node.properties);
  if (node.allOf.length === 0 || (node.allOf.length === 1 && !hasOwnProps)) return null;

  const members: any[] = [];
  for (const m of node.allOf) {
    const resolved = resolveAllOfMember(m, definitions, baseCfg, visiting);
    if (!isMergeableObject(resolved)) return null;
    members.push(resolved);
  }

  const { allOf: _allOf, properties: ownProps, required: ownRequired, additionalProperties: ownAp, ...rest } = node;
  const properties: Record<string, any> = {};
  const synthesized = new Set<string>();
  const required = new Set<string>();
  let additional: any;
  let explicitClosed = false; // 有成员或节点自身显式写了 additionalProperties:false
  // 成员依次合并，节点自身的字段最后并入
  for (const m of [...members, { properties: ownProps, required: ownRequired, additionalProperties: ownAp }]) {
    if (isPlainObject(m.properties)) for (const [k, v] of Object.entries(m.properties)) mergeProperty(properties, synthesized, k, v);
    if (Array.isArray(m.required)) for (const r of m.required) required.add(r);
    if (m.additionalProperties === false) explicitClosed = true;
    else if (m.additionalProperties !== undefined) additional = m.additionalProperties;
  }

  const merged: Record<string, any> = { ...rest, type: rest.type ?? "object", properties };
  if (required.size) merged.required = [...required];
  // strictObjects=false 时 false 一定是用户显式写的，任一方关闭就关闭；strictObjects=true 时 false 是归一化注入的，分不清来源，沿用旧逻辑
  if (!baseCfg.strictObjects && explicitClosed) merged.additionalProperties = false;
  else if (additional !== undefined) merged.additionalProperties = additional;
  else if (baseCfg.strictObjects) merged.additionalProperties = false;
  return merged;
}

/** 归一化后立刻拍平 allOf——所有进入 quicktype 的 schema 都应走这个入口。 */
function normalizeAndFlatten(schema: Schema, stripTopTitle: boolean, definitions: Record<string, Schema>, baseCfg: BaseConfig): Schema {
  return flattenAllOf(normalizeSchema(schema, stripTopTitle, baseCfg), definitions, baseCfg);
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

  // 2.4 allOf 拍平：成员全是对象的 allOf 合并成单个对象（见 flattenAllOf），
  //     否则 strictObjects 下 quicktype 会把它们求成空交集。
  //     先全部拍平再赋值，保证成员引用解析到的都是归一化后、尚未改动的定义。
  const flattened: Record<string, Schema> = {};
  for (const name of componentNames) {
    flattened[name] = flattenAllOf(definitions[name], definitions, baseCfg, new Set([name]));
  }
  Object.assign(definitions, flattened);

  // 2.5 内联 enum 提升：扫描所有 schema，把嵌套 enum 提到 definitions 顶层并替换为 $ref，
  //     让 quicktype 自然 dedupe + 命名，emitter 也无需额外的 enum 缓存池。
  //     本身就是 enum 的组件跳过——它已经是顶层定义，再 lift 会被改写成指向自己的 $ref。
  const enumLifter = new EnumLifter(definitions, usedNames, baseCfg);
  for (const name of componentNames) {
    if (Array.isArray(definitions[name]?.enum)) continue;
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
    const synth = synthesizeRequestSchema(op, definitions, baseCfg);
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
    responseRefOf.set(k, classifyResponse(op, usedNames, definitions, baseCfg, enumLifter));
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

/**
 * 把 enum 字面量数组标准化为查询 key（顺序无关、类型敏感）。
 * 带类型标记的元素排序后整体 JSON.stringify，字面量里即使含分隔符也不会和别的集合撞 key。
 */
function enumKey(values: readonly unknown[]): string {
  const tagged = values.map((v) => {
    if (v === null) return "x:null";
    if (typeof v === "string") return `s:${v}`;
    if (typeof v === "number") return `n:${v}`;
    if (typeof v === "boolean") return `b:${v}`;
    return `j:${JSON.stringify(v)}`;
  });
  return JSON.stringify(tagged.sort());
}

/** 为一个 op 合成请求类型：把 path/query/header 参数与 body 拍成一个 req schema，或判定为各种别名形态 */
function synthesizeRequestSchema(op: OperationData, definitions: Record<string, Schema>, baseCfg: BaseConfig): SynthesizedReq {
  // path 参数永远 required；query/header 按 spec；body 按 op.body.required
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const p of op.params) {
    if (p.in === "cookie") continue; // 不暴露 cookie（通常 server 注入）
    properties[p.name] = withParamMeta(normalizeAndFlatten(p.schema, /*stripTopTitle*/ true, definitions, baseCfg), p.description, p.deprecated);
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

    const normalizedBody = normalizeAndFlatten(op.body.schema, /*stripTopTitle*/ true, definitions, baseCfg);
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

/**
 * 把 op 的成功响应 schema 分类成 paths 里 response 槽的写法。
 * 归一化、拍平 allOf 之后先过一遍 enum 提升：顶层 enum 变成 `$ref`（走 ref 分支），
 * 数组元素是 enum 时变成 array-of-ref，不会被误判成 string 原始类型。
 */
function classifyResponse(op: OperationData, usedNames: Set<string>, definitions: Record<string, Schema>, baseCfg: BaseConfig, enumLifter: EnumLifter): ResponseRef {
  const raw = op.responseSchema;
  if (raw == null) return { kind: "none" };

  const normalized = normalizeAndFlatten(raw, /*stripTopTitle*/ true, definitions, baseCfg);
  const norm = enumLifter.lift(normalized, opTypeName(op) + "Response");

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
  /** 成功响应的 schema；没有可用响应内容时为 null */
  responseSchema: Schema;
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
   *                           （目标不是对象型时退化为 `type X = model.Y`）
   *  - 'ref-alias-extends'  : body 是纯 ref + 有额外参数，TS 端手写 `interface X extends model.Y { p1: T; ... }`
   *                           （目标不是对象型时退化为 `type X = model.Y & { p1: T; ... }`）
   *  - 'body-alias'         : 无额外参数 + body 是数组/联合等无法拍平的复杂结构，
   *                           TS 端手写 `type X = <body 类型>`；不写入 mega-schema
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
