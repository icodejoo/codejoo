/**
 * 构建脚本：transpile-only 多产物布局
 *
 * 目标：
 *   - 每个插件 / 对象 / 子模块在 dist 下都是**自身 .ts 的 transpile 产物**，
 *     彼此通过相对 import 引用 —— 不复制共享代码（如 helper.ts 不再被内联进每个插件）。
 *   - 仅 `dist/index.min.js` 是完整 bundle + 压缩版（一个文件分发用）。
 *
 * 流水线：
 *   1. 清空 dist
 *   2. tsc → .build-tmp 镜像 src/ 结构（.js + .d.ts，imports 保持 extensionless）
 *   3. 走 tmp，每个文件做：
 *        a. 路径重定位：`helper.ts` / `objects/<X>.ts` → `<dir>/index.{js,d.ts}`
 *        b. 改写所有相对 import：补 `.js` 扩展 + 反映特殊重定位
 *      落到 dist
 *   4. esbuild bundle src/index.ts → dist/index.min.js（minified, 完整 inline）
 *   5. 删 tmp + 输出大小报告
 *
 * 产物布局：
 *   dist/
 *   ├── index.js          (transpile of src/index.ts —— 纯 re-export，不含具体代码)
 *   ├── index.d.ts        (transpile of src/index.ts 的类型 barrel)
 *   ├── index.min.js      (bundle + minified —— 一个文件分发)
 *   ├── helper/index.{js,d.ts}
 *   ├── core/{core,index,types}.{js,d.ts}
 *   ├── plugin/{plugin,index,types}.{js,d.ts}
 *   ├── plugins/<name>/{<name>,index,types}.{js,d.ts}
 *   └── objects/<name>/index.{js,d.ts}
 */

import {
    readdirSync, statSync, readFileSync, writeFileSync,
    mkdirSync, rmSync, existsSync, cpSync,
} from 'node:fs';
import { resolve, dirname, relative, sep, posix } from 'node:path';
import { build as esbuildBuild } from 'esbuild';
import { execSync } from 'node:child_process';


const root = process.cwd();
const SRC = resolve(root, 'src');
const DIST = resolve(root, 'dist');
const TMP = resolve(root, '.build-tmp');


// ── helpers ─────────────────────────────────────────────────────────────────

function walkFiles(dir: string, predicate: (name: string) => boolean): string[] {
    const out: string[] = [];
    function visit(d: string): void {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = resolve(d, e.name);
            if (e.isDirectory()) visit(p);
            else if (e.isFile() && predicate(e.name)) out.push(p);
        }
    }
    visit(dir);
    return out;
}


/**
 * 把 src 相对路径（POSIX, 含 .ts 后缀）映射到 dist 相对路径（指定后缀）
 *
 * 特殊情况：
 *   - `index.ts`          → `index{ext}`
 *   - `helper.ts`         → `helper/index{ext}`
 *   - `objects/<X>.ts`    → `objects/<X>/index{ext}`
 *   - 其他                → 镜像，仅替换扩展名
 */
function distPathFor(srcRelPosix: string, ext: '.js' | '.d.ts'): string {
    if (srcRelPosix === 'index.ts') return 'index' + ext;
    if (srcRelPosix === 'helper.ts') return 'helper/index' + ext;
    const m = srcRelPosix.match(/^objects\/([^/]+)\.ts$/);
    if (m) return `objects/${m[1]}/index` + ext;
    return srcRelPosix.replace(/\.ts$/, ext);
}


/** 把相对 import specifier 解析回它指向的源文件 abs 路径，否则 null */
function resolveSrcSpec(importerAbs: string, spec: string): string | null {
    const c = resolve(dirname(importerAbs), spec);
    if (existsSync(c + '.ts')) return c + '.ts';
    if (existsSync(c + '.tsx')) return c + '.tsx';
    if (existsSync(c) && statSync(c).isDirectory()) {
        const idx = resolve(c, 'index.ts');
        if (existsSync(idx)) return idx;
    }
    return null;
}


/**
 * 改写一个相对 import specifier。
 * 思路：从 importer 的源位置出发解析它指向哪个 .ts，然后用两个 src→dist 的映射
 *      重新算从 importer 的 dist 位置到 target 的 dist 位置的相对路径。
 *
 * 始终输出 `.js` 后缀（dts 文件里的 import 也用 `.js`，TS 会找邻居 .d.ts）。
 */
function rewriteSpec(importerAbs: string, spec: string): string {
    const target = resolveSrcSpec(importerAbs, spec);
    if (!target) return spec;

    const importerSrcRel = relative(SRC, importerAbs).replaceAll(sep, '/');
    const targetSrcRel = relative(SRC, target).replaceAll(sep, '/');

    const importerDist = distPathFor(importerSrcRel, '.js');
    const targetDist = distPathFor(targetSrcRel, '.js');

    let rel = posix.relative(posix.dirname(importerDist), targetDist);
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
}


const reStatic = /(\b(?:import|export)\b[^'"`;()]*?\bfrom\s*['"])(\.\.?\/[^'"]+)(['"])/g;
const reDynamic = /(\bimport\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g;
const reBare = /(\bimport\s+['"])(\.\.?\/[^'"]+)(['"])/g;


function rewriteImports(importerAbs: string, code: string): string {
    return code
        .replace(reStatic, (_, a, p, c) => a + rewriteSpec(importerAbs, p) + c)
        .replace(reDynamic, (_, a, p, c) => a + rewriteSpec(importerAbs, p) + c)
        .replace(reBare, (_, a, p, c) => a + rewriteSpec(importerAbs, p) + c);
}


// ── 1. clean ────────────────────────────────────────────────────────────────
rmSync(DIST, { recursive: true, force: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// ── 2. tsc emit (.js + .d.ts) → tmp ────────────────────────────────────────
console.log('[build] tsc → .build-tmp ...');
execSync(
    `npx tsc -p tsconfig.build.json --outDir "${TMP}"`,
    { stdio: 'inherit', cwd: root },
);

// ── 3. relocate + rewrite imports → dist ───────────────────────────────────
const emitted = walkFiles(TMP, (n) => n.endsWith('.js') || n.endsWith('.d.ts'));

function processEmitted(emittedAbs: string): void {
    const tmpRel = relative(TMP, emittedAbs).replaceAll(sep, '/');
    const isDts = tmpRel.endsWith('.d.ts');
    const ext: '.js' | '.d.ts' = isDts ? '.d.ts' : '.js';

    // 反推源 .ts 路径
    const srcRel = isDts
        ? tmpRel.replace(/\.d\.ts$/, '.ts')
        : tmpRel.replace(/\.js$/, '.ts');
    const srcAbs = resolve(SRC, srcRel);

    if (!existsSync(srcAbs)) {
        // tsc 偶尔会发非 src 来源的辅助文件（比如外部 .d.ts 引用）—— 直接镜像
        const target = resolve(DIST, tmpRel);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(emittedAbs, target);
        return;
    }

    const distRel = distPathFor(srcRel, ext);
    const target = resolve(DIST, distRel);
    mkdirSync(dirname(target), { recursive: true });

    const content = readFileSync(emittedAbs, 'utf8');
    writeFileSync(target, rewriteImports(srcAbs, content));
}

for (const f of emitted) processEmitted(f);

rmSync(TMP, { recursive: true, force: true });

// ── 4. bundle + minify → dist/index.min.js ──────────────────────────────────
console.log('[build] esbuild bundle → dist/index.min.js ...');
await esbuildBuild({
    entryPoints: [resolve(SRC, 'index.ts')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'esnext',
    platform: 'neutral',
    outfile: resolve(DIST, 'index.min.js'),
    external: ['axios', '@codejoo/*', 'node:*'],
    legalComments: 'none',
    treeShaking: true,
});

// ── 5. size report ──────────────────────────────────────────────────────────
function fmt(p: string): string {
    try { return `${(statSync(p).size / 1024).toFixed(2)} KB`; } catch { return '?'; }
}
const samples = [
    'index.js',
    'index.d.ts',
    'index.min.js',
    'helper/index.js',
    'plugins/cache/index.js',
    'plugins/cache/cache.js',
    'objects/ApiResponse/index.js',
];
console.log('\n[build] artifacts:');
for (const f of samples) {
    console.log(`  dist/${f.padEnd(34)} ${fmt(resolve(DIST, f))}`);
}
