// 基准共用：启动无头 Chrome（或 CHROME 环境变量指定的 Chromium 系浏览器）并用 CDP 驱动。
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const benchDir = resolve(import.meta.dirname, "../../.bench");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

/** 页面地址：query 为场景参数 */
export const pageUrl = (query) => pathToFileURL(join(benchDir, "bench.html")).href + "?" + new URLSearchParams(query).toString();

/** 打开 CDP 连接（BENCH_HEADED=1 用有头窗口）；返回 { cmd, on, off, ev, metrics, open, browser, close } */
export async function launch(port) {
  const chrome = process.env.CHROME ?? DEFAULT_CHROME;
  if (!existsSync(chrome)) throw new Error(`找不到浏览器：${chrome}（可用 CHROME 环境变量指定）`);
  const proc = spawn(
    chrome,
    [
      ...(process.env.BENCH_HEADED
        ? ["--window-size=1000,1000", "--window-position=0,0", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"]
        : ["--headless=new"]),
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${mkdtempSync(join(benchDir, "prof-"))}`,
      "--no-first-run",
      "--allow-file-access-from-files",
      ...(process.env.BENCH_NO_THROTTLE_FLAGS ? ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()).find((t) => t.type === "page");
    } catch {
      /* 浏览器还没起来，继续等 */
    }
    await sleep(200);
  }
  const browserWs = (await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json()).webSocketDebuggerUrl;
  const connect = (url) =>
    new Promise((res) => {
      const ws = new WebSocket(url);
      let id = 1;
      const pend = new Map();
      const listeners = new Map();
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pend.has(m.id)) {
          pend.get(m.id)(m);
          pend.delete(m.id);
        } else if (m.method && listeners.has(m.method)) {
          listeners.get(m.method)(m.params);
        }
      };
      ws.onopen = () =>
        res({
          on: (method, fn) => listeners.set(method, fn),
          off: (method) => listeners.delete(method),
          cmd: (method, params = {}) =>
            new Promise((r) => {
              const i = id++;
              pend.set(i, r);
              ws.send(JSON.stringify({ id: i, method, params }));
            }),
        });
    });
  const p = await connect(page.webSocketDebuggerUrl);
  const browser = await connect(browserWs);
  await p.cmd("Page.enable");
  await p.cmd("Performance.enable");
  return {
    cmd: p.cmd,
    on: p.on,
    off: p.off,
    browser: browser.cmd,
    pageId: page.id,
    ev: async (expr) => (await p.cmd("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value,
    metrics: async () => Object.fromEntries((await p.cmd("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value])),
    /** 导航并等页面脚本就绪 */
    async open(query) {
      await p.cmd("Page.navigate", { url: pageUrl(query) });
      for (let i = 0; i < 50 && !(await this.ev("window.__ready")); i++) await sleep(100);
    },
    close: () => proc.kill(),
  };
}
