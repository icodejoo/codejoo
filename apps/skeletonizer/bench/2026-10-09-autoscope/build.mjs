// 编译各组 CSS：A 现状自动 / D explicit / S 作用域（B、C、E 共用）。每个都叠上 global 变体。
// 用法（在包目录下才能解析 sass）：node bench/2026-10-09-autoscope/build.mjs
import { compile } from "sass";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../src/styles/entries");
const SCOPED = path.join(HERE, "styles-scoped/entries");
const SPLIT = path.join(HERE, "styles-split/entries");
const CLASSV = path.join(HERE, "styles-class/entries");
/** 编译成压缩 CSS（和 entries 实验的产物同口径） */
const c = (dir, name) => compile(path.join(dir, `${name}.scss`), { style: "compressed" }).css;
const outs = {
  "auto.css": c(SRC, "base") + c(SRC, "global"),
  "explicit.css": c(SRC, "explicit") + c(SRC, "global"),
  "scoped.css": c(SCOPED, "base") + c(SCOPED, "global"),
  // 诊断变体：split = tier1/tier2 也展开成两条规则（不用 :is）；class = 在 split 基础上把 skz-auto 属性换成 .skz-auto 类
  "split.css": c(SPLIT, "base") + c(SPLIT, "global"),
  "class.css": c(CLASSV, "base") + c(CLASSV, "global"),
};
const sizes = (s) => ({ raw: Buffer.byteLength(s), gzip9: zlib.gzipSync(s, { level: 9 }).length });
const report = {};
for (const [f, s] of Object.entries(outs)) { fs.writeFileSync(path.join(HERE, f), s); report[f] = sizes(s); }
// 仅基底（不含 global）的体积对比
report["auto-base-only"] = sizes(c(SRC, "base"));
report["scoped-base-only"] = sizes(c(SCOPED, "base"));
report["split-base-only"] = sizes(c(SPLIT, "base"));
report["explicit-only"] = sizes(c(SRC, "explicit"));
console.log(JSON.stringify(report, null, 1));
