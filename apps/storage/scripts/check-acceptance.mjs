import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, files, location, section, json, isMain, runVitest } from "./test-infra.mjs";

/** 分词仅用于拒绝动态声明标题；真实用例与 each 展开均以 Vitest JSON 为准。 */
export function declarations(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const ignored = /^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (ignored) {
      index += ignored[0].length;
      continue;
    }
    const quote = rest[0];
    if (["'", '"', "`"].includes(quote)) {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        if (source[end++] === quote) break;
      }
      tokens.push({ type: "string", text: source.slice(index, end), offset: index });
      index = end;
      continue;
    }
    const identifier = /^[\w$]+/.exec(rest);
    const text = identifier?.[0] ?? rest[0];
    tokens.push({ type: identifier ? "word" : "punct", text, offset: index });
    index += text.length;
  }
  const found = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!["describe", "it", "test"].includes(tokens[i].text) || tokens[i - 1]?.text === ".") continue;
    let cursor = i + 1;
    let parameterized = false;
    while (tokens[cursor]?.text === ".") {
      const modifier = tokens[cursor + 1]?.text;
      cursor += 2;
      if (["each", "for", "skipIf", "runIf"].includes(modifier)) {
        parameterized ||= ["each", "for"].includes(modifier);
        if (tokens[cursor]?.text !== "(") throw new Error("each/for 只支持括号数据表，请使用静态字面量标题");
        let depth = 0;
        do {
          const text = tokens[cursor++]?.text;
          if (text === "(") depth++;
          if (text === ")") depth--;
          if (cursor >= tokens.length && depth) throw new Error("测试声明括号未闭合");
        } while (depth);
      }
    }
    if (tokens[cursor]?.text !== "(") continue;
    const title = tokens[cursor + 1];
    if (title?.type !== "string" || title.text.includes("${") || ![",", ")"].includes(tokens[cursor + 2]?.text)) {
      const line = source.slice(0, tokens[i].offset).split("\n").length;
      throw new Error(`无法静态解析 ${tokens[i].text} 标题（第 ${line} 行）；使用字面量，参数化请用 each 占位符`);
    }
    // 仅解码常见标题转义；复杂转义直接拒绝，避免与运行时标题产生歧义。
    const raw = title.text.slice(1, -1);
    if (/\\(?![\\'"`nrt])/.test(raw)) throw new Error("标题包含不支持的转义，请使用直接字符");
    const name = raw.replace(/\\([\\'"`nrt])/g, (_, char) => ({ n: "\n", r: "\r", t: "\t" })[char] ?? char);
    if (/\s>\s/.test(name)) throw new Error(`标题含矩阵保留分隔符: ${name}`);
    found.push({ kind: tokens[i].text, name, parameterized });
  }
  return found;
}

/** 将 Vitest JSON 中的真实测试全名归一化；保留祖先以校验 suite。 */
export function casesFromReport(report, root = ROOT) {
  if (!Array.isArray(report.testResults)) throw new Error("JSON reporter 缺少 testResults");
  return report.testResults.flatMap((suite) =>
    (suite.assertionResults ?? []).map((test) => ({
      file: location(suite.name, root),
      names: [...(test.ancestorTitles ?? []), test.title],
      status: test.status,
    })),
  );
}

/** 解析矩阵四列表格；只接受精确测试位置，未映射章节额外允许 suite > **。 */
function rows(markdown, whitelist) {
  const content = whitelist ? section(markdown, "豁免/未映射") : markdown;
  return content
    .split(/\r?\n/)
    .filter((line) => /^\|\s*(?:INV|BUG|API|UNMAPPED)-[\w-]+\s*\|/.test(line))
    .map((line) => {
      const cells = line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, "").replaceAll("\\|", "|"));
      if (cells.length !== 4 || !cells.every(Boolean)) throw new Error(`验收行必须有四个非空单元格: ${line}`);
      const [id, description, reference, status] = cells;
      if (whitelist !== id.startsWith("UNMAPPED-")) return null;
      const parts = reference.split(" :: ");
      if (parts.length === 2 && parts[0].endsWith(".md")) {
        if (!id.startsWith("BUG-") || !/^(?:降级未修|误报|文档核对|工具链核对)(?:：|$)/.test(status)) throw new Error(`仅非修复 BUG 处置允许文档引用: ${id}`);
        return { id, description, file: parts[0], heading: parts[1], status };
      }
      if (parts.length !== 2 || !/^test\/.*\.(?:browser|node)\.test\.ts$/.test(parts[0])) throw new Error(`无效测试位置: ${reference}`);
      if (parts[1].includes("*") && (!whitelist || !/(?:^| > )\*\*$/.test(parts[1]))) throw new Error(`仅未映射白名单允许尾部 **: ${reference}`);
      return { id, description, file: parts[0], names: parts[1].split(" > "), status };
    })
    .filter(Boolean);
}

/** 按精确层级匹配一条真实测试；白名单可覆盖明确的 suite 子树。 */
function matches(row, test) {
  if (row.heading) return false;
  if (row.file !== test.file) return false;
  const wildcard = row.names.at(-1) === "**";
  const names = wildcard ? row.names.slice(0, -1) : row.names;
  return (wildcard ? test.names.length >= names.length : test.names.length === names.length) && names.every((name, i) => name === test.names[i]);
}

/** 将 each 占位符仅用于核验声明是否展开；矩阵仍必须使用精确全名。 */
function expandedTitleMatches(declaration, title) {
  if (!declaration.parameterized) return declaration.name === title;
  const escaped = declaration.name
    .split(/(%[sdifjoO#$%]|\$(?:#|[\w.]+))/g)
    .map((part) => {
      if (part === "%%") return "%";
      if (/^(?:%[sdifjoO#$]|\$(?:#|[\w.]+))$/.test(part)) return "[\\s\\S]*?";
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${escaped}$`).test(title);
}

/** 双向核对矩阵/白名单与真实测试；声明的 suite 也必须出现在报告祖先中。 */
export function checkAcceptance({ markdown, reports, sources, documents = {}, root = ROOT }) {
  const errors = [];
  const cases = reports.flatMap((report) => casesFromReport(report, root));
  const mapped = rows(markdown, false);
  const allowed = rows(markdown, true);
  const all = [...mapped, ...allowed];
  const ids = new Set();
  for (const row of all) {
    if (ids.has(row.id)) errors.push(`重复 ID: ${row.id}`);
    ids.add(row.id);
    if (row.heading) {
      const document = documents[row.file];
      if (!document?.split(/\r?\n/).some((line) => /^#{1,6} /.test(line) && line.replace(/^#{1,6} /, "") === row.heading)) errors.push(`文档章节不存在: ${row.id} ${row.file} :: ${row.heading}`);
    } else if (!cases.some((test) => matches(row, test))) errors.push(`引用不存在: ${row.id} ${row.file} :: ${row.names.join(" > ")}`);
  }
  for (const test of cases) {
    if (test.status !== "passed") errors.push(`用例未通过: ${test.file} :: ${test.names.join(" > ")} (${test.status})`);
    if (!all.some((row) => matches(row, test))) errors.push(`未映射: ${test.file} :: ${test.names.join(" > ")}`);
    if (!Object.hasOwn(sources, test.file)) errors.push(`报告引用了不存在的测试文件: ${test.file}`);
  }
  for (const [file, source] of Object.entries(sources)) {
    let declared;
    try {
      declared = declarations(source);
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
      continue;
    }
    const actual = cases.filter((test) => test.file === file);
    if (actual.length === 0) errors.push(`文件无真实用例: ${file}`);
    for (const declaration of declared) {
      const exists =
        declaration.kind === "describe"
          ? actual.some((test) => test.names.slice(0, -1).some((name) => expandedTitleMatches(declaration, name)))
          : actual.some((test) => expandedTitleMatches(declaration, test.names.at(-1)));
      // each suite 内的普通 it 标题也会按 Vitest 原文保留。
      if (!exists) errors.push(`声明未出现在 JSON 报告: ${file} :: ${declaration.name}`);
    }
  }
  if (cases.length === 0) errors.push("没有采集到任何真实测试");
  return { errors, count: cases.length, mapped: mapped.length, allowed: allowed.length };
}

/** 默认重新执行两套测试生成 JSON；--report 路径可供离线夹具/CI 使用。 */
export function main(execute = runVitest) {
  try {
    const path = resolve(ROOT, process.argv[2] === "--report" ? process.argv[3] : "coverage/acceptance-results.json");
    let execution = 0;
    if (process.argv[2] !== "--report") {
      mkdirSync(resolve(ROOT, "coverage"), { recursive: true });
      rmSync(path, { force: true });
      execution = execute(["-c", "scripts/vitest.all.config.ts", "--reporter=json", `--outputFile=${path}`]);
      if (execution) {
        console.error(`[acceptance] 测试执行失败（退出码 ${execution}），不得使用缺失或未完成的报告`);
        return execution;
      }
    }
    const result = checkAcceptance({
      markdown: readFileSync(resolve(ROOT, "test/ACCEPTANCE.md"), "utf8"),
      reports: [json(path)],
      documents: Object.fromEntries(["README.md", "README.zh-CN.md", "ARCHITECTURE.md", "CHANGELOG.md", ".claude/skills/codejoo-storage/SKILL.md", "test/ACCEPTANCE.md"].map((file) => [file, readFileSync(resolve(ROOT, file), "utf8")])),
      sources: Object.fromEntries(
        files(resolve(ROOT, "test"))
          .filter((file) => /\.(browser|node)\.test\.ts$/.test(file))
          .map((file) => [location(file), readFileSync(file, "utf8")]),
      ),
    });
    console.log(`[acceptance] 真实用例 ${result.count}，矩阵 ${result.mapped} 行，白名单 ${result.allowed} 行，错误 ${result.errors.length}`);
    for (const error of result.errors) console.error(`[acceptance] ${error}`);
    return execution || (result.errors.length ? 1 : 0);
  } catch (error) {
    console.error(`[acceptance] ${error.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main();
