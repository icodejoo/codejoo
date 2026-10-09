// 复用工具包的锁约定（mkdir bench.lock）：拿锁 → 起 Chrome → 回调里用 CDP → 关 Chrome → 释放锁
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const KIT = "C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/bench-kit";
export const PROFILE = "C:/Users/jelon/AppData/Local/Temp/claude/E--workspaces-codejoo-apps-skeletonizer/e3f6b10e-1e75-45cc-b90b-f1592b13a871/scratchpad/chrome-prof-a3";
const LOCK = path.join(KIT, "bench.lock");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ps = (file, ...args) => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(KIT, file), ...args]).toString().trim();

export async function runLocked(port, tag, fn) {
  if (process.env.A3_SESSION) return runAttached(port, fn);
  let waited = 0;
  for (;;) {
    try { fs.mkdirSync(LOCK); break; } catch {
      if (waited % 30000 === 0) console.error(`[lock] 等待其他基准结束… ${waited / 1000}s`);
      await sleep(2000); waited += 2000;
    }
  }
  fs.writeFileSync(path.join(LOCK, "owner.txt"), `${process.pid} ${new Date().toISOString()} a3 ${tag}`);
  const release = () => fs.rmSync(LOCK, { recursive: true, force: true });
  process.on("SIGINT", () => { try { ps("kill-chrome.ps1", "-Port", String(port)); } catch {} release(); process.exit(130); });
  try {
    const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "about:blank"], { detached: true, stdio: "ignore" });
    chrome.unref();
    await sleep(6000);
    let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(300); } }
    const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0; const pend = new Map();
    ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
    await send("Page.enable"); await send("Page.bringToFront");
    try { await fn({ send, ev, sleep }); } finally { await send("Browser.close").catch(() => {}); }
  } finally {
    try { ps("kill-chrome.ps1", "-Port", String(port)); } catch {}
    release();
  }
}

/** 会话模式：锁和 Chrome 由 session.mjs 持有，这里只连上现有的页面 */
async function runAttached(port, fn) {
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map();
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  await send("Page.enable"); await send("Page.bringToFront");
  try { await fn({ send, ev, sleep }); } finally { await send("Emulation.clearDeviceMetricsOverride").catch(() => {}); ws.close(); }
}
