import { exec, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

/** 异步版 exec / execFile：测试里的子进程都并发跑 */
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** 包根目录 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** package.json（读 exports 做存在性检查） */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { exports: Record<string, string | Record<string, string>> };

/** vite-plus 的命令行入口 */
const VP = path.join(ROOT, "node_modules/.bin", process.platform === "win32" ? "vp.CMD" : "vp");

/** 一次导入探测的结果 */
interface ProbeResult {
  /** 全局 skz 的成员 */
  keys: string[];
  /** 模块导出的名字 */
  exportsKeys: string[];
  /** 默认导出的成员，没有默认导出为 null */
  defaultKeys: string[] | null;
  /** 默认导出是否就是全局 skz */
  defaultIsGlobal: boolean;
}

/** 探测结果缓存（按导入说明符）：同一个入口只起一次 node 子进程 */
const probes = new Map<string, Promise<ProbeResult>>();

/**
 * 在 Node 里用包名自引用导入一个入口（走 package.json exports 的 node 条件），返回 JSON 描述；结果按说明符缓存
 * @param spec 导入说明符，如 "skeletonizer/full"
 * @returns skz 全局与导出的情况
 * @example await probe("skeletonizer"); // { keys: ["enable", ...] }
 */
function probe(spec: string): Promise<ProbeResult> {
  let hit = probes.get(spec);
  if (!hit) {
    const code = `const m = await import(${JSON.stringify(spec)}); console.log(JSON.stringify({ keys: Object.keys(globalThis.skz ?? {}).sort(), exportsKeys: Object.keys(m).sort(), defaultKeys: m.default ? Object.keys(m.default).sort() : null, defaultIsGlobal: m.default === globalThis.skz }));`;
    hit = execFileAsync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" }).then((r) => JSON.parse(r.stdout.trim().split("\n").pop()!) as ProbeResult);
    probes.set(spec, hit);
  }
  return hit;
}

/** core 挂到全局 skz 上的成员 */
const CORE_KEYS = ["bone", "defineSkzBox", "disable", "enable"];

/** 完整版多出 registerCustomElements 之后的 skz 成员 */
const FULL_KEYS = [...CORE_KEYS, "registerCustomElements"].toSorted();

/** 只有 core 成员的入口 */
const CORE_SPECS = ["skeletonizer", "skeletonizer/explicit"];

/** 带完整版扩展的入口：skz 多出 registerCustomElements，运行时导出与 skeletonizer/full 一致（变体入口 re-export 完整版，只多做一次方案注册） */
const FULL_SPECS = ["skeletonizer/full", "skeletonizer/global/js", "skeletonizer/svg/js", "skeletonizer/all/js"];

/** 框架适配层入口：不经过 core 入口，不挂全局 */
const ADAPTER_SPECS = ["skeletonizer/vue", "skeletonizer/react", "skeletonizer/svelte"];

beforeAll(async () => {
  // 全部入口并发探测，用例里再取就是缓存
  await Promise.all([...CORE_SPECS, ...FULL_SPECS, ...ADAPTER_SPECS].map(probe));
}, 120_000);

describe("package.json exports 指向的文件都存在", () => {
  it("每个子路径的每个条件指向的文件都在 dist 里", () => {
    const missing: string[] = [];
    for (const [sub, target] of Object.entries(pkg.exports)) {
      const files = typeof target === "string" ? [target] : Object.values(target);
      for (const file of files) if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${sub} -> ${file}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("Node 里导入各入口（条件导出：node -> 纯 JS，不触发 CSS 导入），且全局 skz 存在", () => {
  // core 入口：只有 core 的成员
  for (const spec of CORE_SPECS) {
    it(`${spec}：不抛错，skz 只有 core 成员`, async () => {
      const r = await probe(spec);
      expect(r.keys).toEqual(CORE_KEYS);
      // 默认导出就是全局上的那个 skz 对象
      expect(r.defaultKeys).toEqual(CORE_KEYS);
      expect(r.defaultIsGlobal).toBe(true);
      expect(r.exportsKeys).toContain("enable");
      expect(r.exportsKeys).not.toContain("registerCustomElements");
    });
  }

  // 完整版与带完整版扩展的入口：skz 多出 registerCustomElements，运行时导出与 full 一致（含默认导出）
  for (const spec of FULL_SPECS) {
    it(`${spec}：不抛错，skz 多出 registerCustomElements，导出与 skeletonizer/full 一致`, async () => {
      const r = await probe(spec);
      expect(r.keys).toEqual(FULL_KEYS);
      expect(r.defaultKeys).toEqual(FULL_KEYS);
      expect(r.exportsKeys).toEqual((await probe("skeletonizer/full")).exportsKeys);
    });
  }

  it("skeletonizer/full 导出完整版 API", async () => {
    const r = await probe("skeletonizer/full");
    expect(r.exportsKeys).toEqual(expect.arrayContaining(["enable", "disable", "Bone", "registerCustomElements", "registerEngine", "registerExtension", "defineSkzBox"]));
  });

  // 适配层不挂全局（不经过 core 入口）
  for (const spec of ADAPTER_SPECS) {
    it(`${spec}：不抛错，且不挂全局 skz`, async () => {
      expect((await probe(spec)).keys).toEqual([]);
    });
  }
});

describe("打包器（vite）构建浏览器产物", () => {
  /** 一个构建场景：入口代码 + 对产物的断言 */
  interface Fixture {
    /** 用例标题 */
    title: string;
    /** 入口 main.js 的内容 */
    source: string;
    /** 断言产物里的 CSS / JS 文本 */
    check(out: { css: string; js: string }): void;
  }

  /** 构建场景表：三个场景各用独立的临时目录，beforeAll 里并发构建 */
  const FIXTURES: Fixture[] = [
    {
      title: "import 'skeletonizer'：产物带 core.css 的样式，也带全局 skz 挂载",
      source: `import { enable } from "skeletonizer";\nenable(document.getElementById("a"), { effect: "shimmer" });\n`,
      check: ({ css, js }) => {
        expect(css).toContain("[skz]");
        expect(css).toContain("skz-shimmer-root");
        expect(js).toContain("skeletonizer.global");
      },
    },
    {
      title: "import 'skeletonizer/explicit'：产物带 explicit.css",
      source: `import { enable } from "skeletonizer/explicit";\nenable(document.getElementById("a"));\n`,
      check: ({ css }) => {
        expect(css).toContain("[skz]");
        expect(css).toContain("skz-bone");
      },
    },
    {
      title: "import 'skeletonizer/full'：不带 CSS",
      source: `import { enable } from "skeletonizer/full";\nenable(document.getElementById("a"), { text: "leaf" });\n`,
      check: ({ css, js }) => {
        expect(css).toBe("");
        expect(js).toContain("skz-text");
      },
    },
  ];

  /** 各场景的构建产物 */
  const built: Array<{ css: string; js: string }> = [];

  /**
   * 建一个临时 fixture（node_modules/skeletonizer 链到包根，等同于真正安装），用入口代码 build，返回产物里的 CSS 与 JS 文本
   * @param source 入口 main.js 的内容
   * @returns CSS 与 JS 文本（没有 CSS 资源时 css 为空串）
   */
  async function bundle(source: string): Promise<{ css: string; js: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skz-fixture-"));
    try {
      fs.mkdirSync(path.join(dir, "node_modules"));
      fs.symlinkSync(ROOT, path.join(dir, "node_modules/skeletonizer"), "junction");
      fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><body><div id="a"></div><script type="module" src="./main.js"></script></body></html>`);
      fs.writeFileSync(path.join(dir, "main.js"), source);
      await execAsync(`"${VP}" build`, { cwd: dir, env: { ...process.env, NODE_ENV: "production" } });
      const assets = path.join(dir, "dist/assets");
      const read = (ext: string): string =>
        fs
          .readdirSync(assets)
          .filter((f) => f.endsWith(ext))
          .map((f) => fs.readFileSync(path.join(assets, f), "utf8"))
          .join("\n");
      return { css: read(".css"), js: read(".js") };
    } finally {
      // 先单独摘掉指向包根的链接（rmdir 只删链接本身），确认摘掉了才递归清目录，绝不能顺着链接删到包根
      const link = path.join(dir, "node_modules/skeletonizer");
      try {
        fs.rmdirSync(link);
      } catch {
        // 链接没建成功或已摘掉
      }
      if (!fs.existsSync(link)) fs.rmSync(dir, { force: true, recursive: true });
    }
  }

  beforeAll(async () => {
    built.push(...(await Promise.all(FIXTURES.map((f) => bundle(f.source)))));
  }, 120_000);

  FIXTURES.forEach((f, i) => it(f.title, () => f.check(built[i]!)));
});
