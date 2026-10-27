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

/** dist 目录 */
const DIST = path.join(ROOT, "dist");

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

/** Node 子进程里先注册的加载钩子：把 .css 导入当成空模块（full.mjs / lite.mjs 开头带 CSS 导入，Node 本身不认识 .css） */
const CSS_STUB_HOOK = `import { register } from "node:module"; register("data:text/javascript," + encodeURIComponent("export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }; return next(url, ctx); }"));`;

/**
 * 在 Node 子进程里跑一段 ESM 代码（已注册 CSS 空模块钩子），返回最后一行 stdout
 * @param code 要执行的 ESM 代码
 * @returns 最后一行输出
 * @example await runNode("console.log(1)"); // "1"
 */
async function runNode(code: string): Promise<string> {
  const r = await execFileAsync(process.execPath, ["--input-type=module", "-e", CSS_STUB_HOOK + code], { cwd: ROOT, encoding: "utf8" });
  return r.stdout.trim().split("\n").pop()!;
}

/**
 * 在 Node 里用包名自引用导入一个入口（走 package.json exports），返回 JSON 描述；结果按说明符缓存
 * @param spec 导入说明符，如 "skeletonizer/lite"
 * @returns skz 全局与导出的情况
 * @example await probe("skeletonizer"); // { keys: ["enable", ...] }
 */
function probe(spec: string): Promise<ProbeResult> {
  let hit = probes.get(spec);
  if (!hit) {
    const code = `const m = await import(${JSON.stringify(spec)}); console.log(JSON.stringify({ keys: Object.keys(globalThis.skz ?? {}).sort(), exportsKeys: Object.keys(m).sort(), defaultKeys: m.default ? Object.keys(m.default).sort() : null, defaultIsGlobal: m.default === globalThis.skz }));`;
    hit = runNode(code).then((out) => JSON.parse(out) as ProbeResult);
    probes.set(spec, hit);
  }
  return hit;
}

/** core 挂到全局 skz 上的成员 */
const CORE_KEYS = ["bone", "disable", "enable"];

/** 框架适配层与 element 产物：不含 core，不挂全局（只有胶水） */
const ADAPTER_FILES = ["vue.mjs", "react.mjs", "svelte.mjs", "solid.mjs", "element.mjs"];

/** 框架适配层与 element 的入口说明符 */
const ADAPTER_SPECS = ["skeletonizer/vue", "skeletonizer/react", "skeletonizer/svelte", "skeletonizer/solid", "skeletonizer/element"];

/** dist 里应该恰好有的文件：两个自包含的 JS + CSS、三个适配层、element，以及各自的 d.mts */
const EXPECTED_DIST = [
  "element.d.mts",
  "element.mjs",
  "full.css",
  "full.d.mts",
  "full.mjs",
  "lite.css",
  "lite.d.mts",
  "lite.mjs",
  "react.d.mts",
  "react.mjs",
  "solid.d.mts",
  "solid.mjs",
  "svelte.d.mts",
  "svelte.mjs",
  "vue.d.mts",
  "vue.mjs",
];

/** package.json exports 应该恰好有的子路径 */
const EXPECTED_SUBPATHS = [".", "./element", "./full.css", "./lite", "./lite.css", "./package.json", "./react", "./solid", "./svelte", "./vue"];

/** 适配层产物体积上限（字节）：只有胶水，超了说明又把 core 内联进来了 */
const ADAPTER_MAX_BYTES = 4000;

/** 全局挂载所有者标记：core 代码的标志，每份 core 恰好一处 */
const CORE_MARK = "skeletonizer.global";

/**
 * 读 dist 下的文件
 * @param name 文件名
 * @returns 文件文本
 */
function readDist(name: string): string {
  return fs.readFileSync(path.join(DIST, name), "utf8");
}

beforeAll(async () => {
  // 全部入口并发探测，用例里再取就是缓存
  await Promise.all(["skeletonizer", "skeletonizer/lite", ...ADAPTER_SPECS].map(probe));
}, 120_000);

describe("产物结构", () => {
  it("dist 里恰好是约定的文件，没有哈希 chunk，d.mts 也一样", () => {
    expect(fs.readdirSync(DIST).toSorted()).toEqual(EXPECTED_DIST);
  });

  it("package.json exports 只有约定的子路径，且指向的文件都存在", () => {
    expect(Object.keys(pkg.exports).toSorted()).toEqual(EXPECTED_SUBPATHS);
    const missing: string[] = [];
    for (const [sub, target] of Object.entries(pkg.exports)) {
      const files = typeof target === "string" ? [target] : Object.values(target);
      for (const file of files) if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${sub} -> ${file}`);
    }
    expect(missing).toEqual([]);
  });

  it("full.mjs / lite.mjs 开头各自导入同名 CSS；适配层与 element 不带 CSS 导入", () => {
    expect(readDist("full.mjs").slice(0, 40)).toMatch(/^import\s*"\.\/full\.css";/);
    expect(readDist("lite.mjs").slice(0, 40)).toMatch(/^import\s*"\.\/lite\.css";/);
    for (const f of ADAPTER_FILES) expect(readDist(f), f).not.toMatch(/\.css["'`]/);
  });

  it("full.mjs 与 lite.mjs 各自内联 core：除了开头的 CSS，不 import 任何本地模块", () => {
    for (const f of ["full.mjs", "lite.mjs"]) {
      const text = readDist(f);
      expect(text.replace(/^import\s*"\.\/(full|lite)\.css";/, ""), f).not.toMatch(/from\s*["']\.\//);
      expect(text.split(CORE_MARK).length - 1, `${f} 里的 core 份数`).toBe(1);
    }
  });

  it("适配层与 element 产物只有胶水：不含 core 代码，体积很小，通过私有全局键取实现", () => {
    for (const f of ADAPTER_FILES) {
      const text = readDist(f);
      expect(text.length, f).toBeLessThan(ADAPTER_MAX_BYTES);
      expect(text, f).not.toContain(CORE_MARK);
      expect(text, f).not.toContain("skz-effect");
      expect(text, f).toContain("Symbol.for(`skeletonizer`)");
    }
  });

  it("d.mts：适配层与完整版的类型都从 skeletonizer/lite 引（element 的公开类型不依赖选项类型，不引），没有另起一份", () => {
    for (const f of ["vue.d.mts", "react.d.mts", "svelte.d.mts", "solid.d.mts", "full.d.mts"]) {
      expect(readDist(f), f).toContain('"skeletonizer/lite"');
    }
    expect(readDist("full.d.mts")).toContain('declare module "skeletonizer/lite"');
  });
});

describe("Node 里导入各入口（CSS 导入被钩子吞掉），且全局 skz 存在", () => {
  it("skeletonizer/lite：skz 只有 core 成员，默认导出就是全局 skz", async () => {
    const r = await probe("skeletonizer/lite");
    expect(r.keys).toEqual(CORE_KEYS);
    expect(r.defaultKeys).toEqual(CORE_KEYS);
    expect(r.defaultIsGlobal).toBe(true);
    expect(r.exportsKeys).toContain("enable");
    expect(r.exportsKeys).not.toContain("defineSkzBox");
    expect(r.exportsKeys).not.toContain("SkzBox");
  });

  it("skeletonizer（完整版）：skz 成员与 lite 相同，导出完整版 API，不再导出 registerCustomElements / defineSkzBox", async () => {
    const r = await probe("skeletonizer");
    expect(r.keys).toEqual(CORE_KEYS);
    expect(r.defaultKeys).toEqual(CORE_KEYS);
    expect(r.defaultIsGlobal).toBe(true);
    expect(r.exportsKeys).toEqual(expect.arrayContaining(["enable", "disable", "Bone", "registerEngine", "registerExtension"]));
    expect(r.exportsKeys).not.toContain("registerCustomElements");
    expect(r.exportsKeys).not.toContain("defineSkzBox");
  });

  it("skeletonizer/element：只导出 SkzBox 与 defineSkzBox，导入不注册 <skz-box>", async () => {
    const r = await probe("skeletonizer/element");
    expect(r.exportsKeys).toEqual(["SkzBox", "defineSkzBox"]);
    expect(r.defaultKeys).toBeNull();
    const code = `globalThis.customElements = { _m: new Map(), get(n) { return this._m.get(n); }, define(n, c) { this._m.set(n, c); } }; globalThis.HTMLElement = class {}; const m = await import("skeletonizer/element"); const before = customElements.get("skz-box") === undefined; m.defineSkzBox(); console.log(JSON.stringify({ before, after: customElements.get("skz-box") === m.SkzBox }));`;
    expect(JSON.parse(await runNode(code))).toEqual({ before: true, after: true });
  });

  // 适配层与 element 不含 core：自己不挂全局
  for (const spec of ADAPTER_SPECS) {
    it(`${spec}：不抛错，且不挂全局 skz`, async () => {
      expect((await probe(spec)).keys).toEqual([]);
    });
  }

  it("私有全局键：导入 lite 或完整版后总有 enable / disable；公开的 skz 被别人占用时也一样", async () => {
    const code = (spec: string, pre = ""): string =>
      `${pre}await import(${JSON.stringify(spec)}); const api = globalThis[Symbol.for("skeletonizer")]; console.log(JSON.stringify({ enable: typeof api?.enable, disable: typeof api?.disable, skz: typeof globalThis.skz }));`;
    expect(JSON.parse(await runNode(code("skeletonizer/lite")))).toEqual({ enable: "function", disable: "function", skz: "object" });
    expect(JSON.parse(await runNode(code("skeletonizer")))).toEqual({ enable: "function", disable: "function", skz: "object" });
    // 公开变量被占用：不覆盖，私有键照挂
    const taken = await runNode(code("skeletonizer/lite", "globalThis.skz = 1; console.warn = () => {}; "));
    expect(JSON.parse(taken)).toEqual({ enable: "function", disable: "function", skz: "number" });
  });

  it("element 没导入实现时：开发模式报错（console.warn 一次，不抛），生产模式静默", async () => {
    const code = (env: string): string =>
      `process.env.NODE_ENV = "${env}"; const warns = []; console.warn = (m) => warns.push(String(m)); globalThis.customElements = { _m: new Map(), get(n) { return this._m.get(n); }, define(n, c) { this._m.set(n, c); } }; globalThis.HTMLElement = class {}; const { SkzBox } = await import("skeletonizer/element"); const host = Object.assign(new SkzBox(), { firstElementChild: {}, hasAttribute: () => true, getAttribute: () => null, toggleAttribute() {} }); host.connectedCallback(); console.log(JSON.stringify(warns));`;
    const dev = JSON.parse(await runNode(code("development"))) as string[];
    expect(dev).toHaveLength(1);
    expect(dev[0]).toContain("skeletonizer/lite");
    expect(JSON.parse(await runNode(code("production")))).toEqual([]);
  });

  it("适配层没导入实现时：开发模式报错（console.warn 一次，不抛），生产模式静默", async () => {
    const code = (env: string): string =>
      `process.env.NODE_ENV = "${env}"; const warns = []; console.warn = (m) => warns.push(String(m)); const { vSkeleton } = await import("skeletonizer/vue"); const el = {}; vSkeleton.mounted(el, { value: true }); vSkeleton.updated(el, { value: false }); console.log(JSON.stringify(warns));`;
    const dev = JSON.parse(await runNode(code("development"))) as string[];
    expect(dev).toHaveLength(1);
    expect(dev[0]).toContain("skeletonizer/lite");
    expect(JSON.parse(await runNode(code("production")))).toEqual([]);
  });
});

describe("打包器（vite）构建浏览器产物", () => {
  /** 一个构建场景：入口代码 + 对产物的断言 */
  interface Fixture {
    /** 用例标题 */
    title: string;
    /** 入口 main.js 的内容 */
    source: string;
    /** 构建时的 NODE_ENV，默认 production */
    env?: string;
    /** 断言产物里的 CSS / JS 文本 */
    check(out: { css: string; js: string }): void;
  }

  /** 开发警告里的特征文案（分别来自 adapter-api、core/global、full/engine） */
  const DEV_WARN_TEXTS = ["No implementation found", "is already taken", "No scheme is registered"];

  /** 构建场景表：各场景用独立的临时目录，beforeAll 里并发构建 */
  const FIXTURES: Fixture[] = [
    {
      title: "import 'skeletonizer'（完整版）：产物带 full.css 的样式，也带完整版运行时",
      source: `import { enable } from "skeletonizer";\nenable(document.getElementById("a"), { effect: "shimmer", text: "leaf" });\n`,
      check: ({ css, js }) => {
        expect(css).toContain("[skz]");
        expect(css).toContain("skz-shimmer-root");
        expect(css).not.toContain("skz-sweep");
        expect(js).toContain(CORE_MARK);
        expect(js).toContain("skz-text-mode");
      },
    },
    {
      title: "import 'skeletonizer/lite'：产物带 lite.css 的样式，不带完整版的东西",
      source: `import { enable } from "skeletonizer/lite";\nenable(document.getElementById("a"));\n`,
      check: ({ css, js }) => {
        expect(css).toContain("[skz]");
        expect(css).toContain("skz-bone");
        expect(css).not.toContain("skz-sweep");
        expect(css).not.toMatch(/skz-paused/);
        expect(js).toContain(CORE_MARK);
        expect(js).not.toContain("skz-text-mode");
      },
    },
    {
      title: "完整版 + 适配层：只有一份 core（适配层不再内联第二份）",
      source: `import "skeletonizer";\nimport { skeleton } from "skeletonizer/svelte";\nskeleton(document.getElementById("a"), { loading: true });\n`,
      check: ({ js }) => {
        expect(js.split(CORE_MARK).length - 1).toBe(1);
      },
    },
    {
      title: "lite + element：只有一份 core，<skz-box> 来自 element 入口",
      source: `import "skeletonizer/lite";
import { defineSkzBox } from "skeletonizer/element";
defineSkzBox();
`,
      check: ({ js }) => {
        expect(js.split(CORE_MARK).length - 1).toBe(1);
        expect(js).toContain("skz-box");
      },
    },
    {
      title: "导入 element 但不调用：无副作用，整个模块被摇掉（产物里没有 <skz-box> 的实现）",
      source: `import { defineSkzBox } from "skeletonizer/element";
void defineSkzBox;
console.log(document.getElementById("a"));
`,
      check: ({ js }) => {
        expect(js).not.toContain("skz-box");
        expect(js).not.toContain("loading");
      },
    },
    {
      title: "生产构建（NODE_ENV=production）：任何入口的产物里都没有开发警告文案和 console.warn（调用点被折叠）",
      source: `import "skeletonizer";
import "skeletonizer/lite";
import { skeleton } from "skeletonizer/svelte";
import { enable } from "skeletonizer";
skeleton(document.getElementById("a"), { loading: true });
enable(document.getElementById("a"), { engine: "svg" });
`,
      check: ({ js }) => {
        for (const text of DEV_WARN_TEXTS) expect(js).not.toContain(text);
        expect(js).not.toContain("console.warn");
      },
    },
    {
      title: "开发构建（NODE_ENV=development）：开发警告仍保留在产物里",
      env: "development",
      source: `import "skeletonizer";
import { skeleton } from "skeletonizer/svelte";
skeleton(document.getElementById("a"), { loading: true });
`,
      check: ({ js }) => {
        for (const text of DEV_WARN_TEXTS) expect(js).toContain(text);
      },
    },
  ];

  /** 各场景的构建产物 */
  const built: Array<{ css: string; js: string }> = [];

  /**
   * 建一个临时 fixture（node_modules/skeletonizer 链到包根，等同于真正安装），用入口代码 build，返回产物里的 CSS 与 JS 文本
   * @param source 入口 main.js 的内容
   * @param env 构建时的 NODE_ENV
   * @returns CSS 与 JS 文本（没有 CSS 资源时 css 为空串）
   */
  async function bundle(source: string, env = "production"): Promise<{ css: string; js: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skz-fixture-"));
    try {
      fs.mkdirSync(path.join(dir, "node_modules"));
      fs.symlinkSync(ROOT, path.join(dir, "node_modules/skeletonizer"), "junction");
      // vp 要求 cwd 是带 package.json 的包，否则报 Package not found in workspace
      fs.writeFileSync(path.join(dir, "package.json"), `{"name":"skz-fixture","private":true,"type":"module"}`);
      fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><body><div id="a"></div><script type="module" src="./main.js"></script></body></html>`);
      fs.writeFileSync(path.join(dir, "main.js"), source);
      await execAsync(`"${VP}" build`, { cwd: dir, env: { ...process.env, NODE_ENV: env } });
      const assets = path.join(dir, "dist/assets");
      const read = (ext: string): string =>
        fs
          .readdirSync(assets)
          .filter((f) => f.endsWith(ext))
          .map((f) => fs.readFileSync(path.join(assets, f), "utf8"))
          .join("\n");
      return { css: read(".css"), js: read(".js") };
    } finally {
      // 先单独摘掉指向包根的链接，确认摘掉了才递归清目录，绝不能顺着链接删到包根。
      // unlink 只删链接本身（Linux / macOS 上 rmdir 对 symlink 会抛 ENOTDIR），失败再退回 rmdir（Windows junction）
      const link = path.join(dir, "node_modules/skeletonizer");
      try {
        fs.unlinkSync(link);
      } catch {
        try {
          fs.rmdirSync(link);
        } catch {
          // 链接没建成功或已摘掉
        }
      }
      if (!fs.existsSync(link)) fs.rmSync(dir, { force: true, recursive: true });
    }
  }

  beforeAll(async () => {
    built.push(...(await Promise.all(FIXTURES.map((f) => bundle(f.source, f.env)))));
  }, 120_000);

  FIXTURES.forEach((f, i) => it(f.title, () => f.check(built[i]!)));
});
