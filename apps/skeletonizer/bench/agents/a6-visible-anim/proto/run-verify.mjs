// run-locked.mjs 副本：拿到锁 → 起独立 Chrome → 跑本目录 verify.mjs → 关 Chrome → 释放锁。
// 用法：node run-verify.mjs <port> <profileDir> <perfPageUrl>
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [port, profile, host, script = "verify.mjs"] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, "../../bench/kit");
const scen = "verify";
const LOCK = path.join(KIT, "bench.lock");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (file, ...args) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(KIT, file), ...args]).toString().trim();

let waited = 0;
for (;;) {
  try {
    fs.mkdirSync(LOCK);
    break;
  } catch {
    if (waited % 30000 === 0) console.error(`[lock] 等待其他基准结束… ${waited / 1000}s`);
    await sleep(2000);
    waited += 2000;
  }
}
fs.writeFileSync(path.join(LOCK, "owner.txt"), `${process.pid} ${new Date().toISOString()} ${scen}`);
const release = () => fs.rmSync(LOCK, { recursive: true, force: true });
process.on("SIGINT", () => { try { ps("kill-chrome.ps1", "-Port", port); } catch {} release(); process.exit(130); });

try {
  console.error(`[cpu] ${ps("cpu.ps1")}`);
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "about:blank"], { detached: true, stdio: "ignore" });
  chrome.on("error", (e) => console.error("[chrome] 启动失败", e.message));
  chrome.unref();
  await sleep(6000);
  await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, script)], { env: { ...process.env, PERF_PORT: port, PERF_HOST: host }, stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", resolve);
    p.on("error", (e) => { console.error("[trace] 启动失败", e.message); resolve(); });
  });
} finally {
  try { ps("kill-chrome.ps1", "-Port", port); } catch {}
  release();
}
