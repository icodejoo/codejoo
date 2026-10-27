# picman v1 动图渐进加载 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 SW 拦截动图(GIF/APNG/动画 WebP)的三段渐进加载:色块 → 静态首帧 → 完整动画。

**Architecture:** 单包多入口:`shared/`(纯字节层,零环境依赖)→ `sw/`(依赖注入管线)→ `page/`(load/auto)→ `element/`。SW 同一响应流完成嗅探、占位、首帧截断重组、缓存;页面经 postMessage + 缓存直查对账切图。

**Tech Stack:** TypeScript 7、vite-plus(vp pack/test)、vitest、happy-dom(DOM 测试)。

**Spec:** `docs/superpowers/specs/2026-07-15-picman-animated-progressive-design.md`(状态机 S0~S6、字节算法、协议均以 spec 为准)。

## Global Constraints

- 全部 TypeScript,无 `.js` 源文件;最新语法(async/await,无 var)。
- 所有函数/方法/类/重要属性必须注释;对外 API 用 TSDoc;**注释中英双语,英文在前,空行分隔**。
- 每次 commit 前必须更新 `CHANGELOG.md`(0.2.0 Unreleased 段追加一行)。
- commit 会被全局 review gate 拦截:按提示走 `/code-review --fix` → 复查 → AskUserQuestion → `code-review-gate.ps1 -Action mark` → 重试 commit(mark 与 commit 分开两次工具调用)。
- 不新建分支,直接提交到 main。
- `shared/` 禁止 import DOM/SW 全局;`sw/` 禁止 DOM;`page/`、`element/` 禁止 SW 全局。
- 单测命令:`pnpm vitest run <file>`;全量:`pnpm test`;构建:`pnpm build`。
- 常量以 `src/shared/protocol.ts` 为唯一出处,禁止字面量散落。

---

### Task 1: 清场 + shared 基础(bytes / protocol / types)+ 多入口构建

**Files:**

- Delete: `src/index.ts`(旧 Picman 类)、`test/picman.test.ts`
- Create: `src/shared/bytes.ts`、`src/shared/protocol.ts`、`src/shared/types.ts`
- Modify: `package.json`(exports/scripts)、`vite.config.ts`;Create: `vite.sw.config.ts`
- Test: `test/bytes.test.ts`、`test/protocol.test.ts`
- Create: `CHANGELOG.md`

**Interfaces (Produces):**

- `bytes.ts`: `concatBytes(parts: Uint8Array[]): Uint8Array`、`readLE16/readLE24(buf, off): number`、`readBE32(buf, off): number`、`asciiEquals(buf, off, text): boolean`、`class ByteAccumulator { append(chunk: Uint8Array): void; get length(): number; view(): Uint8Array }`
- `protocol.ts`: `CACHE_NAME = 'picman-v1'`、`PARAM_FULL = '__picman_full__'`、`PARAM_BYPASS = '__picman_bypass__'`、`HEADER_MARK = 'X-Picman'`、`type PicmanStage = 'ff' | '1'`、`type PicmanMessage`(见 spec §6)、`stripPicmanParams(url: string): string`、`withStageParam(url: string, stage: PicmanStage): string`、`isPicmanMessage(data: unknown): data is PicmanMessage`
- `types.ts`: `PicmanSWOptions`、`PicmanAutoOptions`、`PicmanErrorContext = { url: string; stage: string; error: unknown }`、`ResolvedSWOptions = Required<...>`(spec §3 默认值)+ `resolveSWOptions(o?: PicmanSWOptions): ResolvedSWOptions`

- [ ] **Step 1: 写失败测试**

```ts
// test/bytes.test.ts
import { describe, expect, it } from "vitest";
import { ByteAccumulator, asciiEquals, concatBytes, readBE32, readLE16, readLE24 } from "../src/shared/bytes";

describe("bytes", () => {
  it("concatBytes 拼接多段", () => {
    expect([...concatBytes([new Uint8Array([1, 2]), new Uint8Array([3])])]).toEqual([1, 2, 3]);
  });
  it("readLE16/LE24/BE32", () => {
    expect(readLE16(new Uint8Array([0x34, 0x12]), 0)).toBe(0x1234);
    expect(readLE24(new Uint8Array([0x56, 0x34, 0x12]), 0)).toBe(0x123456);
    expect(readBE32(new Uint8Array([0, 0, 0x01, 0x02]), 0)).toBe(0x102);
  });
  it("asciiEquals", () => {
    expect(asciiEquals(new Uint8Array([0x47, 0x49, 0x46]), 0, "GIF")).toBe(true);
    expect(asciiEquals(new Uint8Array([0x47]), 0, "GIF")).toBe(false); // 越界 false
  });
  it("ByteAccumulator 增量累积且 view 稳定", () => {
    const acc = new ByteAccumulator();
    acc.append(new Uint8Array([1, 2]));
    acc.append(new Uint8Array([3]));
    expect(acc.length).toBe(3);
    expect([...acc.view()]).toEqual([1, 2, 3]);
  });
});
```

```ts
// test/protocol.test.ts
import { describe, expect, it } from "vitest";
import { PARAM_BYPASS, PARAM_FULL, isPicmanMessage, stripPicmanParams, withStageParam } from "../src/shared/protocol";

describe("protocol", () => {
  const base = "https://a.com/x.gif?w=1";
  it("withStageParam 追加阶段参数", () => {
    expect(withStageParam(base, "1")).toBe(`${base}&${PARAM_FULL}=1`);
  });
  it("stripPicmanParams 剥掉两类标记参数,保留业务参数", () => {
    const u = `${base}&${PARAM_FULL}=ff&${PARAM_BYPASS}=1`;
    expect(stripPicmanParams(u)).toBe(base);
    expect(stripPicmanParams(base)).toBe(base);
  });
  it("isPicmanMessage 过滤", () => {
    expect(isPicmanMessage({ picman: 1, type: "complete", url: "u" })).toBe(true);
    expect(isPicmanMessage({ type: "complete" })).toBe(false);
    expect(isPicmanMessage(null)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run test/bytes.test.ts test/protocol.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

删除 `src/index.ts`、`test/picman.test.ts`。

```ts
// src/shared/bytes.ts
/**
 * Byte-level helpers shared by all format walkers. Environment-free.
 *
 * 各格式遍历器共用的字节工具,零环境依赖。
 */

/**
 * Concatenate byte chunks into one array.
 *
 * 将多段字节拼接为一个数组。
 * @param parts - Chunks to join — 待拼接的分段
 * @returns Joined bytes — 拼接结果
 */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  // Total output length — 输出总长
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Read little-endian uint16.
 *
 * 读小端 16 位无符号整数。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Value — 数值
 */
export function readLE16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}

/**
 * Read little-endian uint24.
 *
 * 读小端 24 位无符号整数。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Value — 数值
 */
export function readLE24(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16);
}

/**
 * Read big-endian uint32.
 *
 * 读大端 32 位无符号整数。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @returns Value — 数值
 */
export function readBE32(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
}

/**
 * Compare bytes at offset against an ASCII string; false when out of range.
 *
 * 比较偏移处字节与 ASCII 串;越界返回 false。
 * @param buf - Source bytes — 源字节
 * @param off - Byte offset — 偏移
 * @param text - ASCII text — ASCII 文本
 * @returns Whether equal — 是否相等
 */
export function asciiEquals(buf: Uint8Array, off: number, text: string): boolean {
  if (off + text.length > buf.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[off + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Growable byte buffer with amortized O(1) append (doubling capacity),
 * avoiding O(n²) per-chunk concatenation while streaming.
 *
 * 容量倍增的可增长字节缓冲,append 均摊 O(1),避免流式过程中逐 chunk 拼接的 O(n²)。
 */
export class ByteAccumulator {
  // Backing store — 底层存储
  private buf = new Uint8Array(64 * 1024);

  // Bytes written — 已写入字节数
  private len = 0;

  /**
   * Append one chunk.
   *
   * 追加一段字节。
   * @param chunk - Incoming bytes — 新到字节
   */
  append(chunk: Uint8Array): void {
    if (this.len + chunk.length > this.buf.length) {
      // Grow by doubling until it fits — 倍增扩容直到装下
      let cap = this.buf.length * 2;
      while (cap < this.len + chunk.length) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
  }

  /**
   * Current byte count.
   *
   * 当前字节数。
   */
  get length(): number {
    return this.len;
  }

  /**
   * Zero-copy view of accumulated bytes (valid until next append).
   *
   * 已累积字节的零拷贝视图(下次 append 前有效)。
   * @returns Byte view — 字节视图
   */
  view(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}
```

```ts
// src/shared/protocol.ts
/**
 * SW ↔ page protocol: constants, message shapes, URL helpers.
 * Single source of truth for every cross-context literal.
 *
 * SW ↔ 页面协议:常量、消息类型、URL 工具。跨端字面量唯一出处。
 */

/** Cache Storage bucket name — Cache Storage 桶名 */
export const CACHE_NAME = "picman-v1";

/** Query param marking a stage re-request ('ff' | '1') — 二次请求阶段参数 */
export const PARAM_FULL = "__picman_full__";

/** Query param forcing network passthrough (retry) — 强制透传网络的重试参数 */
export const PARAM_BYPASS = "__picman_bypass__";

/** Response header marking picman-generated responses — picman 生成响应的标记头 */
export const HEADER_MARK = "X-Picman";

/**
 * Placeholder stage: 'ff' first frame, '1' full image.
 *
 * 占位阶段:'ff' 首帧,'1' 全图。
 */
export type PicmanStage = "ff" | "1";

/**
 * Messages posted from SW to pages.
 *
 * SW 发往页面的消息。
 */
export type PicmanMessage = { picman: 1; type: "first-frame"; url: string } | { picman: 1; type: "complete"; url: string } | { picman: 1; type: "error"; url: string; stage: "download" | "first-frame"; message: string };

/**
 * Type guard for {@link PicmanMessage}.
 *
 * {@link PicmanMessage} 的类型守卫。
 * @param data - Unknown message data — 未知消息数据
 * @returns Whether data is a picman message — 是否为 picman 消息
 * @example
 * navigator.serviceWorker.addEventListener('message', e => { if (isPicmanMessage(e.data)) ... })
 */
export function isPicmanMessage(data: unknown): data is PicmanMessage {
  return typeof data === "object" && data !== null && (data as { picman?: unknown }).picman === 1;
}

/**
 * Strip picman marker params, returning the canonical original URL.
 *
 * 剥掉 picman 标记参数,得到规范化原始 URL。
 * @param url - Absolute URL possibly carrying markers — 可能带标记的绝对 URL
 * @returns URL without picman params — 去标记后的 URL
 */
export function stripPicmanParams(url: string): string {
  const u = new URL(url);
  u.searchParams.delete(PARAM_FULL);
  u.searchParams.delete(PARAM_BYPASS);
  return u.href;
}

/**
 * Append the stage param used for the swap re-request.
 *
 * 追加切图二次请求的阶段参数。
 * @param url - Canonical original URL — 规范化原始 URL
 * @param stage - Target stage — 目标阶段
 * @returns URL with stage param — 带阶段参数的 URL
 * @example withStageParam('https://a.com/x.gif', '1')
 */
export function withStageParam(url: string, stage: PicmanStage): string {
  const u = new URL(url);
  u.searchParams.set(PARAM_FULL, stage);
  return u.href;
}
```

注意:`withStageParam` 用 `URL.searchParams.set`,测试断言按 `URLSearchParams` 序列化结果写(`&${PARAM_FULL}=1`,无编码差异——参数名只含 `_` 与字母)。

```ts
// src/shared/types.ts
/**
 * Public option/context types shared across entries.
 *
 * 各入口共享的公共配置/上下文类型。
 */

/**
 * Error context passed to onError hooks on both sides.
 *
 * 两端 onError 钩子收到的错误上下文。
 */
export interface PicmanErrorContext {
  /** Canonical image URL — 规范化图片 URL */
  url: string;

  /** Failing stage identifier — 出错阶段标识 */
  stage: string;

  /** Original error — 原始错误 */
  error: unknown;
}

/**
 * Options for the SW-side pipeline (see spec §3 for semantics/defaults).
 *
 * SW 端管线配置(语义与默认值见 spec §3)。
 */
export interface PicmanSWOptions {
  /** Big-image threshold in bytes, default 102400 — 大图阈值(字节),默认 102400 */
  threshold?: number;

  /** URL include rules — URL 包含规则 */
  include?: (string | RegExp)[];

  /** URL exclude rules — URL 排除规则 */
  exclude?: (string | RegExp)[];

  /** Color block style, default 'gradient' — 色块样式,默认 'gradient' */
  colorBlock?: "solid" | "gradient";

  /** Fallback color when no palette, default '#e0e0e0' — 无调色板底色,默认 '#e0e0e0' */
  fallbackColor?: string;

  /** First-frame style, default 'sharp' — 首帧样式,默认 'sharp' */
  firstFrame?: "sharp" | "blur";

  /** Blur radius px for firstFrame:'blur', default 12 — blur 模糊半径,默认 12 */
  blurRadius?: number;

  /** Min head bytes before sniffing, default 4096 — 嗅探前最小头部字节,默认 4096 */
  headBytes?: number;

  /** Max bytes to wait for first frame, default 524288 — 首帧最大等待字节,默认 524288 */
  firstFrameMaxBytes?: number;

  /** Cache tuning — 缓存配置 */
  cache?: { name?: string; maxEntries?: number; maxAgeSeconds?: number };

  /** Error hook — 错误钩子 */
  onError?: (ctx: PicmanErrorContext) => void;
}

/**
 * Options for page-side auto takeover.
 *
 * 页面端零改造接管配置。
 */
export interface PicmanAutoOptions {
  /** Scan root, default document — 扫描根节点,默认 document */
  root?: ParentNode;

  /** Take over CSS backgrounds too, default true — 是否接管 CSS 背景,默认 true */
  backgrounds?: boolean;

  /** Error hook — 错误钩子 */
  onError?: (ctx: PicmanErrorContext) => void;
}

/**
 * Fully-resolved SW options with all defaults applied.
 *
 * 应用全部默认值后的 SW 配置。
 */
export type ResolvedSWOptions = Required<Omit<PicmanSWOptions, "cache" | "onError">> & {
  /** Resolved cache tuning — 已解析缓存配置 */
  cache: Required<NonNullable<PicmanSWOptions["cache"]>>;

  /** Error hook (noop by default) — 错误钩子(默认空实现) */
  onError: (ctx: PicmanErrorContext) => void;
};

/**
 * Apply spec §3 defaults.
 *
 * 应用 spec §3 默认值。
 * @param o - User options — 用户配置
 * @returns Resolved options — 解析后的配置
 */
export function resolveSWOptions(o: PicmanSWOptions = {}): ResolvedSWOptions {
  return {
    threshold: o.threshold ?? 102400,
    include: o.include ?? [/\.(gif|png|apng|webp)(\?|$)/i],
    exclude: o.exclude ?? [],
    colorBlock: o.colorBlock ?? "gradient",
    fallbackColor: o.fallbackColor ?? "#e0e0e0",
    firstFrame: o.firstFrame ?? "sharp",
    blurRadius: o.blurRadius ?? 12,
    headBytes: o.headBytes ?? 4096,
    firstFrameMaxBytes: o.firstFrameMaxBytes ?? 512 * 1024,
    cache: {
      name: o.cache?.name ?? "picman-v1",
      maxEntries: o.cache?.maxEntries ?? 200,
      maxAgeSeconds: o.cache?.maxAgeSeconds ?? 7 * 86400,
    },
    onError: o.onError ?? (() => {}),
  };
}
```

`package.json` 改动(scripts 不变,新增 exports/build):

```jsonc
{
  "main": "./dist/esm/index.mjs",
  "module": "./dist/esm/index.mjs",
  "types": "./dist/esm/index.d.mts",
  "exports": {
    ".": { "types": "./dist/esm/index.d.mts", "import": "./dist/esm/index.mjs", "default": "./dist/esm/index.mjs" },
    "./sw": { "types": "./dist/esm/sw.d.mts", "import": "./dist/esm/sw.mjs" },
    "./element": { "types": "./dist/esm/element.d.mts", "import": "./dist/esm/element.mjs" },
    "./shared": { "types": "./dist/esm/shared.d.mts", "import": "./dist/esm/shared.mjs" },
    "./picman-sw.js": "./dist/picman-sw.js",
    "./package.json": "./package.json",
  },
  "scripts": { "build": "vp pack && vp pack -c vite.sw.config.ts" },
}
```

`vite.config.ts` 多入口(vite-plus pack 支持对象 entry;若 `pnpm build` 报不支持,退回数组 `["src/index.ts","src/sw.ts","src/element.ts","src/shared.ts"]` 并在 src 根建同名转发文件):

```ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      sw: "src/sw.ts",
      element: "src/element.ts",
      shared: "src/shared.ts",
    },
    format: "esm",
    platform: "browser",
    target: "es2022",
    outDir: "dist/esm",
    fixedExtension: true,
    dts: { tsgo: true },
    clean: true,
  },
});
```

```ts
// vite.sw.config.ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: { "picman-sw": "src/sw-standalone.ts" },
    format: "esm",
    platform: "browser",
    target: "es2022",
    outDir: "dist",
    fixedExtension: false,
    dts: false,
    clean: false,
  },
});
```

同时建 4 个入口转发文件(先占位,后续任务填充导出;本任务先只导 shared,其余空导出防构建失败):

```ts
// src/shared.ts
export * from "./shared/bytes";
export * from "./shared/protocol";
export * from "./shared/types";
```

```ts
// src/index.ts — 页面主入口,Task 10/11 填充
export {};
```

```ts
// src/sw.ts — SW 入口,Task 9 填充
export {};
```

```ts
// src/element.ts — Web Component 入口,Task 12 填充
export {};
```

```ts
// src/sw-standalone.ts — 托管成品,Task 9 填充
export {};
```

`CHANGELOG.md` 新建:

```markdown
# Changelog

## 0.2.0 (Unreleased)

- 重构:移除 0.1.0 的内存元数据管理器(Picman 类),转型 SW 动图渐进加载库
- 新增:shared 基础层(bytes/protocol/types)与多入口构建配置
```

- [ ] **Step 4: 跑测试通过 + 构建通过**

Run: `pnpm vitest run test/bytes.test.ts test/protocol.test.ts` → PASS(全绿)
Run: `pnpm build` → dist/esm 产出 4 入口 + dist/picman-sw.js(空导出也应成功;entry 对象不支持则按上述退回方案改)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: replace metadata manager with progressive-loading scaffold (shared layer + multi-entry build)"
```

（被 gate 拦截则按 Global Constraints 的 review 流程走,下同,不再重复。）

---

### Task 2: 测试 fixtures(程序化生成微型动图)

**Files:**

- Create: `test/fixtures.ts`
- Test: `test/fixtures.test.ts`

**Interfaces (Produces):**

- `crc32(bytes: Uint8Array): number`
- `pngChunk(type: string, data: Uint8Array): Uint8Array`(len+type+data+CRC)
- `makeGif(opts: { frames: number; loop?: boolean; width?: number; height?: number }): Uint8Array` — 含 GCT(4 色)、可选 Netscape 循环扩展、每帧 GCE+ImageDescriptor+伪 LZW 数据(结构合法即可,不要求可解码)
- `makeApng(opts: { animated: boolean }): Uint8Array` — sig+IHDR(+acTL+fcTL)+PLTE+IDAT×2+(fdAT)+IEND
- `makeWebp(opts: { animated: boolean; alpha?: boolean }): Uint8Array` — RIFF+VP8X(+ANIM+ANMF[VP8/VP8L(+ALPH)])或简单格式

**要点(实现按此写):**

- GIF:头 `GIF89a`;LSD 宽高 LE;packed `0x91`(GCT 存在,4 色→大小位 1);GCT 12 字节取 4 个显眼色(`#000/#fff/#f00/#0f0`);loop 时插 `21 FF 0B "NETSCAPE2.0" 03 01 00 00 00`;每帧:GCE `21 F9 04 00 00 00 00 00` + `2C` + 9B 描述符(无 LCT)+ LZW 最小码 `02` + 1 个数据子块(长 4,内容任意)+ `00` 终止;尾 `3B`。
- APNG:`pngChunk` CRC 覆盖 type+data;IHDR 宽高 BE 2×2、bitDepth 8、colorType 3;acTL data = numFrames+numPlays 各 4B BE;fcTL 26B 数据;IDAT data 任意 4B;fdAT = 序号 4B+任意数据。
- WebP:VP8X data 10B(flags 动画 `0x02`/alpha `0x10`;canvas 24bit LE 存 实际-1);ANIM 6B;ANMF data = 16B 帧头(x,y=0;w-1,h-1 各 3B;duration 3B;flags 1B)+ 子 chunk(`VP8 `/`VP8L`,data 任意偶数长;alpha 时前置 `ALPH`);RIFF size = 文件长-8(LE32);奇数补 0。

- [ ] **Step 1: 写测试**

```ts
// test/fixtures.test.ts
import { describe, expect, it } from "vitest";
import { crc32, makeApng, makeGif, makeWebp } from "./fixtures";
import { asciiEquals, readBE32 } from "../src/shared/bytes";

describe("fixtures", () => {
  it("crc32 已知值:CRC32('IEND') = 0xAE426082", () => {
    expect(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44]))).toBe(0xae426082);
  });
  it("makeGif 签名/尾字节", () => {
    const g = makeGif({ frames: 2, loop: true });
    expect(asciiEquals(g, 0, "GIF89a")).toBe(true);
    expect(g[g.length - 1]).toBe(0x3b);
  });
  it("makeApng 动画含 acTL,静态不含,IEND 存在", () => {
    const has = (b: Uint8Array, t: string) => {
      for (let i = 8; i + 8 <= b.length; ) {
        const len = readBE32(b, i);
        if (asciiEquals(b, i + 4, t)) return true;
        i += 12 + len;
      }
      return false;
    };
    expect(has(makeApng({ animated: true }), "acTL")).toBe(true);
    expect(has(makeApng({ animated: false }), "acTL")).toBe(false);
    expect(has(makeApng({ animated: true }), "IEND")).toBe(true);
  });
  it("makeWebp RIFF size 与总长一致", () => {
    for (const w of [makeWebp({ animated: true }), makeWebp({ animated: false }), makeWebp({ animated: true, alpha: true })]) {
      expect(asciiEquals(w, 0, "RIFF")).toBe(true);
      expect(asciiEquals(w, 8, "WEBP")).toBe(true);
      const size = w[4]! | (w[5]! << 8) | (w[6]! << 16) | (w[7]! << 24);
      expect(size).toBe(w.length - 8);
    }
  });
});
```

- [ ] **Step 2: 实现 `test/fixtures.ts`**(crc32 标准查表法,多项式 0xEDB88320;全部函数双语注释)
- [ ] **Step 3: 跑通过** — `pnpm vitest run test/fixtures.test.ts` → PASS
- [ ] **Step 4: Commit**

```bash
git add test/fixtures.ts test/fixtures.test.ts CHANGELOG.md
git commit -m "test: add programmatic minimal animated-image fixtures (gif/apng/webp)"
```

---

### Task 3: GIF walker

**Files:**

- Create: `src/shared/walkers/gif.ts`
- Test: `test/gif.test.ts`

**Interfaces (Produces):**

```ts
export interface GifScan {
  status: "need-more" | "static" | "animated";
  width?: number;
  height?: number;
  palette?: [number, number, number][]; // GCT 颜色,无 GCT 为 undefined
  firstFrameEnd?: number; // 首帧末字节的下一索引(含 0x00 终止符)
}
export function scanGif(buf: Uint8Array): GifScan;
export function gifFirstFrame(buf: Uint8Array, firstFrameEnd: number): Uint8Array; // slice(0,end)+0x3B
```

**算法(spec §5.2 补充):**

- `<13` 字节 → need-more;签名不符 → 'static'(防御,上游不会送错)。
- 宽 `readLE16(buf,6)` 高 `readLE16(buf,8)`;packed=buf[10],GCT 大小 `packed&0x80 ? 3*2**((packed&7)+1) : 0`;GCT 未收齐 → need-more。
- 游标三分支:`0x3B` → 返回最终态;`0x21` 扩展(label 0xFF 且首子块长≥11 且 `asciiEquals(buf,q+1,"NETSCAPE")` → animated)走子块串;`0x2C` 第 2 次出现 → animated,首帧子块串走完 → firstFrameEnd。任何推进不动的点 → need-more(带已知字段)。`animated && firstFrameEnd` 可提前返回。未知块字节 → 'static'。
- status 与 firstFrameEnd 独立:'animated' 时 firstFrameEnd 可能仍 undefined,调用方继续喂。
- 子块串走法抽 `walkSubBlocks(buf, q): number`(返回终止符后索引,-1 = 数据不足)。

- [ ] **Step 1: 写失败测试**

```ts
// test/gif.test.ts
import { describe, expect, it } from "vitest";
import { gifFirstFrame, scanGif } from "../src/shared/walkers/gif";
import { makeGif } from "./fixtures";

describe("scanGif", () => {
  it("循环动图 + 宽高 + 调色板", () => {
    const r = scanGif(makeGif({ frames: 2, loop: true, width: 3, height: 2 }));
    expect(r.status).toBe("animated");
    expect(r.width).toBe(3);
    expect(r.height).toBe(2);
    expect(r.palette).toHaveLength(4);
    expect(r.firstFrameEnd).toBeGreaterThan(13);
  });
  it("无 Netscape 两帧 → 动图;单帧 → 静图", () => {
    expect(scanGif(makeGif({ frames: 2, loop: false })).status).toBe("animated");
    expect(scanGif(makeGif({ frames: 1, loop: false })).status).toBe("static");
  });
  it("增量 1 字节喂:无异常,最终结论一致", () => {
    const g = makeGif({ frames: 2, loop: true });
    let last = scanGif(g.subarray(0, 1));
    for (let n = 2; n <= g.length; n++) last = scanGif(g.subarray(0, n));
    expect(last.status).toBe("animated");
    expect(last.firstFrameEnd).toBeDefined();
  });
  it("gifFirstFrame 产物尾 0x3B 且自身判静图", () => {
    const g = makeGif({ frames: 3, loop: true });
    const ff = gifFirstFrame(g, scanGif(g).firstFrameEnd!);
    expect(ff[ff.length - 1]).toBe(0x3b);
    expect(scanGif(ff).status).toBe("static");
  });
});
```

- [ ] **Step 2: 跑失败** — `pnpm vitest run test/gif.test.ts` → FAIL
- [ ] **Step 3: 实现 `gif.ts`**(双语注释)
- [ ] **Step 4: 跑通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/shared/walkers/gif.ts test/gif.test.ts CHANGELOG.md
git commit -m "feat: GIF walker - incremental scan, animation detection, first-frame recompose"
```

---

### Task 4: APNG walker

**Files:**

- Create: `src/shared/walkers/apng.ts`
- Test: `test/apng.test.ts`

**Interfaces (Produces):**

```ts
export interface PngScan {
  status: "need-more" | "static" | "animated";
  width?: number;
  height?: number;
  palette?: [number, number, number][];
  firstFrameReady?: boolean; // IDAT 连段结束(其后出现完整 chunk 头)
}
export function scanPng(buf: Uint8Array): PngScan;
export function apngFirstFrame(buf: Uint8Array): Uint8Array; // 前置:firstFrameReady
export const IEND_BYTES: Uint8Array; // 00 00 00 00 49 45 4E 44 AE 42 60 82
```

**算法(spec §5.3):** 签名 8B → chunk 循环(`p+8` 读 len/type,`p+12+len` 才完整);IHDR 宽 `readBE32(buf,16)` 高 `readBE32(buf,20)`;PLTE → palette;IDAT 前见 acTL → animated;先见 IDAT 无 acTL → static;firstFrameReady = 见过完整 IDAT 且其后有非 IDAT chunk 头。`apngFirstFrame` = 签名 + IDAT 前 chunk(剔 acTL/fcTL/fdAT)+ 连续 IDAT + IEND_BYTES。

- [ ] **Step 1: 写失败测试**

```ts
// test/apng.test.ts
import { describe, expect, it } from "vitest";
import { apngFirstFrame, scanPng } from "../src/shared/walkers/apng";
import { makeApng } from "./fixtures";
import { asciiEquals, readBE32 } from "../src/shared/bytes";

const chunkTypes = (b: Uint8Array): string[] => {
  const out: string[] = [];
  for (let i = 8; i + 8 <= b.length; ) {
    const len = readBE32(b, i);
    out.push(String.fromCharCode(...b.subarray(i + 4, i + 8)));
    i += 12 + len;
  }
  return out;
};

describe("scanPng / apngFirstFrame", () => {
  it("acTL → animated;无 → static", () => {
    expect(scanPng(makeApng({ animated: true })).status).toBe("animated");
    expect(scanPng(makeApng({ animated: false })).status).toBe("static");
  });
  it("增量喂:最终 animated 且 firstFrameReady", () => {
    const a = makeApng({ animated: true });
    let last = scanPng(a.subarray(0, 1));
    for (let n = 2; n <= a.length; n++) last = scanPng(a.subarray(0, n));
    expect(last.status).toBe("animated");
    expect(last.firstFrameReady).toBe(true);
  });
  it("重组产物无动画 chunk、IEND 收尾、判静图", () => {
    const ff = apngFirstFrame(makeApng({ animated: true }));
    expect(ff[0]).toBe(0x89);
    expect(asciiEquals(ff, 1, "PNG")).toBe(true);
    const types = chunkTypes(ff);
    expect(types).not.toContain("acTL");
    expect(types).not.toContain("fcTL");
    expect(types).not.toContain("fdAT");
    expect(types[types.length - 1]).toBe("IEND");
    expect(types).toContain("IDAT");
    expect(scanPng(ff).status).toBe("static");
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现 `apng.ts`**(双语注释)
- [ ] **Step 4: 跑通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/shared/walkers/apng.ts test/apng.test.ts CHANGELOG.md
git commit -m "feat: APNG walker - acTL detection, default-image first-frame recompose"
```

---

### Task 5: WebP walker(尝试档)

**Files:**

- Create: `src/shared/walkers/webp.ts`
- Test: `test/webp.test.ts`

**Interfaces (Produces):**

```ts
export interface WebpScan {
  status: "need-more" | "static" | "animated";
  width?: number;
  height?: number;
  anmf?: [number, number]; // 首个完整 ANMF chunk 的 [start,end),含 8B 头与补齐
}
export function scanWebp(buf: Uint8Array): WebpScan;
export function webpFirstFrame(buf: Uint8Array, anmf: [number, number]): Uint8Array | null; // null=结构不符
```

**算法(spec §5.4):** 头 12B `RIFF`+`WEBP`;chunk 循环 fourcc+sizeLE32+data+奇数补 1;首 chunk `VP8 `/`VP8L` → static;`VP8X` data≥10 后 flags=data[0],无 `0x02` → static,有 → animated,宽 `1+readLE24(d,4)` 高 `1+readLE24(d,7)`,继续找首个完整 ANMF。`webpFirstFrame`:ANMF data 16B 帧头(帧宽 `1+readLE24(d,6)` 帧高 `1+readLE24(d,9)`)后子 chunk;无 ALPH → 简单格式 RIFF+WEBP+位流 chunk;有 ALPH → VP8X(flags=0x10,canvas=帧宽高-1)+ALPH+VP8;RIFF size 重算;异常 → null。

- [ ] **Step 1: 写失败测试**

```ts
// test/webp.test.ts
import { describe, expect, it } from "vitest";
import { scanWebp, webpFirstFrame } from "../src/shared/walkers/webp";
import { makeWebp } from "./fixtures";
import { asciiEquals } from "../src/shared/bytes";

describe("scanWebp / webpFirstFrame", () => {
  it("VP8X 动画位判定", () => {
    expect(scanWebp(makeWebp({ animated: true })).status).toBe("animated");
    expect(scanWebp(makeWebp({ animated: false })).status).toBe("static");
  });
  it("增量喂:最终拿到 anmf 区间", () => {
    const w = makeWebp({ animated: true });
    let last = scanWebp(w.subarray(0, 1));
    for (let n = 2; n <= w.length; n++) last = scanWebp(w.subarray(0, n));
    expect(last.anmf).toBeDefined();
  });
  it("重打包:RIFF size 正确、判静图;alpha 走 VP8X 路径", () => {
    for (const alpha of [false, true]) {
      const w = makeWebp({ animated: true, alpha });
      const ff = webpFirstFrame(w, scanWebp(w).anmf!)!;
      expect(asciiEquals(ff, 0, "RIFF")).toBe(true);
      const size = ff[4]! | (ff[5]! << 8) | (ff[6]! << 16) | (ff[7]! << 24);
      expect(size).toBe(ff.length - 8);
      expect(asciiEquals(ff, 12, "VP8X")).toBe(alpha);
      expect(scanWebp(ff).status).toBe("static");
    }
  });
  it("结构不符返回 null", () => {
    expect(webpFirstFrame(new Uint8Array(30), [0, 30])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现 `webp.ts`**(双语注释)
- [ ] **Step 4: 跑通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/shared/walkers/webp.ts test/webp.test.ts CHANGELOG.md
git commit -m "feat: animated WebP walker - VP8X detection, first-frame repack (best-effort)"
```

---

### Task 6: 嗅探统一入口 sniff.ts

**Files:**

- Create: `src/shared/sniff.ts`
- Modify: `src/shared.ts`(追加 sniff 与三 walker 导出)
- Test: `test/sniff.test.ts`

**Interfaces (Produces):**

```ts
export type SniffFormat = "gif" | "apng" | "webp";
export interface SniffResult {
  status: "need-more" | "static" | "animated";
  format?: SniffFormat;
  width?: number;
  height?: number;
  palette?: [number, number, number][];
  gifFirstFrameEnd?: number;
  apngFirstFrameReady?: boolean;
  webpAnmf?: [number, number];
  mime?: "image/gif" | "image/png" | "image/webp";
}
export function sniff(buf: Uint8Array): SniffResult;
```

**逻辑:** 魔数分派——`GIF8`→scanGif;`\x89PNG`→scanPng;`RIFF..WEBP`→scanWebp;12 字节都对不上 → 'static';不足 12 字节 → need-more。walker 结果映射进统一结构,mime 按格式。

- [ ] **Step 1: 写失败测试**

```ts
// test/sniff.test.ts
import { describe, expect, it } from "vitest";
import { sniff } from "../src/shared/sniff";
import { makeApng, makeGif, makeWebp } from "./fixtures";

describe("sniff", () => {
  it("三格式动图识别 + mime", () => {
    expect(sniff(makeGif({ frames: 2, loop: true }))).toMatchObject({ status: "animated", format: "gif", mime: "image/gif" });
    expect(sniff(makeApng({ animated: true }))).toMatchObject({ status: "animated", format: "apng", mime: "image/png" });
    expect(sniff(makeWebp({ animated: true }))).toMatchObject({ status: "animated", format: "webp", mime: "image/webp" });
  });
  it("静图/未知容器(JPEG 魔数)→ static", () => {
    expect(sniff(makeGif({ frames: 1 })).status).toBe("static");
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])).status).toBe("static");
  });
  it("不足 12 字节 → need-more", () => {
    expect(sniff(new Uint8Array([0x47])).status).toBe("need-more");
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现 + 更新 `src/shared.ts` 导出**
- [ ] **Step 4: 跑通过 + 全量 `pnpm test` 无回归**
- [ ] **Step 5: Commit**

```bash
git add src/shared/sniff.ts src/shared.ts test/sniff.test.ts CHANGELOG.md
git commit -m "feat: unified magic-byte sniffer dispatching to format walkers"
```

---

### Task 7: 占位生成 placeholder.ts(SVG 色块 + 首帧位图)

**Files:**

- Create: `src/sw/placeholder.ts`
- Test: `test/placeholder.test.ts`

**Interfaces (Produces):**

```ts
/** 色块入参 */
export interface ColorBlockInput {
  width: number;
  height: number;
  palette?: [number, number, number][];
  mode: "solid" | "gradient";
  fallbackColor: string;
}
/** 生成 SVG 字符串(零 canvas 依赖) */
export function svgColorBlock(input: ColorBlockInput): string;

/** 位图解码/绘制依赖(可注入,node 测试用 mock) */
export interface BitmapDeps {
  decode: (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>; // createImageBitmap
  createCanvas: (
    w: number,
    h: number,
  ) => {
    getContext(id: "2d"): { filter: string; drawImage(img: unknown, x: number, y: number, w: number, h: number): void } | null;
    convertToBlob(opts?: { type?: string }): Promise<Blob>;
  }; // OffscreenCanvas 工厂
}
/** 首帧字节 → 占位 PNG Blob;解码失败返回 null */
export function makeFirstFramePlaceholder(bytes: Uint8Array, mime: string, opts: { firstFrame: "sharp" | "blur"; blurRadius: number }, deps: BitmapDeps): Promise<Blob | null>;
```

**实现要点:**

- `svgColorBlock`:
  - 颜色计算:palette 有值 → 平均色 `avg`;明暗两端 = 按亮度 `0.299r+0.587g+0.114b` 排序取 P10/P90 两色;无 palette → fallbackColor(gradient 时用 fallback 的 ±8% 亮度微调两端,直接字符串处理 hex)。
  - solid:`<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H"><rect width="100%" height="100%" fill="COLOR"/></svg>`
  - gradient:`<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` 两 stop(亮上暗下)+ rect fill url(#g)。
  - 内部辅助 `rgbHex([r,g,b]): string`、`luminance`、`avgColor`、`lightDark`,全部导出供测试。
- `makeFirstFramePlaceholder`:`decode` reject → 返回 null(不抛);缩放:长边 >512 等比缩到 512;blur 模式设 `ctx.filter = 'blur(Npx)'`;`convertToBlob({type:'image/png'})`;canvas/ctx 为 null → null。

- [ ] **Step 1: 写失败测试**

```ts
// test/placeholder.test.ts
import { describe, expect, it, vi } from "vitest";
import { avgColor, lightDark, makeFirstFramePlaceholder, rgbHex, svgColorBlock } from "../src/sw/placeholder";

describe("svgColorBlock", () => {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
  ];
  it("solid 用平均色", () => {
    const svg = svgColorBlock({ width: 4, height: 3, palette, mode: "solid", fallbackColor: "#e0e0e0" });
    expect(svg).toContain(`fill="${rgbHex(avgColor(palette))}"`);
    expect(svg).toContain('width="4"');
    expect(svg).toContain('viewBox="0 0 4 3"');
  });
  it("gradient 有两个 stop,亮色在前", () => {
    const svg = svgColorBlock({ width: 4, height: 3, palette, mode: "gradient", fallbackColor: "#e0e0e0" });
    const [light, dark] = lightDark(palette);
    expect(svg).toContain(rgbHex(light));
    expect(svg).toContain(rgbHex(dark));
    expect(svg.indexOf(rgbHex(light))).toBeLessThan(svg.indexOf(rgbHex(dark)));
  });
  it("无 palette 回退 fallbackColor", () => {
    expect(svgColorBlock({ width: 1, height: 1, mode: "solid", fallbackColor: "#123456" })).toContain("#123456");
  });
});

describe("makeFirstFramePlaceholder", () => {
  const okDeps = () => {
    const ctx = { filter: "", drawImage: vi.fn() };
    const canvas = { getContext: () => ctx, convertToBlob: vi.fn().mockResolvedValue(new Blob(["png"])) };
    return { ctx, deps: { decode: vi.fn().mockResolvedValue({ width: 1024, height: 512 }), createCanvas: vi.fn().mockReturnValue(canvas) } };
  };
  it("sharp:长边 1024 缩到 512,不设 blur", async () => {
    const { ctx, deps } = okDeps();
    const blob = await makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "sharp", blurRadius: 12 }, deps);
    expect(blob).not.toBeNull();
    expect(deps.createCanvas).toHaveBeenCalledWith(512, 256);
    expect(ctx.filter).toBe("");
  });
  it("blur:设置 blur filter", async () => {
    const { ctx, deps } = okDeps();
    await makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "blur", blurRadius: 12 }, deps);
    expect(ctx.filter).toBe("blur(12px)");
  });
  it("decode 失败返回 null 不抛", async () => {
    const { deps } = okDeps();
    deps.decode = vi.fn().mockRejectedValue(new Error("bad"));
    await expect(makeFirstFramePlaceholder(new Uint8Array([1]), "image/gif", { firstFrame: "sharp", blurRadius: 12 }, deps)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现 `placeholder.ts`**(双语注释;TSDoc 完整——这是 sw 内部但被 pipeline 消费)
- [ ] **Step 4: 跑通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/sw/placeholder.ts test/placeholder.test.ts CHANGELOG.md
git commit -m "feat: placeholder synthesis - SVG color block and first-frame bitmap"
```

---

### Task 8: 缓存层 cache.ts(LRU)

**Files:**

- Create: `src/sw/cache.ts`
- Test: `test/cache.test.ts`

**Interfaces (Produces):**

```ts
/** pipeline 消费的最小缓存接口 */
export interface PicmanCacheLike {
  matchStage(url: string, stage: PicmanStage): Promise<Response | undefined>;
  putStage(url: string, stage: PicmanStage, resp: Response): Promise<boolean>; // false=配额等失败
  deleteUrl(url: string): Promise<void>; // 成对删两阶段
}
export class PicmanCache implements PicmanCacheLike {
  constructor(
    opts: { name: string; maxEntries: number; maxAgeSeconds: number },
    cachesImpl: CacheStorage,
    now?: () => number, // 默认 Date.now,测试注入
  );
}
```

**实现要点:**

- 缓存 key = `new Request(withStageParam(url, stage))` —— 与页面二次请求 URL 完全一致,S6 直接 `cache.match(event.request.url)` 命中。
- LRU 索引:特殊条目 `https://picman.internal/__index__`,内容 JSON `{ [url]: { ts: number } }`;putStage('1') 与 matchStage 命中时更新 ts 并回写;`maxEntries` 超限或 `ts` 过期(maxAgeSeconds)→ 驱逐最旧,`deleteUrl` 成对删 'ff'+'1' 两个 key。索引只记全图 url,ff 条目跟随全图生命周期。
- putStage 内部 try/catch:`cache.put` 抛(配额)→ 驱逐一半条目(按 ts 升序删前 half)重试一次;再失败 return false。
- 全程不留未 catch 的 promise。

- [ ] **Step 1: 写失败测试(内存 mock CacheStorage)**

```ts
// test/cache.test.ts
import { describe, expect, it } from "vitest";
import { PicmanCache } from "../src/sw/cache";
import { withStageParam } from "../src/shared/protocol";

/** 极简内存 CacheStorage mock — 只实现用到的 open/put/match/delete/keys */
function memCaches(failPuts = 0): CacheStorage {
  const store = new Map<string, Response>();
  let fails = failPuts;
  const cache = {
    async put(req: Request | string, resp: Response) {
      if (fails > 0) {
        fails--;
        throw new DOMException("quota", "QuotaExceededError");
      }
      store.set(typeof req === "string" ? req : req.url, resp);
    },
    async match(req: Request | string) {
      return store.get(typeof req === "string" ? req : (req as Request).url);
    },
    async delete(req: Request | string) {
      return store.delete(typeof req === "string" ? req : (req as Request).url);
    },
    async keys() {
      return [...store.keys()].map((u) => new Request(u));
    },
  };
  return { open: async () => cache as unknown as Cache } as unknown as CacheStorage;
}

const opts = { name: "t", maxEntries: 2, maxAgeSeconds: 100 };
const URL1 = "https://a.com/1.gif";
const URL2 = "https://a.com/2.gif";
const URL3 = "https://a.com/3.gif";

describe("PicmanCache", () => {
  it("put 后 match 命中,key 与二次请求 URL 一致", async () => {
    const c = new PicmanCache(opts, memCaches(), () => 1000);
    expect(await c.putStage(URL1, "1", new Response("full"))).toBe(true);
    const hit = await c.matchStage(URL1, "1");
    expect(hit).toBeDefined();
    expect(await hit!.text()).toBe("full");
  });
  it("超 maxEntries 驱逐最旧,ff 成对删", async () => {
    let t = 0;
    const c = new PicmanCache(opts, memCaches(), () => ++t);
    await c.putStage(URL1, "ff", new Response("f1"));
    await c.putStage(URL1, "1", new Response("1"));
    await c.putStage(URL2, "1", new Response("2"));
    await c.putStage(URL3, "1", new Response("3")); // 挤掉 URL1
    expect(await c.matchStage(URL1, "1")).toBeUndefined();
    expect(await c.matchStage(URL1, "ff")).toBeUndefined();
    expect(await c.matchStage(URL3, "1")).toBeDefined();
  });
  it("过期条目 match 不命中", async () => {
    let now = 1000;
    const c = new PicmanCache(opts, memCaches(), () => now);
    await c.putStage(URL1, "1", new Response("x"));
    now += 101 * 1000;
    expect(await c.matchStage(URL1, "1")).toBeUndefined();
  });
  it("put 持续失败返回 false 不抛", async () => {
    const c = new PicmanCache(opts, memCaches(99), () => 1);
    expect(await c.putStage(URL1, "1", new Response("x"))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现 `cache.ts`**(双语注释;索引读写抽私有 `loadIndex/saveIndex`)
- [ ] **Step 4: 跑通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/sw/cache.ts test/cache.test.ts CHANGELOG.md
git commit -m "feat: cache layer - stage-keyed Cache Storage with LRU eviction"
```

---

### Task 9: SW 管线 pipeline.ts + 装配 sw.ts / sw-standalone.ts

**Files:**

- Create: `src/sw/pipeline.ts`、`src/sw/index.ts`
- Modify: `src/sw.ts`(`export * from "./sw/index"`)、`src/sw-standalone.ts`
- Test: `test/pipeline.test.ts`

**Interfaces (Produces):**

```ts
// pipeline.ts
export interface PipelineDeps {
  fetchImpl: typeof fetch;
  cache: PicmanCacheLike;
  notify: (msg: PicmanMessage) => void;
  /** 首帧字节 → 占位 PNG Blob;环境不支持/失败 → null */
  makeFirstFrame: (bytes: Uint8Array, mime: string) => Promise<Blob | null>;
  waitUntil: (p: Promise<unknown>) => void;
  options: ResolvedSWOptions;
}
/** 同步预判:该请求是否交给 picman 处理(fetch handler 里同步调用) */
export function shouldIntercept(request: Request, options: ResolvedSWOptions): boolean;
/** 异步处理:shouldIntercept 为 true 后 respondWith 本函数结果 */
export function handleImageRequest(request: Request, deps: PipelineDeps): Promise<Response>;

// sw/index.ts
export function setupPicman(options?: PicmanSWOptions): void; // 挂 install/activate/fetch,组装真实 deps
```

**pipeline 实现(spec §4 状态机逐条落):**

1. **shouldIntercept(同步)**:`request.method !== 'GET'` 或 `request.destination !== 'image'` → false;URL 带 `PARAM_FULL`/`PARAM_BYPASS` → true(内部处理);exclude 命中 → false;include(string 用 `url.includes`,RegExp 用 `.test`)不命中 → false;命中 → true。
2. **handleImageRequest 最外层 try/catch**:任何异常 → `options.onError` + `fetchImpl(request)` 透传,**绝不向外抛**。
3. PARAM_BYPASS → `fetchImpl(stripPicmanParams(url))`。
4. PARAM_FULL → `cache.matchStage(strip, stage)` 命中回缓存;未命中 → `fetchImpl(strip)`。
5. 主流程:`resp = await fetchImpl(request)`;`!resp.ok || resp.type === 'opaque' || !resp.body` → 原样返回;`Content-Length` 存在且 `< threshold` → 原样返回。
6. **流式判定循环**:`reader = resp.body.getReader()`,`acc = new ByteAccumulator()`;循环 read:
   - 无 CL 且流结束且 `acc.length < threshold` → `new Response(acc.view().slice(), { status, headers })`(小图)。
   - `acc.length >= headBytes`(或流结束)→ `sniff(acc.view())`:
     - `'static'` → **透传重组**:`new Response(concatStream(acc, reader), { headers })` —— `concatStream` 用 `ReadableStream`,先 enqueue 已缓冲字节再 pipe 余下 reader。
     - `'need-more'` 且流未结束 → 继续读;流结束仍 need-more → 拼 buffer 原样返回。
     - `'animated'` 且 width/height 已知 → 进 7。
7. **色块响应 + 后台续下**:`svg = svgColorBlock(...)`;`waitUntil(background(...))`;返回 `new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', [HEADER_MARK]: 'placeholder' } })`。
8. **background(reader, acc, sniffState, url)**:
   - 循环续读,每 chunk 后若首帧未产出且 `acc.length <= firstFrameMaxBytes`:重新 `sniff(acc.view())` 取首帧就绪信息,就绪则按格式重组(`gifFirstFrame`/`apngFirstFrame`/`webpFirstFrame`),`makeFirstFrame(bytes, mime)` 成功 → `cache.putStage(url,'ff', pngResponse)` + `notify({type:'first-frame',url})`;失败 → onError + 不再尝试。
   - 流结束:`cache.putStage(url,'1', new Response(acc 完整字节, { headers: 原响应头 }))`;失败仍 `notify complete`(spec:二次请求走网络);成功也 notify。
   - 读流抛错 → `notify({type:'error',url,stage:'download',...})` + onError。
9. **in-flight 去重**:模块级 `Map<string, Promise<Response>>`(key = strip 后 url);主流程进入前查表,存在 → `(await it).clone()`;进入时放入,`finally` 删除。

**sw/index.ts 装配:**

```ts
setupPicman(options) {
  const o = resolveSWOptions(options);
  const cache = new PicmanCache(o.cache, caches);
  const scope = self as unknown as ServiceWorkerGlobalScope;
  scope.addEventListener("install", () => scope.skipWaiting());
  scope.addEventListener("activate", e => e.waitUntil(scope.clients.claim()));
  scope.addEventListener("fetch", e => {
    if (!shouldIntercept(e.request, o)) return;
    e.respondWith(handleImageRequest(e.request, {
      fetchImpl: fetch.bind(scope),
      cache,
      notify: msg => scope.clients.matchAll({ type: "window" }).then(cs => cs.forEach(c => c.postMessage(msg))),
      makeFirstFrame: (bytes, mime) =>
        typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined"
          ? Promise.resolve(null)
          : makeFirstFramePlaceholder(bytes, mime, o, { decode: b => createImageBitmap(b), createCanvas: (w, h) => new OffscreenCanvas(w, h) }),
      waitUntil: p => e.waitUntil(p),
      options: o,
    }));
  });
}
```

`src/sw-standalone.ts`:`import { setupPicman } from "./sw/index"; setupPicman();`(默认配置自执行,双语文件头注释)。

- [ ] **Step 1: 写失败测试**(mock deps;`Response`/`ReadableStream` 用 node 全局)

```ts
// test/pipeline.test.ts
import { describe, expect, it, vi } from "vitest";
import { handleImageRequest, shouldIntercept, type PipelineDeps } from "../src/sw/pipeline";
import { resolveSWOptions } from "../src/shared/types";
import { HEADER_MARK, PARAM_BYPASS, withStageParam } from "../src/shared/protocol";
import { makeGif } from "./fixtures";

const GIF_URL = "https://a.com/big.gif";

/** 把字节按 chunkSize 切成流式 Response */
function streamResponse(bytes: Uint8Array, chunkSize: number, headers: Record<string, string> = {}): Response {
  let off = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (off >= bytes.length) return c.close();
      c.enqueue(bytes.slice(off, off + chunkSize));
      off += chunkSize;
    },
  });
  return new Response(stream, { headers });
}

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps & { bg: Promise<unknown>[] } {
  const bg: Promise<unknown>[] = [];
  return {
    fetchImpl: vi.fn() as unknown as typeof fetch,
    cache: { matchStage: vi.fn().mockResolvedValue(undefined), putStage: vi.fn().mockResolvedValue(true), deleteUrl: vi.fn() },
    notify: vi.fn(),
    makeFirstFrame: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
    waitUntil: (p) => bg.push(p),
    options: resolveSWOptions({ threshold: 10, headBytes: 16 }), // 小阈值便于测试
    bg,
    ...over,
  };
}
const drain = (d: { bg: Promise<unknown>[] }) => Promise.all(d.bg);

describe("shouldIntercept", () => {
  const o = resolveSWOptions();
  const img = (url: string) => new Request(url, { method: "GET" });
  // node Request 无 destination,补 defineProperty
  const withDest = (r: Request, d: string) => (Object.defineProperty(r, "destination", { value: d }), r);
  it("非 image destination → false", () => {
    expect(shouldIntercept(withDest(img(GIF_URL), "script"), o)).toBe(false);
  });
  it("include 命中 image → true;exclude 优先", () => {
    expect(shouldIntercept(withDest(img(GIF_URL), "image"), o)).toBe(true);
    expect(shouldIntercept(withDest(img("https://a.com/x.jpg"), "image"), o)).toBe(false);
    expect(shouldIntercept(withDest(img(GIF_URL), "image"), resolveSWOptions({ exclude: [/big/] }))).toBe(false);
  });
});

describe("handleImageRequest", () => {
  it("小图(CL<阈值)原样返回", async () => {
    const d = makeDeps();
    const orig = new Response("tiny", { headers: { "Content-Length": "4" } });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(orig);
    expect(await handleImageRequest(new Request(GIF_URL), d)).toBe(orig);
  });
  it("动图:立即回 SVG 占位,后台产出首帧+全图缓存+两次通知", async () => {
    const gif = makeGif({ frames: 3, loop: true }); // 确保 > threshold(10)
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(resp.headers.get("Content-Type")).toContain("svg");
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    expect(resp.headers.get(HEADER_MARK)).toBe("placeholder");
    expect(await resp.text()).toContain("<svg");
    await drain(d);
    expect(d.cache.putStage).toHaveBeenCalledWith(GIF_URL, "ff", expect.any(Response));
    expect(d.cache.putStage).toHaveBeenCalledWith(GIF_URL, "1", expect.any(Response));
    expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "first-frame", url: GIF_URL });
    expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "complete", url: GIF_URL });
  });
  it("非动图大文件:透传全部字节", async () => {
    const bytes = new Uint8Array(64).fill(0xff); // 未知容器 → static
    bytes.set([0xff, 0xd8, 0xff], 0);
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(bytes, 16));
    const resp = await handleImageRequest(new Request("https://a.com/x.gif"), d);
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(bytes);
  });
  it("无 CL 且总量 < 阈值:整体透传", async () => {
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(new Uint8Array([1, 2, 3]), 2));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("PARAM_FULL:缓存命中回缓存;未命中透传", async () => {
    const d = makeDeps();
    const cached = new Response("cached");
    (d.cache.matchStage as ReturnType<typeof vi.fn>).mockResolvedValue(cached);
    expect(await handleImageRequest(new Request(withStageParam(GIF_URL, "1")), d)).toBe(cached);
  });
  it("PARAM_BYPASS:剥参后直接 fetch", async () => {
    const d = makeDeps();
    const net = new Response("net");
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(net);
    const u = new URL(GIF_URL);
    u.searchParams.set(PARAM_BYPASS, "1");
    expect(await handleImageRequest(new Request(u.href), d)).toBe(net);
    expect(d.fetchImpl).toHaveBeenCalledWith(GIF_URL);
  });
  it("首帧生成失败(makeFirstFrame null):无 ff 通知,complete 照常", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps({ makeFirstFrame: vi.fn().mockResolvedValue(null) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(GIF_URL), d);
    await drain(d);
    expect(d.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: "first-frame" }));
    expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "complete", url: GIF_URL });
  });
  it("fetch 抛异常:onError 后透传重试不抛", async () => {
    const onError = vi.fn();
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, onError }) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(new Response("retry"));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(await resp.text()).toBe("retry");
    expect(onError).toHaveBeenCalled();
  });
  it("同 URL 并发:第二个请求复用同一下载(fetch 只调一次)", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const [r1, r2] = await Promise.all([handleImageRequest(new Request(GIF_URL), d), handleImageRequest(new Request(GIF_URL), d)]);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(await r1.text()).toContain("<svg");
    expect(await r2.text()).toContain("<svg");
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现 `pipeline.ts`、`sw/index.ts`、更新 `src/sw.ts`/`sw-standalone.ts`**(双语注释;对外 API 完整 TSDoc 含示例)
- [ ] **Step 4: 跑通过 + `pnpm build` 成功(standalone 产物存在)** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/sw src/sw.ts src/sw-standalone.ts test/pipeline.test.ts CHANGELOG.md
git commit -m "feat: SW pipeline - threshold/sniff state machine, placeholder response, background download, dedupe"
```

---

### Task 10: 页面端 load + registerPicmanSW

**Files:**

- Create: `src/page/load.ts`、`src/page/register.ts`、`src/page/messages.ts`
- Modify: `src/index.ts`(导出 load/registerPicmanSW + shared 类型)
- Test: `test/load.test.ts`(happy-dom)

**Interfaces (Produces):**

```ts
// messages.ts — 页面侧统一消息订阅(load/auto 共用,单监听器)
export type StageEvent = { type: "first-frame" | "complete" | "error"; url: string; message?: string };
export function subscribe(url: string, cb: (e: StageEvent) => void): () => void; // 返回退订
// 依赖注入点(测试用):
export function _setServiceWorkerContainer(sw: ServiceWorkerContainer | null): void;

// load.ts
export interface PicmanTask {
  /** 规范化原始 URL — canonical original URL */
  url: string;
  /** 阶段回调:placeholder(同步微任务)/first-frame/complete — stage callback */
  onStage(cb: (stage: "placeholder" | "first-frame" | "complete", displayUrl: string) => void): PicmanTask;
  /** 全图就绪(displayUrl);下载失败 reject — resolves with full-image display URL */
  done: Promise<string>;
}
export function load(url: string): PicmanTask;

// register.ts
export function registerPicmanSW(swUrl: string): Promise<{ controlled: boolean }>;
```

**实现要点:**

- `messages.ts`:模块级 `Map<url, Set<cb>>`;首个订阅时挂 `navigator.serviceWorker.addEventListener('message')`(`isPicmanMessage` 过滤,url 直接匹配 Map key);`_setServiceWorkerContainer` 允许测试替换/置空。
- `load`:URL 规范化 `new URL(url, location.href).href`;无 `navigator.serviceWorker?.controller` → 微任务 emit `('complete', url)` 并 resolve done(降级);有 → 微任务 emit `('placeholder', url)`,订阅消息:first-frame → emit `('first-frame', withStageParam(url,'ff'))`;complete → emit + resolve `withStageParam(url,'1')` + 退订;error(stage download)→ reject + 退订。**对账**:创建时 `caches.match(withStageParam(url,'1'))`(window 侧,try/catch 包裹,不支持则忽略),命中 → 直接 complete。
- `registerPicmanSW`:`register(swUrl, { type: 'module' })` → `await navigator.serviceWorker.ready` → 返回 `{ controlled: !!navigator.serviceWorker.controller }`;不自动 reload。不支持 SW → `{ controlled: false }`。

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment happy-dom
// test/load.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "../src/page/load";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { withStageParam } from "../src/shared/protocol";

/** 假 ServiceWorkerContainer:可手动派发 message */
function fakeSW() {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    controller: {},
    addEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.delete(cb),
    emit: (data: unknown) => listeners.forEach((cb) => cb({ data } as MessageEvent)),
  };
}
afterEach(() => _setServiceWorkerContainer(null));

const URL1 = "https://a.com/x.gif";

describe("load", () => {
  it("SW 缺失:立即 complete + 原 URL", async () => {
    _setServiceWorkerContainer(null);
    const stages: string[] = [];
    const task = load(URL1).onStage((s) => stages.push(s));
    await expect(task.done).resolves.toBe(URL1);
    expect(stages).toContain("complete");
  });
  it("三段事件顺序 + displayUrl 带阶段参数", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const seen: [string, string][] = [];
    const task = load(URL1).onStage((s, u) => seen.push([s, u]));
    await Promise.resolve(); // placeholder 微任务
    sw.emit({ picman: 1, type: "first-frame", url: URL1 });
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await expect(task.done).resolves.toBe(withStageParam(URL1, "1"));
    expect(seen).toEqual([
      ["placeholder", URL1],
      ["first-frame", withStageParam(URL1, "ff")],
      ["complete", withStageParam(URL1, "1")],
    ]);
  });
  it("其他 URL 的消息不串扰", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const cb = vi.fn();
    load(URL1).onStage(cb);
    sw.emit({ picman: 1, type: "complete", url: "https://a.com/other.gif" });
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalledWith("complete", expect.anything());
  });
  it("download error → done reject", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const task = load(URL1);
    task.done.catch(() => {}); // 防未处理
    sw.emit({ picman: 1, type: "error", url: URL1, stage: "download", message: "net" });
    await expect(task.done).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL(happy-dom 未装则先 `pnpm add -D happy-dom`)
- [ ] **Step 3: 实现 messages/load/register + `src/index.ts` 导出**(对外 API 完整 TSDoc 含 @example)
- [ ] **Step 4: 跑通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/page src/index.ts test/load.test.ts package.json ../../pnpm-lock.yaml CHANGELOG.md
git commit -m "feat: page-side explicit API - load() task with stage events, SW registration helper"
```

---

### Task 11: 页面端 auto(零改造接管)+ 对账

**Files:**

- Create: `src/page/auto.ts`
- Modify: `src/index.ts`(导出 auto)
- Test: `test/auto.test.ts`(happy-dom)

**Interfaces (Produces):**

```ts
/** 启动零改造接管;返回停止函数 — start auto takeover; returns stop() */
export function auto(options?: PicmanAutoOptions): () => void;
```

**实现要点:**

- 内部状态:`tracked = Map<canonicalUrl, Set<WeakRef<HTMLImageElement | HTMLElement>>>`;`stageOf = Map<canonicalUrl, PicmanStage>`(已知最新阶段)。
- 启动:全量 `root.querySelectorAll('img[src]')` track;`MutationObserver`(childList subtree + attributes `src`/`data-picman-bg`)增量 track。track 时 `stripPicmanParams` 归一 key;若 `stageOf` 已有阶段(错过通知)→ 立即 swap 该元素。
- `backgrounds: true`:track `[data-picman-bg]` 元素(值 = 图片 URL,swap 改 `el.style.backgroundImage`);初始扫描 + observer 同步。样式表扫描 v1 不做(spec 允许"可选标记"路径,YAGNI——CHANGELOG 里注明背景图仅支持 data 标记)。
- 订阅:用 Task 10 `subscribe` 逐 url 订;first-frame/complete → 记 `stageOf` + 对映射元素 swap(img:`src = withStageParam(url, stage)`;bg:同理);error → 对元素设 `src = url + PARAM_BYPASS=1` 重试 + onError。
- 对账:`visibilitychange → visible` 时,对所有 `stageOf` 未到 '1' 的 url 执行 `caches.match(withStageParam(url,'1'))`(try/catch),命中 → 按 complete 处理。
- stop():断 observer、退订全部、清 Map。
- 防循环:swap 引发的 `src` attribute mutation,track 时 strip 后 key 相同且 stage 未前进 → 跳过。

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment happy-dom
// test/auto.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { auto } from "../src/page/auto";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { withStageParam } from "../src/shared/protocol";

function fakeSW() {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    controller: {},
    addEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.delete(cb),
    emit: (data: unknown) => listeners.forEach((cb) => cb({ data } as MessageEvent)),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0)); // 等 MutationObserver 微任务

const URL1 = "https://a.com/x.gif";
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  _setServiceWorkerContainer(null);
  document.body.innerHTML = "";
});

describe("auto", () => {
  it("已有 <img> 收到 complete 后切到全图 URL", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("后插入的 <img> 也被接管;first-frame 先行", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    stop = auto();
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    await flush();
    sw.emit({ picman: 1, type: "first-frame", url: URL1 });
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "ff"));
  });
  it("data-picman-bg 元素切 backgroundImage", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const div = document.createElement("div");
    div.setAttribute("data-picman-bg", URL1);
    document.body.append(div);
    stop = auto();
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await flush();
    expect(div.style.backgroundImage).toContain(withStageParam(URL1, "1"));
  });
  it("晚到元素:阶段已知立即 swap(错过通知补偿)", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    stop = auto();
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    await flush();
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("stop() 后不再接管", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    const img = document.createElement("img");
    img.src = URL1;
    document.body.append(img);
    stop = auto();
    stop();
    stop = undefined;
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await flush();
    expect(img.src).toBe(URL1);
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现 `auto.ts` + 导出**(双语注释,auto 完整 TSDoc)
- [ ] **Step 4: 跑通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/page/auto.ts src/index.ts test/auto.test.ts CHANGELOG.md
git commit -m "feat: page-side auto takeover - img/background tracking, stage swap, missed-notification catch-up"
```

---

### Task 12: `<pic-man>` Web Component

**Files:**

- Create: `src/element/index.ts`
- Modify: `src/element.ts`(`export * from "./element/index"` + 顶层 `define`)
- Test: `test/element.test.ts`(happy-dom)

**Interfaces (Produces):**

```ts
/** <pic-man src alt> — 内部 shadow <img>,自动三段切换 */
export class PicManElement extends HTMLElement {
  static observedAttributes: ["src", "alt"];
}
export function definePicMan(tag?: string): void; // 默认 'pic-man',重复 define 幂等
```

**实现要点:** `connectedCallback` 建 shadow(`mode:'open'`)+ `<img style="width:100%;height:auto;display:block">`;读 `src` 属性 → `load(url)`,`onStage` 更新内部 img.src,alt 透传;`attributeChangedCallback('src')` 重新 load(旧 task 退订——`disconnect` 标志位即可,PicmanTask 无 cancel,用代际计数丢弃过期回调);`disconnectedCallback` 置代际+1。`src/element.ts` 顶层调用 `definePicMan()`(import 即注册),幂等:`customElements.get(tag)` 已存在则跳过。

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment happy-dom
// test/element.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { definePicMan } from "../src/element/index";
import { _setServiceWorkerContainer } from "../src/page/messages";
import { withStageParam } from "../src/shared/protocol";

function fakeSW() {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    controller: {},
    addEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MessageEvent) => void) => listeners.delete(cb),
    emit: (data: unknown) => listeners.forEach((cb) => cb({ data } as MessageEvent)),
  };
}
const URL1 = "https://a.com/x.gif";
afterEach(() => {
  _setServiceWorkerContainer(null);
  document.body.innerHTML = "";
});

describe("<pic-man>", () => {
  it("SW 缺失:直接渲染原 URL", async () => {
    definePicMan();
    const el = document.createElement("pic-man");
    el.setAttribute("src", URL1);
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 0));
    const img = el.shadowRoot!.querySelector("img")!;
    expect(img.src).toBe(URL1);
  });
  it("阶段推进更新内部 img", async () => {
    const sw = fakeSW();
    _setServiceWorkerContainer(sw as unknown as ServiceWorkerContainer);
    definePicMan();
    const el = document.createElement("pic-man");
    el.setAttribute("src", URL1);
    el.setAttribute("alt", "demo");
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 0));
    const img = el.shadowRoot!.querySelector("img")!;
    expect(img.src).toBe(URL1); // placeholder 阶段 = 原 URL(SW 回占位)
    expect(img.alt).toBe("demo");
    sw.emit({ picman: 1, type: "complete", url: URL1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(img.src).toBe(withStageParam(URL1, "1"));
  });
  it("重复 definePicMan 幂等", () => {
    definePicMan();
    expect(() => definePicMan()).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑失败** → FAIL
- [ ] **Step 3: 实现**(完整 TSDoc + @example)
- [ ] **Step 4: 跑通过 + 全量 `pnpm test`** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/element src/element.ts test/element.test.ts CHANGELOG.md
git commit -m "feat: pic-man web component built on load()"
```

---

### Task 13: demo 页 + 限速服务 + README + 收尾验证

**Files:**

- Create: `examples/index.html`、`examples/serve.ts`(node 限速静态服务:chunk 间 setTimeout,`node --experimental-strip-types examples/serve.ts` 运行;examples 不参与构建)
- Create: `examples/sw.ts`(`import { setupPicman } from "../src/sw"; setupPicman();` 说明用 dist/picman-sw.js 亦可)
- Modify: `README.md`(自然语言重写:定位、三种接入方式示例、配置表、降级行为、浏览器要求;禁 AI 腔)
- Modify: `CHANGELOG.md`(整理 0.2.0 段)
- Modify: `docs/REQUIREMENTS.md` 若实现与需求有偏差(如背景图仅 data 标记)→ 同步 + 新增 `docs/logs/` 记录

**步骤:**

- [ ] **Step 1: demo 页**:`<img>` 直引大 GIF(auto 模式)+ `<pic-man>` + `load()` 三块并排;`registerPicmanSW('/sw.js')`;serve.ts 提供 `/sw.js`(esbuild 现场打包或直接引用 `dist/picman-sw.js`)与 `--throttle <bytes/s>` 参数。
- [ ] **Step 2: 人工验收**:`pnpm build && node examples/serve.ts --throttle 51200`,浏览器观察三段时间轴(色块 → 静态首帧 → 动画),记录结果。
- [ ] **Step 3: 全量验证**:`pnpm test`(全绿)、`pnpm build`(产物齐)、`pnpm check`(fmt+lint 过)。
- [ ] **Step 4: README/CHANGELOG/docs 收尾**。
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: demo page, throttled dev server, README rewrite for progressive loading"
```

---

## Self-Review 结论(已执行)

- **Spec 覆盖**:S0~S6(Task 9)、字节算法 §5(Task 3~6)、占位 §5.5+色块(Task 7)、协议 §6(Task 1)、缓存 §8(Task 8)、页面 §7(Task 10~12)、测试 §10(各任务+13)。偏差:auto 的 CSS 背景仅支持 `data-picman-bg` 标记(样式表扫描 YAGNI 砍掉)——Task 13 要求回写 docs。
- **占位符扫描**:无 TBD/TODO;Task 2/3/4/5/7/8 的 Step 3 为"按算法要点实现"——算法要点与接口签名均完整给出,属可执行描述。
- **类型一致性**:`PicmanStage`/`withStageParam`/`PicmanCacheLike`/`ResolvedSWOptions`/`subscribe` 跨任务签名已对齐;pipeline 的 `makeFirstFrame` 与 placeholder 的 `makeFirstFramePlaceholder` 通过 sw/index.ts 装配层适配(签名不同是有意的)。
