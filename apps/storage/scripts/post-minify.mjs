/**
 * 构建后处理：用 terser 对 `dist/index.min.js` 做二次压缩。
 *
 * 原因：打包用的 oxc-minifier 不支持 `mangle.properties`，用 terser 再过一遍进一步缩小体积。
 * 属性混淆只作用于 `_` 前缀名（约定的内部成员），公共 API 的属性名保持不变。
 */
import { minify } from "terser";
import { readFile, writeFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(__dirname, "../dist/index.min.js");

const before = await readFile(target, "utf-8");
const beforeRaw = before.length;
const beforeGz = gzipSync(before, { level: 9 }).length;

const out = await minify(before, {
  module: true,
  ecma: 2020,
  compress: {
    passes: 2,
    pure_getters: true,
  },
  mangle: {
    toplevel: true,
    properties: {
      // Only mangle `_*` private-by-convention members. Public API is unaffected.
      regex: /^_/,
    },
  },
  format: { comments: false },
});

if (!out.code) throw new Error("terser returned empty output");

await writeFile(target, out.code);
const afterRaw = out.code.length;
const afterGz = gzipSync(out.code, { level: 9 }).length;

const fmt = (n) => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`);
const diff = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;

console.log(`post-minify  raw: ${fmt(beforeRaw)} → ${fmt(afterRaw)}  (${diff(beforeRaw, afterRaw)})`);
console.log(`post-minify  gz : ${fmt(beforeGz)} → ${fmt(afterGz)}  (${diff(beforeGz, afterGz)})`);
