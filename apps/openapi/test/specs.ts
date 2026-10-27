// 测试共用的内联 OpenAPI 夹具（不依赖任何外部文件）。

/** 构造一个 200 JSON 响应 */
function ok(schema: unknown) {
  return { "200": { description: "ok", content: { "application/json": { schema } } } };
}

/** 构造一个 JSON 请求体 */
function jsonBody(schema: unknown, required = true) {
  return { required, content: { "application/json": { schema } } };
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * 边界综合夹具：未解析的 v3 Reference Object（参数 / 响应）、与响应类型同名的查询参数、
 * 需要加引号的 header 名、顶层 enum 组件与 enum 响应、非对象基类的 ref-alias、oneOf body、
 * 含特殊字符的 path 与会撞名 / 撞保留字的 operationId。
 */
export const EDGE_SPEC = {
  openapi: "3.0.3",
  info: { title: "edge", version: "1" },
  paths: {
    "/items/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      put: {
        operationId: "updateItem",
        parameters: [{ name: "X-Request-Id", in: "header", required: true, schema: { type: "string" } }],
        requestBody: jsonBody(ref("Item")),
        responses: { "200": { $ref: "#/components/responses/ItemOk" } },
      },
    },
    "/items": {
      post: { operationId: "createItems", requestBody: jsonBody({ type: "array", items: ref("Item") }), responses: ok({ type: "array", items: ref("Item") }) },
      get: {
        operationId: "listItems",
        parameters: [{ $ref: "#/components/parameters/Limit" }, { name: "Tag", in: "query", schema: { type: "string" } }, { name: "status", in: "query", schema: ref("Status") }],
        responses: ok(ref("Item")),
      },
    },
    "/status": { get: { operationId: "getStatus", responses: ok({ type: "string", enum: ["on", "off"] }) } },
    "/statuses": { get: { operationId: "getStatuses", responses: ok({ type: "array", items: { type: "string", enum: ["x", "y"] } }) } },
    // ref-alias：基类是 enum，`interface extends` 非法，应退化为 type 别名
    "/put-status": { put: { operationId: "putStatus", requestBody: jsonBody(ref("Status")), responses: ok(ref("Item")) } },
    // ref-alias-extends：基类是 enum
    "/put-status/{id}": {
      put: {
        operationId: "putStatusWithId",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(ref("Status")),
        responses: ok(ref("Item")),
      },
    },
    // body-alias：oneOf 联合 body
    "/poly": { post: { operationId: "postPoly", requestBody: jsonBody({ oneOf: [ref("Item"), ref("Tag")] }), responses: ok(ref("Item")) } },
    // 含特殊字符的 path
    "/it's": { get: { operationId: "quoteGet", responses: ok(ref("Item")) } },
    "/cost/$total": { get: { operationId: "costGet", responses: ok(ref("Item")) } },
    // Dart 字段名：保留字 + 重名
    "/kw": { get: { operationId: "class", responses: ok(ref("Item")) } },
    "/dup1": { get: { operationId: "find_by_id", responses: ok(ref("Item")) } },
    "/dup2": { get: { operationId: "findById", responses: ok(ref("Item")) } },
    "/trace-me": { trace: { operationId: "traceMe", responses: ok(ref("Item")) } },
  },
  components: {
    parameters: {
      Id: { name: "id", in: "path", required: true, schema: { type: "integer" } },
      Limit: { name: "limit", in: "query", schema: { type: "integer" } },
    },
    responses: { ItemOk: { description: "ok", content: { "application/json": { schema: ref("Item") } } } },
    schemas: {
      Status: { type: "string", enum: ["on", "off"] },
      Tag: { type: "object", properties: { name: { type: "string" } } },
      Item: {
        type: "object",
        required: ["status"],
        properties: {
          status: ref("Status"),
          tag: ref("Tag"),
          "items[]": { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

/** 业务属性名撞上 JSON Schema 关键字：default / example / pattern / minimum / nullable / deprecated / x-foo / title */
export const KEYWORD_PROPS_SPEC = {
  openapi: "3.0.0",
  info: { title: "kw", version: "1" },
  paths: { "/k": { get: { operationId: "getK", responses: ok(ref("Kw")) } } },
  components: {
    schemas: {
      Kw: {
        type: "object",
        required: ["default"],
        properties: {
          default: { type: "boolean" },
          example: { type: "string" },
          pattern: { type: "string" },
          minimum: { type: "integer" },
          nullable: { type: "boolean" },
          deprecated: { type: "string" },
          "x-foo": { type: "string" },
          title: { type: "string" },
          enum: { type: "string" },
        },
      },
    },
  },
};

/** allOf 合并：B = A + { b } */
export const ALLOF_SPEC = {
  openapi: "3.0.0",
  info: { title: "a", version: "1" },
  paths: { "/b": { get: { operationId: "getB", responses: ok(ref("B")) } } },
  components: {
    schemas: {
      A: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
      B: { description: "B 的说明", allOf: [ref("A"), { type: "object", required: ["b"], properties: { b: { type: "integer" } } }] },
      // 单成员 allOf：保持原样，交给 quicktype 复用 A
      C: { allOf: [ref("A")] },
      // 互相引用成环：放弃拍平，不能抛错
      P: { allOf: [ref("Q"), { type: "object", properties: { p: { type: "string" } } }] },
      Q: { allOf: [ref("P"), { type: "object", properties: { q: { type: "string" } } }] },
      // 含 nullable 的 allOf 属性：外层被 applyNullable 包成 oneOf，内层照样拍平
      Holder: { type: "object", properties: { b: { nullable: true, allOf: [ref("A"), { type: "object", properties: { z: { type: "number" } } }] } } },
    },
  },
};

export { ok, jsonBody, ref };
