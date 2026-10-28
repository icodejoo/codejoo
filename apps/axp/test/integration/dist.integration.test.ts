import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/* 本文件验证发布产物 dist，而不是 src：
 * - dist 缺失或比 src / vite.config.ts / package.json 旧时，先 `npm run build` 再测。
 *   不选“缺失就跳过”：跳过会让 CI 在没构建产物时假绿，而产物（exports、类型增强）恰恰是最容易悄悄坏掉的一环；
 *   也不选“每次都重建”：新鲜的产物直接复用，省几秒且不会打断正在用 dist 的其它进程。
 * - 消费方程序放在临时目录，通过 node_modules 联接指向本包，只经 package.json exports 解析，完全不碰 src。 */

/** 包根目录（apps/axp）。 */
const PKG_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
/** 包名，消费方 import 时使用。 */
const PKG_NAME = "@codejoo/axp";
/** 单文件压缩版的子路径。 */
const MIN_SUBPATH = "./min";
/** package.json 本身的子路径，不是可导入模块。 */
const PACKAGE_JSON_SUBPATH = "./package.json";
/** 对外公开的插件子路径名，应与 package.json 的 exports 一一对应。 */
const PLUGIN_NAMES = ["auth", "cache", "envs", "filter", "loading", "mock", "notify", "repath", "retry", "share"];
/** 预期的 exports 全集：根入口、压缩版、十个插件、package.json。 */
const EXPECTED_SUBPATHS = [".", MIN_SUBPATH, ...PLUGIN_NAMES.map((name) => `./${name}`), PACKAGE_JSON_SUBPATH];
/** 没有请求级选项（不写 declare module 扩展）的插件。 */
const PLUGINS_WITHOUT_REQUEST_OPTIONS = ["envs"];
/** 只在插件子路径导出、根入口没有的名字（内部算法的测试挂钩，文档未承诺）；新增泄漏会让测试失败，需要显式决定。 */
const SUBPATH_ONLY_EXPORTS: Record<string, string[]> = {
  "./cache": ["$defaultShouldCache", "$resolveCloneFn", "$shallowClone"],
  "./filter": ["$filter", "defaultPredicate"],
  "./mock": ["$rewriteUrl", "$shouldFallback"],
};
/** 已删除的旧子路径，不允许再出现。 */
const REMOVED_SUBPATHS = ["./cancel", "./key", "./logger", "./normalize"];
/** 插件目录下只作内部依赖、不对外暴露的算法模块（不带扩展名）。 */
const INTERNAL_PLUGIN_FILES = ["auth-match", "cache-store", "retry-timing"];
/** 内部模块也不应该能从包外导入。 */
const INTERNAL_SUBPATHS = INTERNAL_PLUGIN_FILES.map((name) => `./${name}`);
/** Node 对 exports 未声明路径的错误码。 */
const NOT_EXPORTED = "ERR_PACKAGE_PATH_NOT_EXPORTED";
/** 单个构建 / 类型检查步骤的超时（毫秒）；机器忙时构建可能很慢。 */
const SLOW_STEP_TIMEOUT = 300_000;
/** 参与新鲜度判断的产物，取其中最旧的修改时间。 */
const DIST_PROBES = ["dist/esm/index.mjs", "dist/esm/index.d.mts", "dist/index.min.js"];
/** 影响产物内容的构建输入文件（src 目录另行递归比较）。 */
const BUILD_INPUTS = ["vite.config.ts", "package.json", "tsconfig.build.json"];

/** 解析后的 package.json 的最小形状。 */
interface IPackageJson {
  /** 入口映射。 */
  exports: Record<string, unknown>;
  /** CJS/旧工具入口。 */
  main: string;
  /** 打包器入口。 */
  module: string;
  /** 旧式类型入口。 */
  types: string;
}

/** 探针子进程汇总的运行时观察结果。 */
interface IProbe {
  /** 每个可导入子路径的导出名。 */
  exports: Record<string, string[]>;
  /** 不应公开的子路径导入结果，值为错误码。 */
  rejected: Record<string, string>;
  /** 子路径导出里，根入口也导出、但不是同一引用的名字（default 对应根入口的 axpXxx）。 */
  mismatched: Record<string, string[]>;
  /** 只有子路径导出、根入口没有的名字。 */
  subpathOnly: Record<string, string[]>;
  /** min 与根入口混用的识别结果。 */
  mixed: {
    /** 两个入口的响应品牌是否同一个 Symbol。 */
    brandShared: boolean;
    /** 根入口识别 min 产出的 成功、失败 响应。 */
    rootSeesMin: [boolean, boolean];
    /** min 识别根入口产出的 成功、失败 响应。 */
    minSeesRoot: [boolean, boolean];
    /** 客户端的 isResponse 识别对方产出的失败响应。 */
    clientSeesOther: [boolean, boolean];
    /** 非响应值不被误认。 */
    rejectsNonResponses: [boolean, boolean, boolean];
    /** 四个响应的 kind：根成功、根失败、min 成功、min 失败。 */
    kinds: string[];
  };
}

/** 读取并解析包清单。 */
function readPackage(): IPackageJson {
  const pkg: IPackageJson = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
  return pkg;
}

/** 递归收集 exports 条件对象里全部字符串目标。
 * @param value exports 的某个节点。
 * @returns 全部目标路径，保持出现顺序。
 * @example `collectTargets({ import: "./a.mjs", types: "./a.d.mts" }) // ["./a.mjs", "./a.d.mts"]`
 */
function collectTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(collectTargets);
  return [];
}

/** 递归取目录下最新的修改时间。
 * @param dir 目录绝对路径。
 * @returns 毫秒时间戳，空目录为 0。
 */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs);
  }
  return newest;
}

/** 产物是否齐全且不比源码旧。 */
function distIsFresh(): boolean {
  const outputs = DIST_PROBES.map((file) => join(PKG_ROOT, file));
  if (!outputs.every((file) => existsSync(file))) return false;
  const built = Math.min(...outputs.map((file) => statSync(file).mtimeMs));
  const sources = Math.max(newestMtime(join(PKG_ROOT, "src")), ...BUILD_INPUTS.map((file) => statSync(join(PKG_ROOT, file)).mtimeMs));
  return built >= sources;
}

/** 确保 dist 可用；不新鲜时执行 package.json 的 build 脚本，失败时带上构建输出抛错。 */
function ensureDist(): void {
  if (distIsFresh()) return;
  const build = spawnSync("npm run build", { cwd: PKG_ROOT, shell: true, encoding: "utf8", timeout: SLOW_STEP_TIMEOUT });
  if (build.status !== 0) throw new Error(`构建 dist 失败（退出码 ${build.status}）：\n${build.stdout}\n${build.stderr}`);
}

/** 按类型生成消费方 tsconfig，`skipLibCheck: false` 让产物声明自身的错误也暴露。
 * @param module tsconfig 的 module。
 * @param moduleResolution tsconfig 的 moduleResolution。
 * @returns tsconfig 文本。
 */
function consumerTsconfig(module: string, moduleResolution: string): string {
  return JSON.stringify({
    compilerOptions: { module, moduleResolution, target: "es2022", strict: true, noEmit: true, skipLibCheck: false, types: [] },
    files: ["index.ts"],
  });
}

/** 消费方 TypeScript 程序：只经包名导入；`@ts-expect-error` 的行必须真的报错，否则 tsgo 报“未使用的指令”。 */
const CONSUMER_SOURCE = `
import axios from "axios";
import { createAxp, isAxpResponse, axpAuth, axpCache, axpEnvs, axpFilter, axpLoading, axpMock, axpNotify, axpRepath, axpRetry, axpShare } from "@codejoo/axp";
import type { AxpResponse, AxpRequestConfig, IAxpResponse, WithData } from "@codejoo/axp";
import authSub from "@codejoo/axp/auth";
import cacheSub from "@codejoo/axp/cache";
import envsSub from "@codejoo/axp/envs";
import filterSub from "@codejoo/axp/filter";
import loadingSub from "@codejoo/axp/loading";
import mockSub from "@codejoo/axp/mock";
import notifySub from "@codejoo/axp/notify";
import repathSub from "@codejoo/axp/repath";
import retrySub from "@codejoo/axp/retry";
import shareSub from "@codejoo/axp/share";
import { createAxp as createMinAxp, isAxpResponse as isMinResponse } from "@codejoo/axp/min";

/** 第三方插件按文档用包名扩展请求选项。 */
declare module "@codejoo/axp" {
  interface AxpRequestOptions {
    /** 自定义追踪标签。 */
    traceTag?: string;
  }
}

/** 编译期断言两个类型完全一致。 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const api = createAxp({ axios: axios.create(), plugins: [axpRetry({ max: 1 }), axpCache()] });

// ── 插件请求选项的类型增强（发布产物曾在这里整体失效）──
api.get("/x")({}, { retry: 2, cache: true });
api.get("/x")({}, { retry: { max: 3, delay: 100 }, cache: 1000, share: "race", loading: true, notify: false, repath: false, filter: false, mock: false, protected: true, traceTag: "a" });
api.post("/x")({}, { retry: false, cache: { expires: 1 }, share: { policy: "end" } });
api.request({ url: "/x", method: "get", timeout: 100, signal: new AbortController().signal, retry: 1 });
// @ts-expect-error retry 只接受数字、布尔或选项对象
api.get("/x")({}, { retry: "twice" });
// @ts-expect-error cache 不接受字符串
api.get("/x")({}, { cache: "yes" });
// @ts-expect-error share 策略名只有 start / end / race
api.get("/x")({}, { share: "middle" });
// @ts-expect-error 未声明的请求选项
api.get("/x")({}, { nonsense: true });
// @ts-expect-error cancelToken 已移除，统一用 signal
api.request({ url: "/x", cancelToken: {} });
// @ts-expect-error signal 必须是标准 AbortSignal
api.request({ url: "/x", signal: {} });
// @ts-expect-error 自定义扩展字段的类型同样生效
api.get("/x")({}, { traceTag: 1 });
const config: AxpRequestConfig = { url: "/x", baseURL: "/api", headers: { a: "b" }, timeout: 1, retry: 1 };

// ── 根入口与插件子路径是同一份类型 ──
const sameAuth: typeof axpAuth = authSub;
const sameCache: typeof axpCache = cacheSub;
const sameEnvs: typeof axpEnvs = envsSub;
const sameFilter: typeof axpFilter = filterSub;
const sameLoading: typeof axpLoading = loadingSub;
const sameMock: typeof axpMock = mockSub;
const sameNotify: typeof axpNotify = notifySub;
const sameRepath: typeof axpRepath = repathSub;
const sameRetry: typeof axpRetry = retrySub;
const sameShare: typeof axpShare = shareSub;

// ── Schema 推断与返回形态 ──
interface ISchema {
  get: { "/pet/{id}": readonly [response: { name: string }, request: readonly [{ id: number }]] };
}
const typed = createAxp<ISchema>();
const pet = typed.get("/pet/{id}")({ id: 1 });
const petIsTyped: Equal<typeof pet, Promise<{ name: string }>> = true;
// @ts-expect-error 路径不在 Schema 里
typed.get("/nope");
const wrapped = api.get("/x")<number>(undefined, { wrap: true });
const wrappedIsTyped: Equal<typeof wrapped, Promise<WithData<AxpResponse, number>>> = true;

// ── 响应识别 ──
declare const caught: unknown;
if (isAxpResponse(caught)) {
  const kind: string = caught.kind;
  const ok: boolean = caught.ok;
  const base: IAxpResponse = caught;
}
if (api.isResponse(caught)) {
  const status: number | undefined = caught.status;
}

// ── 压缩版入口的类型与根入口一致 ──
createMinAxp().get("/x")({}, { retry: 2, cache: true });
const minNarrows: boolean = isMinResponse(caught);

export { config, sameAuth, sameCache, sameEnvs, sameFilter, sameLoading, sameMock, sameNotify, sameRepath, sameRetry, sameShare, petIsTyped, wrappedIsTyped, minNarrows };
`;

/** 运行时探针：在消费方目录里用真正的 Node 解析 exports 并导入，把观察结果以 JSON 打印。参数 argv[2] 是 { importable, blocked }。 */
const PROBE_SOURCE = `
import axios from "axios";

const PKG = "${PKG_NAME}";
const config = JSON.parse(process.argv[2]);
/** 子路径转成包说明符。 */
const specifier = (sub) => (sub === "." ? PKG : PKG + sub.slice(1));

const result = { exports: {}, rejected: {}, mismatched: {}, subpathOnly: {}, mixed: {} };
const modules = {};
for (const sub of config.importable) {
  modules[sub] = await import(specifier(sub));
  result.exports[sub] = Object.keys(modules[sub]).sort();
}
for (const sub of config.blocked) {
  try {
    await import(specifier(sub));
    result.rejected[sub] = "imported";
  } catch (error) {
    result.rejected[sub] = error.code ?? String(error);
  }
}

const root = modules["."];
const min = modules["${MIN_SUBPATH}"];
for (const sub of config.importable) {
  if (sub === "." || sub === "${MIN_SUBPATH}") continue;
  const rootName = (key) => (key === "default" ? "axp" + sub[2].toUpperCase() + sub.slice(3) : key);
  const keys = Object.keys(modules[sub]);
  result.subpathOnly[sub] = keys.filter((key) => !(rootName(key) in root)).sort();
  result.mismatched[sub] = keys.filter((key) => rootName(key) in root && root[rootName(key)] !== modules[sub][key]);
}

const okAdapter = async (config) => ({ data: { value: 1 }, status: 200, statusText: "OK", headers: {}, config });
const failAdapter = async (config) => {
  throw new axios.AxiosError("offline", "ERR_NETWORK", config);
};
const make = (mod, adapter) => mod.createAxp({ axios: axios.create({ adapter }) });
const rootApi = make(root, failAdapter);
const minApi = make(min, failAdapter);
const rootOk = await make(root, okAdapter).get("/x")(undefined, { wrap: true });
const minOk = await make(min, okAdapter).get("/x")(undefined, { wrap: true });
const rootFail = await rootApi.get("/x")(undefined, { throws: false });
const minFail = await minApi.get("/x")(undefined, { throws: false });
result.mixed = {
  brandShared: root.AXP_RESPONSE === min.AXP_RESPONSE,
  rootSeesMin: [root.isAxpResponse(minOk), root.isAxpResponse(minFail)],
  minSeesRoot: [min.isAxpResponse(rootOk), min.isAxpResponse(rootFail)],
  clientSeesOther: [rootApi.isResponse(minFail), minApi.isResponse(rootFail)],
  rejectsNonResponses: [root.isAxpResponse({}), min.isAxpResponse(new Error("x")), root.isAxpResponse(null)],
  kinds: [rootOk.kind, rootFail.kind, minOk.kind, minFail.kind],
};
console.log(JSON.stringify(result));
`;

/** 临时消费方目录，beforeAll 创建、afterAll 删除。 */
let consumerDir = "";
/** 运行时探针结果。 */
let probe: IProbe;

/** 创建只依赖本包产物的消费方目录：联接 node_modules 里的本包与 axios，写入程序与两份 tsconfig。
 * @returns 临时目录绝对路径。
 */
function createConsumer(): string {
  const dir = mkdtempSync(join(tmpdir(), "axp-dist-"));
  const axiosRoot = realpathSync(dirname(createRequire(import.meta.url).resolve("axios/package.json")));
  mkdirSync(join(dir, "node_modules", "@codejoo"), { recursive: true });
  // junction 在 Windows 上无需管理员权限，其它平台等同普通符号链接
  symlinkSync(PKG_ROOT, join(dir, "node_modules", "@codejoo", "axp"), "junction");
  symlinkSync(axiosRoot, join(dir, "node_modules", "axios"), "junction");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(dir, "index.ts"), CONSUMER_SOURCE);
  writeFileSync(join(dir, "probe.mjs"), PROBE_SOURCE);
  writeFileSync(join(dir, "tsconfig.nodenext.json"), consumerTsconfig("nodenext", "nodenext"));
  writeFileSync(join(dir, "tsconfig.bundler.json"), consumerTsconfig("esnext", "bundler"));
  return dir;
}

/** 在消费方目录用 tsgo 检查程序。
 * @param tsconfig 消费方目录里的 tsconfig 文件名。
 * @returns 退出码与合并后的输出。
 */
function typecheckConsumer(tsconfig: string): { status: number | null; output: string } {
  const tsgo = join(dirname(createRequire(import.meta.url).resolve("@typescript/native-preview/package.json")), "bin", "tsgo.js");
  const run = spawnSync(process.execPath, [tsgo, "-p", tsconfig], { cwd: consumerDir, encoding: "utf8", timeout: SLOW_STEP_TIMEOUT });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

beforeAll(
  /** 准备产物、消费方目录并跑一次运行时探针。 */ () => {
    ensureDist();
    consumerDir = createConsumer();
    const importable = EXPECTED_SUBPATHS.filter((sub) => sub !== PACKAGE_JSON_SUBPATH);
    const args = JSON.stringify({ importable, blocked: [...REMOVED_SUBPATHS, ...INTERNAL_SUBPATHS] });
    const observed: IProbe = JSON.parse(execFileSync(process.execPath, ["probe.mjs", args], { cwd: consumerDir, encoding: "utf8", timeout: SLOW_STEP_TIMEOUT }));
    probe = observed;
  },
  SLOW_STEP_TIMEOUT,
);

afterAll(
  /** 清理临时目录；联接只删链接本身，不会波及包目录。 */ () => {
    if (consumerDir) rmSync(consumerDir, { recursive: true, force: true });
  },
);

describe("dist 产物", () => {
  it("[dist.const.exports] exports 恰为根入口、压缩版、十个插件与 package.json", /** 公开子路径清单变化必须显式改这里。 */ () => {
    expect(Object.keys(readPackage().exports).toSorted()).toEqual(EXPECTED_SUBPATHS.toSorted());
  });

  it("[dist.const.targets] exports、main、module、types 指向的文件都存在", /** 包括 types 条件对应的声明文件。 */ () => {
    const pkg = readPackage();
    const targets = [...collectTargets(pkg.exports), pkg.main, pkg.module, pkg.types];
    expect(targets.length).toBeGreaterThan(EXPECTED_SUBPATHS.length);
    expect(targets.filter((target) => !existsSync(join(PKG_ROOT, target)))).toEqual([]);
  });

  it("[dist.const.import] 每个子路径都能被 Node 按 exports 实际导入，且导出非空", /** 根入口导出内核，插件子路径默认导出工厂函数。 */ () => {
    for (const sub of EXPECTED_SUBPATHS.filter((name) => name !== PACKAGE_JSON_SUBPATH)) expect(probe.exports[sub], sub).not.toHaveLength(0);
    expect(probe.exports["."]).toEqual(expect.arrayContaining(["createAxp", "isAxpResponse", "axpRetry", "TokenManager"]));
    expect(probe.exports[MIN_SUBPATH]).toEqual(expect.arrayContaining(["createAxp", "isAxpResponse"]));
    for (const name of PLUGIN_NAMES) expect(probe.exports[`./${name}`], name).toContain("default");
  });

  it("[dist.const.removed] 已删除的子路径不在 exports 里、无产物文件，导入报 ERR_PACKAGE_PATH_NOT_EXPORTED", /** cancel、key、logger、normalize 已并入内核。 */ () => {
    const { exports } = readPackage();
    for (const sub of REMOVED_SUBPATHS) {
      expect(exports, sub).not.toHaveProperty([sub]);
      expect(existsSync(join(PKG_ROOT, "dist", "esm", "plugins", `${sub.slice(2)}.mjs`)), sub).toBe(false);
      expect(probe.rejected[sub], sub).toBe(NOT_EXPORTED);
    }
  });

  it("[dist.const.internal] 插件目录里只有三个内部算法模块不对外：不在 exports、不可导入", /** 新增插件文件却忘了写 exports 时在这里被发现。 */ () => {
    const exposed = new Set(collectTargets(readPackage().exports).map((target) => target.replace(/^\.\/dist\/esm\/plugins\//, "").replace(/\.(d\.mts|mjs)$/, "")));
    const emitted = [...new Set(readdirSync(join(PKG_ROOT, "dist", "esm", "plugins")).map((file) => file.replace(/\.(d\.mts|mjs)$/, "")))];
    expect(emitted.filter((name) => !exposed.has(name)).toSorted()).toEqual(INTERNAL_PLUGIN_FILES);
    for (const sub of INTERNAL_SUBPATHS) expect(probe.rejected[sub], sub).toBe(NOT_EXPORTED);
  });

  it("[dist.const.instance] 子路径与根入口共有的导出是同一引用（没有两份模块实例），子路径独有的只有已登记的内部挂钩", /** default 对应根入口的 axpXxx。 */ () => {
    for (const name of PLUGIN_NAMES) {
      expect(probe.mismatched[`./${name}`], `${name} 与根入口不是同一引用`).toEqual([]);
      expect(probe.subpathOnly[`./${name}`], `${name} 出现未登记的子路径独有导出`).toEqual(SUBPATH_ONLY_EXPORTS[`./${name}`] ?? []);
    }
  });

  it("[dist.fn.isAxpResponse] ./min 与根入口混用：互相识别对方产出的成功与失败响应，不误认非响应", /** 品牌是 Symbol.for，跨模块副本可识别。 */ () => {
    const { mixed } = probe;
    expect(mixed.brandShared).toBe(true);
    expect(mixed.rootSeesMin).toEqual([true, true]);
    expect(mixed.minSeesRoot).toEqual([true, true]);
    expect(mixed.clientSeesOther).toEqual([true, true]);
    expect(mixed.rejectsNonResponses).toEqual([false, false, false]);
    expect(mixed.kinds).toEqual(["ok", "network", "ok", "network"]);
  });

  it("[dist.const.augmentation] 声明产物里 declare module 的相对说明符都指向真实存在的 .d.mts", /** 回归：说明符曾缺 .mjs，类型增强整体失效。 */ () => {
    const root = join(PKG_ROOT, "dist", "esm");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".d.mts"));
    let found = 0;
    for (const file of files) {
      for (const [, specifier] of readFileSync(join(root, file), "utf8").matchAll(/declare module "(\.[^"]+)"/g)) {
        found += 1;
        expect(specifier, `${file} 的 declare module 缺扩展名`).toMatch(/\.mjs$/);
        expect(existsSync(join(root, dirname(file), specifier.replace(/\.mjs$/, ".d.mts"))), `${file} -> ${specifier}`).toBe(true);
      }
    }
    expect(found).toBe(PLUGIN_NAMES.length - PLUGINS_WITHOUT_REQUEST_OPTIONS.length);
  });

  it(
    "[dist.type.nodenext] nodenext 消费方：请求选项增强生效、错误写法报错、skipLibCheck 关闭时产物声明本身无错",
    /** 临时 TS 程序只经包名导入 dist。 */ () => {
      const { status, output } = typecheckConsumer("tsconfig.nodenext.json");
      expect(output.trim()).toBe("");
      expect(status).toBe(0);
    },
    SLOW_STEP_TIMEOUT,
  );

  it(
    "[dist.type.bundler] bundler 消费方：同一份程序同样通过",
    /** moduleResolution: bundler。 */ () => {
      const { status, output } = typecheckConsumer("tsconfig.bundler.json");
      expect(output.trim()).toBe("");
      expect(status).toBe(0);
    },
    SLOW_STEP_TIMEOUT,
  );
});
