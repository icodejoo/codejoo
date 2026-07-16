/**
 * Static file server for the demo page, with an optional throttled mode for
 * manually observing picman's three-stage placeholder timeline (color block
 * → static first frame → full animation) against a slow network. Not part of
 * the package build.
 *
 * demo 页静态文件服务器,可选限速模式用于在慢网络下人工观察 picman 的三段占位时间轴
 * (色块 → 静态首帧 → 完整动画)。不参与包构建。
 *
 * Usage — 用法:
 *   node --experimental-strip-types examples/serve.ts             # 默认不限速
 *   node --experimental-strip-types examples/serve.ts --throttle 51200
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const examplesDir = here;
const distDir = join(here, "..", "dist");

/** Parse --throttle <bytes/s> from argv; null means unthrottled(default) — 从 argv 解析 --throttle(字节/秒);null 表示不限速(默认) */
function parseThrottle(): number | null {
  const i = process.argv.indexOf("--throttle");
  if (i === -1 || !process.argv[i + 1]) return null;
  return Number(process.argv[i + 1]) || null;
}

/** Content-Type by file extension — 按扩展名映射 Content-Type */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".gif": "image/gif",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const throttleBytesPerSec = parseThrottle();
const port = 8787;

/**
 * Stream a file to the response, sleeping between chunks to simulate a
 * capped-bandwidth network link. Honors a `Range` request header (206 partial
 * content) so `<video>` playback/seek and picman's first-frame Range fetch work,
 * and sends permissive CORS headers so cross-origin frame grabbing can be tried.
 *
 * 把文件流式发给响应,分块间 sleep,模拟带宽受限的网络链路。支持 `Range` 请求头(206 部分内容),
 * 使 `<video>` 播放/seek 与 picman 抓首帧的 Range 请求可用;并发送宽松 CORS 头,便于试跨域抓帧。
 * @param filePath - Absolute file path — 文件绝对路径
 * @param req - Incoming request (read for Range) — 请求(读取 Range)
 * @param res - HTTP response to write to — 待写入的 HTTP 响应
 */
async function streamThrottled(filePath: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ext = extname(filePath);
  const size = statSync(filePath).size;

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (m) {
    if (m[1]) start = Number(m[1]);
    if (m[2]) end = Number(m[2]);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    status = 206;
  }

  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Access-Control-Allow-Origin", "*"); // 便于演示跨域抓帧
  res.setHeader("Content-Length", String(end - start + 1));
  if (status === 206) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.writeHead(status);

  // 不限速:直接 pipe,不做分块 sleep — unthrottled: pipe straight through, no chunked sleep
  if (throttleBytesPerSec === null) {
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  const chunkSize = Math.max(1024, Math.floor(throttleBytesPerSec / 10)); // ~10 writes/sec — 每秒约写 10 次
  const delayMs = 1000 / 10;

  const stream = createReadStream(filePath, { start, end, highWaterMark: chunkSize });
  for await (const chunk of stream) {
    res.write(chunk);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  res.end();
}

createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  // decode percent-encoding so non-ASCII filenames (e.g. sample_1280×853.png) resolve on disk
  // 解码 percent-encoding,使非 ASCII 文件名(如 sample_1280×853.png)能在磁盘上找到
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);

  // Serve built ESM entries/chunks straight out of dist/ (index.html imports ../dist/esm/*.mjs)
  // 直接从 dist/ 提供构建产物(index.html 引用 ../dist/esm/*.mjs)
  if (pathname.startsWith("/dist/")) {
    const filePath = join(distDir, pathname.slice("/dist/".length));
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    void streamThrottled(filePath, req, res);
    return;
  }

  // Serve the prebuilt standalone SW straight out of dist/ — 直接从 dist/ 提供预构建成品 SW
  if (pathname === "/picman-sw.js") {
    const filePath = join(distDir, "picman-sw.js");
    if (!existsSync(filePath)) {
      res.writeHead(404).end("dist/picman-sw.js not found — run `pnpm build` first");
      return;
    }
    void streamThrottled(filePath, req, res);
    return;
  }

  const filePath = join(examplesDir, pathname);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  void streamThrottled(filePath, req, res);
}).listen(port, () => {
  console.log(`picman demo: http://localhost:${port} (${throttleBytesPerSec === null ? "unthrottled" : `throttle: ${throttleBytesPerSec} B/s`})`);
});
