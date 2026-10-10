// 批量跑：等 CPU 安静 → 后台采样 CPU → run-locked 跑 → 批均值过高就整批重跑（不混用）
// 用法：node run-batches.mjs <批名...>   批名 A B C D（见 gen-scenarios.mjs）
// 结果写 results/<批>.jsonl，CPU 汇总写 results/cpu.jsonl
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "../..");
const PORT = "9611", PROFILE = "C:/Users/jelon/AppData/Local/Temp/skz-steps-chrome";
const URL_ = "http://localhost:5192/bench/2026-10-09-clip-steps/perf.html";
const MAX_MEAN = +(process.env.MAX_MEAN || 22), TRIES = +(process.env.TRIES || 3);
const ps = (file, ...a) => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, file), ...a], { encoding: "utf8" });
for (const batch of process.argv.slice(2)) {
  let best = null;
  for (let t = 1; t <= TRIES; t++) {
    const idle = ps("wait-idle.ps1", "-Max", "15", "-Need", "6", "-TimeoutSec", "600").stdout.trim();
    const log = path.join(HERE, "results", `cpu-${batch}-try${t}.log`);
    fs.rmSync(log, { force: true });
    const logger = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "cpu-log.ps1"), "-Out", log], { stdio: "ignore" });
    const started = new Date().toISOString();
    const env = { ...process.env, PERF_VIEWPORT: "1200x800", PERF_SCRIPT: path.join(HERE, "trace.mjs") };
    const r = spawnSync(process.execPath, [path.join(PKG, "bench/kit/run-locked.mjs"), PORT, PROFILE, path.join(HERE, "scenarios", `sc-${batch}.json`), URL_, "3"], { encoding: "utf8", maxBuffer: 1 << 28, timeout: +(process.env.BATCH_TIMEOUT_MS || 2400000), killSignal: "SIGKILL", env });
    try { ps("../kit/kill-chrome.ps1", "-Port", PORT); } catch {}
    // 只有被超时杀掉时才清锁（正常结束 run-locked 自己会释放；别在别人刚拿到锁时误删）
    if (r.signal) fs.rmSync(path.join(PKG, "bench/kit/bench.lock"), { recursive: true, force: true });
    try { execFileSync("taskkill", ["/PID", String(logger.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    const rows = (r.stdout || "").split("\n").filter((l) => l.startsWith("{"));
    const vals = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => +l.split(",")[1]).filter((x) => !Number.isNaN(x)) : [];
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN, max = vals.length ? Math.max(...vals) : NaN;
    const sorted = [...vals].sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)];
    const info = { batch, try: t, started, idleBefore: idle, cpuAtStart: (r.stderr.match(/\[cpu\] (.*)/) || [])[1], cpuMean: +mean.toFixed(1), cpuP90: +(p90 ?? NaN).toFixed(1), cpuMax: +max.toFixed(1), samples: vals.length, rows: rows.length };
    console.error(JSON.stringify(info));
    fs.appendFileSync(path.join(HERE, "results", "cpu.jsonl"), JSON.stringify(info) + "\n");
    fs.writeFileSync(path.join(HERE, "results", `${batch}.try${t}.jsonl`), rows.join("\n") + "\n");
    if (rows.length && (!best || mean < best.mean)) best = { mean, rows, info };
    if (rows.length && mean <= MAX_MEAN) break;
  }
  if (best) { fs.writeFileSync(path.join(HERE, "results", `${batch}.jsonl`), best.rows.join("\n") + "\n"); console.error(`[${batch}] 采用 cpuMean=${best.info.cpuMean} try=${best.info.try}`); }
  else console.error(`[${batch}] 没有结果`);
}
