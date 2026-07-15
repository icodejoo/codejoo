/**
 * Throttled static file server for manually observing picman's three-stage
 * placeholder timeline (color block → static first frame → full animation)
 * against a slow network. Not part of the package build.
 *
 * 限速静态文件服务器,用于在慢网络下人工观察 picman 的三段占位时间轴
 * (色块 → 静态首帧 → 完整动画)。不参与包构建。
 *
 * Usage — 用法:
 *   node --experimental-strip-types examples/serve.ts --throttle 51200
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const examplesDir = here;
const distDir = join(here, "..", "dist");

/** Parse --throttle <bytes/s> from argv, default 50KB/s — 从 argv 解析 --throttle(字节/秒),默认 50KB/s */
function parseThrottle(): number {
  const i = process.argv.indexOf("--throttle");
  if (i === -1 || !process.argv[i + 1]) return 50 * 1024;
  return Number(process.argv[i + 1]) || 50 * 1024;
}

/** Content-Type by file extension — 按扩展名映射 Content-Type */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".gif": "image/gif",
  ".png": "image/png",
  ".webp": "image/webp",
};

const throttleBytesPerSec = parseThrottle();
const port = 8787;

/**
 * Stream a file to the response, sleeping between chunks to simulate a
 * capped-bandwidth network link.
 *
 * 把文件流式发给响应,分块间 sleep,模拟带宽受限的网络链路。
 * @param filePath - Absolute file path — 文件绝对路径
 * @param res - HTTP response to write to — 待写入的 HTTP 响应
 */
async function streamThrottled(filePath: string, res: ServerResponse): Promise<void> {
  const ext = extname(filePath);
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(statSync(filePath).size));

  const chunkSize = Math.max(1024, Math.floor(throttleBytesPerSec / 10)); // ~10 writes/sec — 每秒约写 10 次
  const delayMs = 1000 / 10;

  const stream = createReadStream(filePath, { highWaterMark: chunkSize });
  for await (const chunk of stream) {
    res.write(chunk);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  res.end();
}

createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

  // Serve the prebuilt standalone SW straight out of dist/ — 直接从 dist/ 提供预构建成品 SW
  if (pathname === "/picman-sw.js") {
    const filePath = join(distDir, "picman-sw.js");
    if (!existsSync(filePath)) {
      res.writeHead(404).end("dist/picman-sw.js not found — run `pnpm build` first");
      return;
    }
    void streamThrottled(filePath, res);
    return;
  }

  const filePath = join(examplesDir, pathname);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  void streamThrottled(filePath, res);
}).listen(port, () => {
  console.log(`picman demo: http://localhost:${port} (throttle: ${throttleBytesPerSec} B/s)`);
});
