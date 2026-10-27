/**
 * Static file server for the demo page, with an optional throttled mode for
 * manually observing progimg's three-stage placeholder timeline (color block
 * → static first frame → full animation) against a slow network. Not part of
 * the package build.
 *
 * demo 页静态文件服务器,可选限速模式用于在慢网络下人工观察 progimg 的三段占位时间轴
 * (色块 → 静态首帧 → 完整动画)。不参与包构建。
 *
 * Usage — 用法:
 *   node --experimental-strip-types examples/serve.ts             # 默认不限速
 *   node --experimental-strip-types examples/serve.ts --throttle 51200
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { once } from "node:events";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
// resolve 会去掉目录末尾的分隔符,后面做前缀校验时才不会漏判
const examplesDir = resolve(here);
const distDir = resolve(here, "..", "dist");

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

/**
 * 把请求路径解析到 baseDir 之下的绝对路径,并拒绝越出 baseDir 的路径(路径穿越)。
 * @param baseDir - 允许访问的根目录(绝对路径,末尾无分隔符)
 * @param relPath - 以 "/" 开头、相对 baseDir 的请求路径
 * @returns 安全的绝对路径;越界时为 null
 */
function resolveInside(baseDir: string, relPath: string): string | null {
  const filePath = resolve(baseDir, "." + relPath);
  return filePath === baseDir || filePath.startsWith(baseDir + sep) ? filePath : null;
}

const throttleBytesPerSec = parseThrottle();
const port = 8787;

/**
 * Stream a file to the response, sleeping between chunks to simulate a
 * capped-bandwidth network link. Honors a `Range` request header (206 partial
 * content) so `<video>` playback/seek and progimg's first-frame Range fetch work,
 * and sends permissive CORS headers so cross-origin frame grabbing can be tried.
 *
 * 把文件流式发给响应,分块间 sleep,模拟带宽受限的网络链路。支持 `Range` 请求头(206 部分内容),
 * 使 `<video>` 播放/seek 与 progimg 抓首帧的 Range 请求可用;并发送宽松 CORS 头,便于试跨域抓帧。
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
    if (!m[1] && m[2]) {
      // 后缀 Range bytes=-N:取最后 N 字节;N=0 不可满足
      const n = Number(m[2]);
      start = n === 0 ? size : Math.max(0, size - n); // start=size 会触发下面的 416
      end = size - 1;
    } else {
      if (m[1]) start = Number(m[1]);
      if (m[2]) end = Number(m[2]);
      end = Math.min(end, size - 1);
    }
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
    const stream = createReadStream(filePath, { start, end });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return;
  }

  const chunkSize = Math.max(1024, Math.floor(throttleBytesPerSec / 10)); // ~10 writes/sec — 每秒约写 10 次

  const stream = createReadStream(filePath, { start, end, highWaterMark: chunkSize });
  // 客户端中途断开:销毁文件流,下面的循环随之结束
  let closed = false;
  res.on("close", () => {
    closed = true;
    stream.destroy();
  });
  for await (const chunk of stream) {
    if (closed) break;
    // 背压:写缓冲满了就等 drain(连接断开则不再等)
    if (!res.write(chunk) && !closed) await waitDrainOrClose(res);
    if (closed) break;
    // 按实际 chunk 字节数算等待时长,chunk 下限 1024 时低速限速也不会失效
    await new Promise((r) => setTimeout(r, (chunk.length / throttleBytesPerSec) * 1000));
  }
  if (!closed) res.end();
}

/**
 * 等待响应 drain 或 close(先到者为准);结算后 abort 掉另一个监听,避免每轮遗留监听器。
 * @param res - HTTP 响应
 */
async function waitDrainOrClose(res: ServerResponse): Promise<void> {
  const ac = new AbortController();
  const { signal } = ac;
  try {
    await Promise.race([once(res, "drain", { signal }), once(res, "close", { signal })]);
  } catch (err) {
    // 另一侧被 abort 引发的 AbortError 属于预期,其余错误照常抛出
    if ((err as { name?: string }).name !== "AbortError") throw err;
  } finally {
    ac.abort();
  }
}

/**
 * 统一启动一次文件响应:任何异常按"未发头回 500、已发头直接销毁连接"处理。
 * @param filePath - 文件绝对路径
 * @param req - 请求
 * @param res - 响应
 */
function serveFile(filePath: string, req: IncomingMessage, res: ServerResponse): void {
  streamThrottled(filePath, req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end("internal error");
    else res.destroy();
  });
}

createServer((req: IncomingMessage, res: ServerResponse) => {
  // decode percent-encoding so non-ASCII filenames (e.g. sample_1280×853.png) resolve on disk
  // 解码 percent-encoding,使非 ASCII 文件名(如 sample_1280×853.png)能在磁盘上找到
  let pathname: string;
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }

  // Serve built ESM entries/chunks straight out of dist/ (index.html imports ../dist/esm/*.mjs)
  // 直接从 dist/ 提供构建产物(index.html 引用 ../dist/esm/*.mjs)
  if (pathname.startsWith("/dist/")) {
    const filePath = resolveInside(distDir, pathname.slice("/dist".length));
    if (filePath === null) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    serveFile(filePath, req, res);
    return;
  }

  // Serve the prebuilt standalone SW straight out of dist/ — 直接从 dist/ 提供预构建成品 SW
  if (pathname === "/progimg-sw.js") {
    const filePath = join(distDir, "progimg-sw.js");
    if (!existsSync(filePath)) {
      res.writeHead(404).end("dist/progimg-sw.js not found — run `pnpm build` first");
      return;
    }
    serveFile(filePath, req, res);
    return;
  }

  const filePath = resolveInside(examplesDir, pathname);
  if (filePath === null) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  serveFile(filePath, req, res);
}).listen(port, () => {
  console.log(`progimg demo: http://localhost:${port} (${throttleBytesPerSec === null ? "unthrottled" : `throttle: ${throttleBytesPerSec} B/s`})`);
});
