import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 包根目录 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 源码目录 */
const SRC = path.join(ROOT, "src");

/** 开发警告的守卫条件：每个 warnOnce 调用点前都要有它，使用方的生产构建才能把调用和文案一起折叠掉 */
const DEV_GUARD = 'process.env.NODE_ENV !== "production"';

/**
 * 读源码文件。
 * @param rel 相对 src 的路径
 * @returns 文件内容
 */
function src(rel: string): string {
  return readFileSync(path.join(SRC, rel), "utf8");
}

/**
 * 递归列出 src 下的 .ts 文件。
 * @param dir 起始目录
 * @returns 绝对路径列表
 */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return tsFiles(full);
    return d.name.endsWith(".ts") ? [full] : [];
  });
}

describe("源码里的手写约定", () => {
  it('每个 warnOnce 调用点都包在 try { if (process.env.NODE_ENV !== "production") … } catch {} 里', () => {
    const sites: string[] = [];
    for (const file of tsFiles(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.trim();
        // 跳过注释、定义和 import
        if (!code.includes("warnOnce(") || /^(\*|\/\/|\/\*)/.test(code) || code.startsWith("export function warnOnce") || code.startsWith("import ")) return;
        const where = `${path.relative(SRC, file)}:${i + 1}`;
        sites.push(where);
        // 守卫可能和调用同一行，也可能在上一行（调用折行时）
        const near = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
        expect(near, where).toContain(DEV_GUARD);
        expect(lines.slice(Math.max(0, i - 3), i + 1).join("\n"), where).toMatch(/try \{/);
      });
    }
    // 至少覆盖到现有的三处调用：适配层、全局 skz、方案调度
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  it("根驱动门槛：JS 的 ROOT_DRIVEN_CONDITIONS 与 SCSS 的 $prop-gate 是同一组条件", () => {
    const js = src("full/variants/global.ts");
    const list = js.slice(js.indexOf("ROOT_DRIVEN_CONDITIONS"), js.indexOf("];", js.indexOf("ROOT_DRIVEN_CONDITIONS")));
    const fromJs = [...list.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((m) => `(${m[1]}: ${m[2]})`);
    const scss = src("styles/_mixins.scss").match(/\$prop-gate:\s*"([^"]+)"/);
    expect(scss).not.toBeNull();
    const fromScss = scss![1].split(" or ").map((s) => s.trim());
    expect(fromJs.length).toBeGreaterThan(0);
    expect(fromJs).toEqual(fromScss);
  });
});
