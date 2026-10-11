// 跑一批：等 CPU 安静 -> bench/kit/run-locked.mjs 加锁串行（端口 9917）-> 结果写 results/<批>.jsonl。用法：node run.mjs <批名 smoke|P|C> [标签]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), PKG = path.resolve(HERE, "../../../..");
const [BATCH, LABEL = ""] = process.argv.slice(2);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "a9-perf-chrome-"));
const idle = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "wait-idle.ps1"), "-Max", "15", "-Need", "6", "-TimeoutSec", "120"], { encoding: "utf8" }).stdout.trim();
console.error("[idle]", idle);
const log = path.join(HERE, "../results", `cpu-${BATCH}${LABEL}.log`); fs.rmSync(log, { force: true });
const logger = spawnSync("powershell", ["-NoProfile", "-Command", "exit 0"]); // 占位，CPU 采样用下面的后台进程
import { spawn } from "node:child_process";
const lg = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "cpu-log.ps1"), "-Out", log], { stdio: "ignore" });
const env = { ...process.env, PERF_VIEWPORT: "1200x800", PERF_SCRIPT: path.join(HERE, "trace.mjs") };
const r = spawnSync(process.execPath, [path.join(PKG, "bench/kit/run-locked.mjs"), "9917", profile, path.join(HERE, "../scenarios", `sc-${BATCH}.json`), "http://localhost:5919/bench/agents/a9-round-bar/perf.html", "3"], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 3000000, env });
spawnSync("taskkill", ["/PID", String(lg.pid), "/T", "/F"]);
spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PKG, "bench/kit/kill-chrome.ps1"), "-Port", "9917"]);
const rows = (r.stdout || "").split("\n").filter((l) => l.startsWith("{"));
fs.writeFileSync(path.join(HERE, "../results", `${BATCH}${LABEL}.jsonl`), rows.join("\n") + "\n");
fs.writeFileSync(path.join(HERE, "../results", `${BATCH}${LABEL}.err`), r.stderr || "");
const vals = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => +l.split(",")[1]).filter((x) => !Number.isNaN(x)) : [];
console.error(`[${BATCH}] rows=${rows.length} cpu mean=${(vals.reduce((a, b) => a + b, 0) / (vals.length || 1)).toFixed(1)} max=${Math.max(0, ...vals)}`);
