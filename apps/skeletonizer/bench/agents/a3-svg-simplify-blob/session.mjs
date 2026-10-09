// 拿一次锁、起一次 Chrome，依次跑多个步骤（每步是一个 node 子进程，环境变量 A3_SESSION=1 表示复用这个 Chrome）
// 用法：node session.mjs "step1 args" "step2 args" ...    例：node session.mjs "colors.mjs 12" "trace-a3.mjs sc-x.json 3"
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { KIT, PROFILE, sleep } from "./lock.mjs";
const PORT = 9343, HOST = "http://localhost:5188/demo/.tmp-a3/perf.html";
const LOCK = path.join(KIT, "bench.lock");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ps = (file, ...args) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(KIT, file), ...args]).toString().trim();
let waited = 0;
if (!process.env.A3_HOLD) for (;;) { try { fs.mkdirSync(LOCK); break; } catch { if (waited % 60000 === 0) console.error(`[lock] 等待… ${waited / 1000}s`); await sleep(2000); waited += 2000; } }
if (!process.env.A3_HOLD) fs.writeFileSync(path.join(LOCK, "owner.txt"), `${process.pid} ${new Date().toISOString()} a3-session ${process.argv.slice(2).join(" | ")}`);
const release = () => fs.rmSync(LOCK, { recursive: true, force: true });
process.on("SIGINT", () => { try { ps("kill-chrome.ps1", "-Port", String(PORT)); } catch {} release(); process.exit(130); });
try {
  console.error(`[cpu] ${ps("cpu.ps1")}`);
  const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "about:blank"], { detached: true, stdio: "ignore" });
  chrome.unref();
  await sleep(6000);
  for (const step of process.argv.slice(2)) {
    const [script, ...args] = step.split(" ");
    console.error(`[step] ${step}`);
    await new Promise((resolve) => {
      const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, A3_SESSION: "1", PERF_PORT: String(PORT), PERF_HOST: HOST }, stdio: ["ignore", "inherit", "inherit"] });
      p.on("exit", resolve); p.on("error", (e) => { console.error(e.message); resolve(); });
    });
  }
} finally { try { ps("kill-chrome.ps1", "-Port", String(PORT)); } catch {} release(); }
