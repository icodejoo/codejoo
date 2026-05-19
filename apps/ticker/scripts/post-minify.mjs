/**
 * Post-process `dist/index.min.js` with terser to mangle private `_*` fields.
 *
 * Why: oxc-minifier (used by vp pack) doesn't support `mangle.properties`.
 * Class-internal `_xxx` fields stay as full names in the bundle. Running
 * terser as a final pass with `mangle.properties: { regex: /^_/ }` shrinks
 * those names to 1-2 chars, saving ~10% raw / ~4% gzip on the .min.js.
 *
 * Only names matching /^_/ are mangled, so the public API surface
 * (Ticker.defaults, ticker.manager, task.id, etc.) stays intact.
 */
import { minify } from 'terser'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const target = resolve(__dirname, '../dist/index.min.js')

const before = await readFile(target, 'utf-8')
const beforeRaw = before.length
const beforeGz = gzipSync(before, { level: 9 }).length

const out = await minify(before, {
  module: true,
  ecma: 2020,
  compress: {
    passes: 2,
    pure_getters: true
  },
  mangle: {
    toplevel: true,
    properties: {
      // Only mangle `_*` private-by-convention members. Public API is unaffected.
      regex: /^_/
    }
  },
  format: { comments: false }
})

if (!out.code) throw new Error('terser returned empty output')

await writeFile(target, out.code)
const afterRaw = out.code.length
const afterGz = gzipSync(out.code, { level: 9 }).length

const fmt = (n) => (n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`)
const diff = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`

console.log(`post-minify  raw: ${fmt(beforeRaw)} → ${fmt(afterRaw)}  (${diff(beforeRaw, afterRaw)})`)
console.log(`post-minify  gz : ${fmt(beforeGz)} → ${fmt(afterGz)}  (${diff(beforeGz, afterGz)})`)
