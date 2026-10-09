// 实验用的 CDP 小工具：起独立 Chrome（端口 9477、临时 user-data-dir）、连页面、求值、截图
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PORT = +(process.env.SWEEP_PORT || 9477);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PROFILE = process.env.SWEEP_PROFILE || path.join(process.env.TEMP || "C:/Windows/Temp", "skz-sweep-chrome");
export const killChrome = () => { try { execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "../kit/kill-chrome.ps1"), "-Port", String(PORT)]); } catch {} };

/** 起 Chrome 并连上第一个页面；extra 是附加启动参数 */
export async function launch(extra = []) {
  killChrome();
  const c = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", ...extra, "about:blank"], { detached: true, stdio: "ignore" });
  c.unref();
  let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(300); } }
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const handlers = [];
  ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else handlers.forEach((h) => h(d)); });
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; const to = setTimeout(() => j(new Error("timeout " + method)), 60000); pend.set(i, (d) => { clearTimeout(to); r(d); }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
  const shot = async (file) => { const d = (await send("Page.captureScreenshot", { format: "png" })).result.data; if (file) fs.writeFileSync(path.join(HERE, "shots", file), Buffer.from(d, "base64")); return crypto.createHash("md5").update(d).digest("hex").slice(0, 8); };
  await send("Page.enable"); await send("Page.bringToFront");
  const close = async () => { await send("Browser.close").catch(() => {}); await sleep(500); killChrome(); };
  return { send, ev, shot, close, on: (h) => handlers.push(h) };
}

/** 导航到基准页并等 window.ready；vp = [宽, 高, dpr] */
export async function open(b, query, vp = [1200, 800, 1]) {
  await b.send("Emulation.setDeviceMetricsOverride", { width: vp[0], height: vp[1], deviceScaleFactor: vp[2], mobile: false });
  await b.send("Page.navigate", { url: `http://localhost:5188/bench/2026-10-09-sweep/perf.html?${query}` });
  for (let i = 0; i < 80 && !(await b.ev("window.ready === true").catch(() => false)); i++) await sleep(250);
  await sleep(300);
}
/** 把所有 skz-sweep 动画暂停到 t 毫秒（作用于 ::after 的动画） */
export const pauseAt = (b, t) => b.ev(`(() => { let n = 0; for (const a of document.getAnimations()) if ((a.animationName || "").startsWith("skz-sweep")) { a.pause(); a.currentTime = ${t}; n++; } return n; })()`);

import zlib from "node:zlib";
/** 解 PNG（8 位 RGB/RGBA、非隔行），返回 { w, h, ch, data } */
export function pngDecode(buf) {
  let p = 8, w, h, ch; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ch = body[9] === 6 ? 4 : 3; } else if (type === "IDAT") idat.push(body);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[dst + x - ch] : 0, b = y ? out[dst - stride + x] : 0, c = x >= ch && y ? out[dst - stride + x - ch] : 0; let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
/** 截一张图并返回解码结果 */
export async function grab(b, file) {
  const d = (await b.send("Page.captureScreenshot", { format: "png" })).result.data; const buf = Buffer.from(d, "base64");
  if (file) fs.writeFileSync(path.join(HERE, "shots", file), buf);
  return pngDecode(buf);
}
/** 两张图的差异：不同像素数、最大通道差、差异像素的横向范围 */
export function diff(a, b) {
  let n = 0, max = 0, x0 = 1e9, x1 = -1;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a.data[(y * a.w + x) * a.ch + k] - b.data[(y * b.w + x) * b.ch + k])); if (m > 0) { n++; if (m > max) max = m; if (x < x0) x0 = x; if (x > x1) x1 = x; } }
  return { n, max, x0: x1 < 0 ? null : x0, x1: x1 < 0 ? null : x1 };
}

/** 把两张图的差异放大 gain 倍写成灰度 PNG，用来肉眼看光带形状 */
export function writeDiffViz(a, c, file, gain = 16) {
  const w = a.w, h = a.h, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { let m = 0; for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a.data[(y * w + x) * a.ch + k] - c.data[(y * w + x) * c.ch + k])); const v = Math.min(255, m * gain), o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = raw[o + 1] = raw[o + 2] = v; } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cc]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(path.join(HERE, "shots", file), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
