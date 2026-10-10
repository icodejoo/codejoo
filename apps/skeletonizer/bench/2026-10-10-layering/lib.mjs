// 共用：起独立 Chrome（临时 user-data-dir、端口 9588）、CDP 封装。测完只关自己起的（按端口）。lock=true 时拿 bench.lock。
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const PORT = +(process.env.PORT_CDP || 9622);
const KIT = "E:/workspaces/codejoo/apps/skeletonizer/bench/kit";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK = path.join(KIT, "bench.lock");
export async function launch({ headless = false, w = 1280, h = 900, lock = false, extra = [] } = {}) {
  if (lock) for (;;) { try { fs.mkdirSync(LOCK); break; } catch { await sleep(2000); } }
  if (lock) fs.writeFileSync(path.join(LOCK, "owner.txt"), `${process.pid} landing ${new Date().toISOString()}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skz-landing-chrome-"));
  const args = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", `--window-size=${w},${h}`, "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", ...extra];
  if (headless) args.push("--headless=new");
  args.push("about:blank");
  const c = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", args, { detached: true, stdio: "ignore" }); c.unref();
  let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (tabs.find((t) => t.type === "page")) break; } catch {} await sleep(300); }
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const events = [];
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else events.push(d); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value; };
  await send("Page.enable"); await send("Page.bringToFront");
  const goto = async (url, ready = "document.readyState==='complete'") => { await send("Page.navigate", { url }); await sleep(500); for (let i = 0; i < 80 && !(await ev(ready).catch(() => false)); i++) await sleep(250); await sleep(300); };
  const shot = async (file, clip, scale = 1) => { const p = { format: "png" }; if (clip) p.clip = { ...clip, scale }; const r = await send("Page.captureScreenshot", p); fs.writeFileSync(file, Buffer.from(r.result.data, "base64")); };
  const close = async () => { try { await send("Browser.close"); } catch {} try { execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(KIT, "kill-chrome.ps1"), "-Port", String(PORT)]); } catch {} if (lock) fs.rmSync(LOCK, { recursive: true, force: true }); };
  return { send, ev, goto, shot, close, events };
}
