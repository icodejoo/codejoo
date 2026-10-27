/**
 * 生成编辑器提示数据：从 src/attributes.ts（单一数据源）写出 web-types.json（WebStorm）与 html-custom-data.json（VS Code）。
 * 构建时由 `pnpm build` 先跑一遍；生成物提交入库，test/editor-data.test.ts 校验它与本脚本的输出一致。
 * 直接用 node 运行（Node 22.18+ / 24 原生支持加载 .ts，attributes.ts 只含类型标注）：`node scripts/gen-editor-data.mjs`
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_BASE_URL, SKZ_ATTRIBUTES } from "../src/attributes.ts";

/** 包根目录 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Web-Types 生成物的文件名（相对包根） */
export const WEB_TYPES_FILE = "web-types.json";
/** VS Code HTML Custom Data 生成物的文件名（相对包根） */
export const CUSTOM_DATA_FILE = "html-custom-data.json";

/**
 * 属性在 README 中的文档链接
 * @param {{ anchor: string }} attr 属性描述
 * @returns {string} 链接
 */
function docUrl(attr) {
  return `${DOCS_BASE_URL}#${attr.anchor}`;
}

/**
 * 拼出带适用范围的说明：开头标明 Root attribute（根属性）或 Element mark（元素标记），后面接属性自己的描述
 * @param {import("../src/attributes.ts").SkzAttributeDef} attr 属性描述
 * @returns {string} 说明文本
 */
function describe(attr) {
  const where = attr.scope === "root" ? "Root attribute." : "Element mark.";
  return `${where} ${attr.description}`;
}

/**
 * 生成 Web-Types（WebStorm / JetBrains IDE）内容
 * @param {string} version 包版本
 * @returns {object} 可序列化的对象
 */
export function buildWebTypes(version) {
  return {
    $schema: "https://json.schemastore.org/web-types",
    name: "skeletonizer",
    version,
    "description-markup": "none",
    contributions: {
      html: {
        attributes: SKZ_ATTRIBUTES.map((a) => ({
          name: a.name,
          description: describe(a),
          "doc-url": docUrl(a),
          value: a.boolean ? { kind: "no-value" } : { kind: "plain", type: "enum" },
          ...(a.values ? { values: a.values.map((v) => ({ name: v })) } : {}),
        })),
      },
    },
  };
}

/**
 * 生成 VS Code HTML Custom Data 内容
 * @returns {object} 可序列化的对象
 */
export function buildCustomData() {
  return {
    version: 1.1,
    globalAttributes: SKZ_ATTRIBUTES.map((a) => ({
      name: a.name,
      description: describe(a),
      ...(a.values ? { values: a.values.map((v) => ({ name: v })) } : {}),
      references: [{ name: "skeletonizer README", url: docUrl(a) }],
    })),
  };
}

/** 序列化：两空格缩进 + 结尾换行 */
const dump = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

/** 直接运行时写文件（被测试 import 时不写） */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  writeFileSync(path.join(ROOT, WEB_TYPES_FILE), dump(buildWebTypes(version)));
  writeFileSync(path.join(ROOT, CUSTOM_DATA_FILE), dump(buildCustomData()));
}
