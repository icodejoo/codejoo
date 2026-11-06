import { spawnSync } from "node:child_process";
import { ROOT } from "./test-infra.mjs";

/** 依次运行并保留全部错误，覆盖率未达标也输出验收矩阵问题。 */
function run(script) {
  const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const coverage = run("run-coverage");
const threshold = run("coverage-gate");
const acceptance = run("check-acceptance");
process.exitCode = coverage || threshold || acceptance;
