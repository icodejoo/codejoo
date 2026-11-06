import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve, sep } from "node:path";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { checkCoverage, main as coverageMain } from "./coverage-gate.mjs";
import { checkAcceptance, declarations, casesFromReport, main as acceptanceMain } from "./check-acceptance.mjs";
import { ROOT, location, section, files, json, isMain } from "./test-infra.mjs";

/** 构造一份有真实文件记录的最小覆盖率报告。 */
function coverageFixture() {
  const metric = { total: 100, covered: 100 };
  const entry = { lines: { ...metric }, branches: { ...metric } };
  return {
    root: ROOT,
    summary: { total: structuredClone(entry), [resolve(ROOT, "src/sample.ts")]: entry },
    sources: { "src/sample.ts": "export const value = 1;" },
    markdown: "## 豁免清单\n\n| 源码位置 | 原因 |\n| --- | --- |",
  };
}

/** 构造展开过 each 的真实 reporter 形状，不依赖 Vitest 内部对象。 */
function acceptanceFixture() {
  const file = "test/sample.node.test.ts";
  return {
    root: ROOT,
    markdown: `## API-xx\n| API-01 | 例子 | ${file} :: suite > case | 已通过 |\n## 豁免/未映射\n`,
    reports: [{ testResults: [{ name: resolve(ROOT, file), assertionResults: [{ ancestorTitles: ["suite"], title: "case", status: "passed" }] }] }],
    sources: { [file]: 'describe("suite", () => { it("case", () => {}); });' },
  };
}

/** 用临时 JSON 文件测试真实 CLI 读取路径，并隔离参数、控制台和文件副作用。 */
function cliFixture(run) {
  const parent = resolve(ROOT, "scripts");
  const directory = mkdtempSync(resolve(parent, ".d-infra-"));
  if (!directory.startsWith(parent + sep)) throw new Error("清理目录必须在 scripts 内");
  const argv = process.argv;
  const log = console.log;
  const error = console.error;
  const messages = [];
  console.log = console.error = (...args) => messages.push(args.join(" "));
  try {
    run(directory, messages);
  } finally {
    process.argv = argv;
    console.log = log;
    console.error = error;
    rmSync(directory, { recursive: true, force: true });
  }
}

void test("coverage CLI: 真正读取 JSON 并打印数值，缺失文件返回非零", () => {
  cliFixture((directory, messages) => {
    const path = resolve(directory, "summary.json");
    writeFileSync(path, JSON.stringify(coverageFixture().summary));
    process.argv = [process.execPath, "coverage-gate.mjs", path];
    // 合法 JSON 但缺少本项目其他源码的记录，必须拒绝。
    assert.equal(coverageMain(), 1);
    assert.ok(messages.some((message) => message.includes("lines: 100/100")));
    process.argv[2] = resolve(directory, "missing.json");
    assert.equal(coverageMain(), 1);
    assert.ok(messages.some((message) => message.includes("ENOENT")));
  });
});

void test("acceptance CLI: 离线空报告失败且带计数，损坏 JSON 失败", () => {
  cliFixture((directory, messages) => {
    const path = resolve(directory, "report.json");
    writeFileSync(path, JSON.stringify({ testResults: [] }));
    process.argv = [process.execPath, "check-acceptance.mjs", "--report", path];
    assert.equal(acceptanceMain(), 1);
    assert.ok(messages.some((message) => message.includes("真实用例 0")));
    writeFileSync(path, "{broken");
    assert.equal(acceptanceMain(), 1);
  });
});

void test("coverage: 完整报告通过且精确显示数值", () => {
  const result = checkCoverage(coverageFixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.lines.pct, 100);
});

void test("coverage: 0/0 即使 reporter 声称 100% 仍失败", () => {
  const fixture = coverageFixture();
  for (const entry of Object.values(fixture.summary)) for (const metric of Object.values(entry)) Object.assign(metric, { total: 0, covered: 0, pct: 100 });
  assert.equal(checkCoverage(fixture).errors.filter((error) => error.includes("0/0")).length, 2);
});

void test("coverage: 缺少采集记录/源码一律失败", () => {
  const fixture = coverageFixture();
  fixture.summary = {};
  assert.match(checkCoverage(fixture).errors.join("\n"), /没有文件覆盖率采集记录/);
  assert.match(checkCoverage(fixture).errors.join("\n"), /没有采集记录: src\/sample.ts/);
  fixture.sources = {};
  assert.match(checkCoverage(fixture).errors.join("\n"), /没有待统计的源文件/);
});

void test("coverage: v8 ignore 未登记失败、登记后通过、旧行号失败", () => {
  const fixture = coverageFixture();
  fixture.sources["src/sample.ts"] = "/* v8 ignore next */\nexport const value = 1;";
  assert.match(checkCoverage(fixture).errors.join("\n"), /v8 ignore 未登记: src\/sample.ts:1/);
  fixture.markdown += "\n| `src/sample.ts:1` | 不可达的宿主路径 |";
  assert.deepEqual(checkCoverage(fixture).errors, []);
  fixture.sources["src/sample.ts"] = "\n// v8 ignore next\nexport const value = 1;";
  assert.match(checkCoverage(fixture).errors.join("\n"), /行号漂移/);
});

void test("coverage: 禁止从其他章节借用豁免", () => {
  const fixture = coverageFixture();
  fixture.sources["src/sample.ts"] = "// v8 ignore next\nvalue();";
  fixture.markdown += "\n## 其他\n| src/sample.ts:1 | 理由 |";
  assert.match(checkCoverage(fixture).errors.join("\n"), /未登记/);
});

void test("coverage: lines 必须 100%，branches 恰好 95% 通过", () => {
  const fixture = coverageFixture();
  for (const entry of Object.values(fixture.summary)) entry.branches.covered = 95;
  assert.deepEqual(checkCoverage(fixture).errors, []);
  for (const entry of Object.values(fixture.summary)) entry.lines.covered = 99;
  assert.match(checkCoverage(fixture).errors.join("\n"), /99\/100/);
});

void test("coverage: 四舍五入不使 94.999% 通过", () => {
  const fixture = coverageFixture();
  for (const entry of Object.values(fixture.summary)) entry.branches = { covered: 94999, total: 100000 };
  assert.match(checkCoverage(fixture).errors.join("\n"), /< 95%/);
});

void test("coverage: 损坏 metric、总数不一致、范围外文件均失败", () => {
  const fixture = coverageFixture();
  fixture.summary[resolve(ROOT, "src/sample.ts")].lines.covered = 101;
  fixture.summary[resolve(ROOT, "test/unwanted.ts")] = { branches: { total: 1, covered: 1 } };
  const errors = checkCoverage(fixture).errors.join("\n");
  assert.match(errors, /无效 lines/);
  assert.match(errors, /total 与文件记录不一致/);
  assert.match(errors, /统计范围超出 src/);
});

void test("acceptance: 精确映射同时覆盖 describe 祖先", () => {
  const result = checkAcceptance(acceptanceFixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.count, 1);
});

void test("acceptance: 非修复 BUG 核验文档章节，不能替代已修复回归", () => {
  const fixture = acceptanceFixture();
  fixture.documents = { "README.md": "## Known limits\nDeferred format change." };
  fixture.markdown += "\n| BUG-A2 | 格式兼容故延后 | README.md :: Known limits | 降级未修：D11 |";
  assert.deepEqual(checkAcceptance(fixture).errors, []);
  fixture.documents["README.md"] = "## Renamed";
  assert.match(checkAcceptance(fixture).errors.join("\n"), /文档章节不存在/);
  fixture.markdown = fixture.markdown.replace("降级未修：D11", "已修复");
  assert.throws(() => checkAcceptance(fixture), /仅非修复 BUG/);
});

void test("acceptance: 离线报告中失败或跳过的用例不能通过", () => {
  const fixture = acceptanceFixture();
  for (const status of ["failed", "pending", "skipped", undefined]) {
    fixture.reports[0].testResults[0].assertionResults[0].status = status;
    assert.match(checkAcceptance(fixture).errors.join("\n"), /用例未通过/);
  }
});

void test("acceptance CLI: 运行器失败保留退出码，不以缺失报告掩盖失败", () => {
  const path = resolve(ROOT, "coverage/acceptance-results.json");
  const previous = existsSync(path) ? readFileSync(path) : undefined;
  try {
    cliFixture((_directory, messages) => {
      process.argv = [process.execPath, "check-acceptance.mjs"];
      assert.equal(acceptanceMain(() => 7), 7);
      assert.ok(messages.some((message) => message.includes("测试执行失败（退出码 7）")));
      assert.ok(messages.every((message) => !message.includes("ENOENT")));
    });
  } finally {
    if (previous) writeFileSync(path, previous);
  }
});

void test("acceptance: browser 导入共享 node 测试时，以 JSON 的真实文件归属映射", () => {
  const fixture = acceptanceFixture();
  fixture.sources["test/sample.node.test.ts"] = 'import "./shared.node.test";';
  assert.deepEqual(checkAcceptance(fixture).errors, []);
});

void test("acceptance: 矩阵悬空与反向未映射同时失败", () => {
  const fixture = acceptanceFixture();
  fixture.markdown = fixture.markdown.replace("suite > case", "suite > missing");
  const errors = checkAcceptance(fixture).errors.join("\n");
  assert.match(errors, /引用不存在/);
  assert.match(errors, /未映射/);
});

void test("acceptance: each 按真实展开全名映射", () => {
  const fixture = acceptanceFixture();
  fixture.sources["test/sample.node.test.ts"] = 'describe.each(["ls"])("suite %s", () => { it.each([1])("case %i", () => {}); });';
  fixture.reports[0].testResults[0].assertionResults[0] = { ancestorTitles: ["suite ls"], title: "case 1", status: "passed" };
  fixture.markdown = fixture.markdown.replace("suite > case", "suite ls > case 1");
  assert.deepEqual(checkAcceptance(fixture).errors, []);
  fixture.sources["test/sample.node.test.ts"] += 'describe.each([])("empty %s", () => {});';
  assert.match(checkAcceptance(fixture).errors.join("\n"), /声明未出现在 JSON 报告/);
});

void test("acceptance: Markdown 转义竖线按真实标题匹配", () => {
  const fixture = acceptanceFixture();
  fixture.sources["test/sample.node.test.ts"] = 'describe("suite", () => { it("number|null", () => {}); });';
  fixture.reports[0].testResults[0].assertionResults[0].title = "number|null";
  fixture.markdown = fixture.markdown.replace("suite > case", "suite > number\\|null");
  assert.deepEqual(checkAcceptance(fixture).errors, []);
});

void test("acceptance: 动态标题错误带文件位置且不吞掉双向错误", () => {
  const fixture = acceptanceFixture();
  fixture.sources["test/sample.node.test.ts"] = 'describe(variable, () => { it("case", () => {}); });';
  fixture.markdown = fixture.markdown.replace("suite > case", "suite > missing");
  const errors = checkAcceptance(fixture).errors.join("\n");
  assert.match(errors, /test\/sample.node.test.ts: 无法静态解析/);
  assert.match(errors, /引用不存在/);
});

void test("acceptance: 动态变量/插值/拼接标题直接失败", () => {
  for (const title of ["title", "`case ${value}`", '"case" + value']) {
    assert.throws(() => declarations(`it(${title}, () => {});`), /无法静态解析/);
  }
});

void test("acceptance: 忽略注释和字符串中的伪声明，支持跳过条件", () => {
  const result = declarations('// it(dynamic)\nconst text = "describe(dynamic)"; describe.skipIf(false)("suite", () => { test.only("case", () => {}); });');
  assert.deepEqual(
    result.map((entry) => entry.name),
    ["suite", "case"],
  );
});

void test("acceptance: 支持字符串转义，拒绝保留分隔符和不支持转义", () => {
  assert.equal(declarations('it("a\\n\\\"b", () => {})')[0].name, 'a\n"b');
  assert.throws(() => declarations('it("a > b", () => {})'), /保留分隔符/);
  assert.throws(() => declarations('it("a\\x20b", () => {})'), /不支持的转义/);
  assert.throws(() => declarations('it.each`a`("case", () => {})'), /括号数据表/);
});

void test("acceptance: 指定 suite 白名单有效且悬空白名单失败", () => {
  const fixture = acceptanceFixture();
  fixture.markdown = "## API-xx\n## 豁免/未映射\n| UNMAPPED-01 | 等待第三波登记 | test/sample.node.test.ts :: suite > ** | 暂缓 |";
  assert.deepEqual(checkAcceptance(fixture).errors, []);
  fixture.markdown = fixture.markdown.replace("suite > **", "unknown > **");
  assert.match(checkAcceptance(fixture).errors.join("\n"), /引用不存在/);
});

void test("acceptance: 空报告、报告缺失源文件、空 suite 失败", () => {
  const fixture = acceptanceFixture();
  fixture.sources["test/empty.node.test.ts"] = 'describe("empty", () => {});';
  assert.match(checkAcceptance(fixture).errors.join("\n"), /文件无真实用例/);
  delete fixture.sources["test/sample.node.test.ts"];
  assert.match(checkAcceptance(fixture).errors.join("\n"), /不存在的测试文件/);
  fixture.reports = [{ testResults: [] }];
  assert.match(checkAcceptance(fixture).errors.join("\n"), /没有采集到任何真实测试/);
  assert.throws(() => casesFromReport({}), /缺少 testResults/);
});

void test("acceptance: 重复 ID 和错误表格格式失败", () => {
  const fixture = acceptanceFixture();
  fixture.markdown += "\n| API-01 | 例子 | test/sample.node.test.ts :: suite > case | 已通过 |";
  assert.match(checkAcceptance(fixture).errors.join("\n"), /重复 ID/);
  fixture.markdown += "\n| API-02 | 空列 | | |";
  assert.throws(() => checkAcceptance(fixture), /四个非空/);
});

void test("acceptance: 不允许矩阵通配和错误文件位置", () => {
  const fixture = acceptanceFixture();
  fixture.markdown = fixture.markdown.replace("suite > case", "suite > **");
  assert.throws(() => checkAcceptance(fixture), /仅未映射白名单/);
  fixture.markdown = fixture.markdown.replace("test/sample.node.test.ts", "src/sample.ts");
  assert.throws(() => checkAcceptance(fixture), /无效测试位置/);
});

void test("infra: 路径、章节、递归读取和入口判断", () => {
  assert.equal(location(resolve(ROOT, "src/index.ts")), "src/index.ts");
  assert.equal(section("## A\nvalue\n## B\nother", "A"), "value");
  assert.throws(() => section("", "missing"), /缺少章节/);
  assert.ok(files(resolve(ROOT, "test/helpers")).some((file) => file.endsWith("clock.ts")));
  assert.equal(json(resolve(ROOT, "package.json")).name, "@codejoo/storage");
  assert.equal(isMain(import.meta.url), true);
  assert.equal(isMain(new URL("./test-infra.mjs", import.meta.url).href), false);
});
