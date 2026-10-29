import { create as createAxios } from "axios";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, expectTypeOf, it } from "vitest";
import { createAxp as createAxpDirect } from "../../src/client";
import * as entry from "../../src/index";
import type {
  AxpClient,
  AxpContext,
  AxpFailureType,
  AxpMiddleware,
  AxpNext,
  AxpOptions,
  AxpPlugin,
  AxpPluginInstance,
  AxpRequestConfig,
  AxpRequestOptions,
  AxpRequestPatch,
  AxpResponseInit,
  AxpStage,
  AxpStateKey,
  AxpTap,
  IAuthOptions,
  IAxpCacheEntry,
  IAxpCacheStore,
  IAxpCacheSnapshot,
  MaybePromise,
  IAxpFailure,
  IAxpResponse,
  IAxpResponseFactory,
  IAxpResponseOptions,
  ICacheApi,
  ICacheOptions,
  ICacheRequestOptions,
  IEnvOptions,
  IEnvRule,
  IEnvsOptions,
  IFilterOptions,
  IKeyOptions,
  ILoadingOptions,
  IMockOptions,
  IMockRequestOptions,
  INotifyOptions,
  IRepathOptions,
  IRetryOptions,
  ISharedOptions,
  ISharedRequestOptions,
  ITokenManager,
  TAuthFunc,
  TCloneStrategy,
  TLoadingFunc,
  TMockFallback,
  TPredicate,
  TRetryDelay,
  TRetryJitter,
  TShouldRetry,
  SharePolicy,
  WithData,
  WithNative,
} from "../../src/index";
import axpAuth, { AuthFailureAction, defaultAuthFailure } from "../../src/plugins/auth";
import axpCache, { clearCache, removeCache } from "../../src/plugins/cache";
import axpEnvs from "../../src/plugins/envs";
import axpFilter from "../../src/plugins/filter";
import axpLoading from "../../src/plugins/loading";
import axpMock from "../../src/plugins/mock";
import axpNotify from "../../src/plugins/notify";
import axpRepath from "../../src/plugins/repath";
import axpRetry from "../../src/plugins/retry";
import axpShare from "../../src/plugins/share";
import { AXP_FAILURE, AXP_FAILURES, AXP_RESPONSE, AxpResponse, axpResponse, failureOf, isAxpCancel, isAxpResponse, nativeOf } from "../../src/response";
import { stateKey } from "../../src/context";
import TokenManager from "../../src/objects/TokenManager";

/** 文档规定对用户公开的运行时导出（core-architecture §2、plugin-spec、README）。 */
const PUBLIC_VALUES = [
  "AXP_FAILURE",
  "AXP_FAILURES",
  "AXP_RESPONSE",
  "AuthFailureAction",
  "AxpResponse",
  "TokenManager",
  "axpAuth",
  "axpCache",
  "axpEnvs",
  "axpFilter",
  "axpLoading",
  "axpMock",
  "axpNotify",
  "axpRepath",
  "axpResponse",
  "axpRetry",
  "axpShare",
  "clearCache",
  "createAxp",
  "defaultAuthFailure",
  "failureOf",
  "isAxpCancel",
  "isAxpResponse",
  "nativeOf",
  "removeCache",
  "stateKey",
];
/** 已随洋葱管线删除、不得再从入口导出的旧名字。 */
const REMOVED_NAMES = new Set(["Axp", "Core", "ApiError", "axpCancel", "axpKey", "axpLogger", "axpNormalize", "cancelAll", "pluginLog", "pluginWarn", "pluginError"]);
/** 入口里各名字应与源文件是同一个引用。 */
const IDENTITIES: Array<[keyof typeof entry, unknown]> = [
  ["createAxp", createAxpDirect],
  ["AxpResponse", AxpResponse],
  ["axpResponse", axpResponse],
  ["isAxpResponse", isAxpResponse],
  ["nativeOf", nativeOf],
  ["AXP_FAILURE", AXP_FAILURE],
  ["AXP_FAILURES", AXP_FAILURES],
  ["failureOf", failureOf],
  ["isAxpCancel", isAxpCancel],
  ["AXP_RESPONSE", AXP_RESPONSE],
  ["stateKey", stateKey],
  ["TokenManager", TokenManager],
  ["axpLoading", axpLoading],
  ["axpNotify", axpNotify],
  ["axpRepath", axpRepath],
  ["axpFilter", axpFilter],
  ["axpEnvs", axpEnvs],
  ["axpRetry", axpRetry],
  ["axpAuth", axpAuth],
  ["AuthFailureAction", AuthFailureAction],
  ["defaultAuthFailure", defaultAuthFailure],
  ["axpMock", axpMock],
  ["axpShare", axpShare],
  ["axpCache", axpCache],
  ["removeCache", removeCache],
  ["clearCache", clearCache],
];
/** 插件源码目录。 */
const PLUGINS_DIR = fileURLToPath(new URL("../../src/plugins/", import.meta.url));
/** 入口源码。 */
const INDEX_SOURCE = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
/** 让每个 axios 请求立即得到固定信封的传输。 */
const adapter = /** 固定 200 信封。 */ async (config: any) => ({
  data: { code: 0, data: "pong", message: "" },
  status: 200,
  statusText: "OK",
  headers: {},
  config,
});

it("[index.const.exports] 入口的运行时导出与文档公开清单一致", /** 多导或漏导都会失败。 */ () => {
  expect(Object.keys(entry).toSorted()).toEqual(PUBLIC_VALUES);
});

it("[index.const.internal] `$` 前缀内部函数与已删除的旧名字不从入口导出", /** 内部测试钩子与旧 API 不进公开面。 */ () => {
  const names = Object.keys(entry);
  expect(names.filter((name) => name.startsWith("$"))).toEqual([]);
  expect(names.filter((name) => REMOVED_NAMES.has(name))).toEqual([]);
});

it.each(IDENTITIES)(
  "[index.const.identity] 入口的 %s 与源文件是同一个引用",
  /** 防止入口重导出时指错文件或套了一层。 */ (name, source) => {
    expect(entry[name]).toBe(source);
  },
);

it("[index.fn.createAxp] 入口的内置插件可直接装配，inspect 按阶段与内置次序排列", /** 公开面串起一个真实客户端。 */ async () => {
  const tokenManager = new entry.TokenManager();
  tokenManager.set("access");
  const api = entry.createAxp({
    axios: createAxios({ adapter }),
    plugins: [
      entry.axpCache(),
      entry.axpShare(),
      entry.axpMock({ enable: true }),
      entry.axpAuth({ tokenManager, onRefresh: () => false, onAccessExpired: () => {} }),
      entry.axpRetry(),
      entry.axpFilter(),
      entry.axpRepath(),
      entry.axpNotify({ notify: () => {}, stringify: () => null }),
      entry.axpLoading(),
      entry.axpEnvs([]),
    ],
  });
  expect(api.inspect().map((item) => `${item.stage}:${item.name}`)).toEqual([
    "outer:axp:loading",
    "outer:axp:notify",
    "prepare:axp:repath",
    "prepare:axp:filter",
    "attempt:axp:retry",
    "credential:axp:auth",
    "source:axp:mock",
    "source:axp:share",
    "source:axp:cache",
  ]);
  expect(await api.get("/ping")()).toBe("pong");
  expect(entry.removeCache(api, "none")).toBe(false);
  expect(entry.clearCache(api)).toBe(0);
});

it("[index.fn.isAxpResponse] 入口创建的客户端抛出的失败是入口导出的 AxpResponse", /** 品牌与类别常量同源。 */ async () => {
  const api = entry.createAxp({
    axios: createAxios({
      adapter: /** 固定 500。 */ async (config) => ({
        data: "boom",
        status: 500,
        statusText: "ERR",
        headers: {},
        config,
      }),
    }),
  });
  const failure = await api
    .get("/boom")()
    .catch(/** 取出被抛出的响应。 */ (e: unknown) => e);
  expect(entry.isAxpResponse(failure)).toBe(true);
  expect(failure).toBeInstanceOf(entry.AxpResponse);
  expect((failure as IAxpResponse).ok).toBe(false);
  expect((failure as IAxpResponse).status).toBe(500);
  expect(entry.failureOf(failure)).toBeUndefined();
});

it("[index.fn.stateKey] 状态键从入口导出且同描述互不相等", /** 类型化 Symbol 键。 */ () => {
  const a = entry.stateKey<number>("same");
  const b = entry.stateKey<number>("same");
  expect(typeof a).toBe("symbol");
  expect(a).not.toBe(b);
});

it("[index.const.augmentation] 带 declare module 扩展的插件文件都由入口引入", /** 扩展随插件文件进入程序，请求级选项类型才会生效。 */ () => {
  const source = readFileSync(INDEX_SOURCE, "utf8");
  const augmenting = readdirSync(PLUGINS_DIR)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => readFileSync(`${PLUGINS_DIR}${file}`, "utf8").includes('declare module "../types"'))
    .map((file) => file.replace(/\.ts$/, ""));
  expect(augmenting.toSorted()).toEqual(["auth", "cache", "filter", "loading", "mock", "notify", "repath", "retry", "share"].toSorted());
  for (const name of augmenting) expect(source).toContain(`from "./plugins/${name}"`);
});

it("[index.type.exports] 入口的类型导出齐全，AuthFailureAction 同名值与类型并存", /** 仅编译：名字被删或漏导出会让 tsgo 报错。 */ () => {
  /** 逐个引用入口导出的类型。 */
  type Surface = [
    AxpClient,
    AxpContext,
    AxpFailureType,
    AxpMiddleware,
    AxpNext,
    AxpOptions,
    AxpPlugin,
    AxpPluginInstance,
    AxpRequestConfig,
    AxpRequestOptions,
    AxpRequestPatch,
    AxpResponseInit,
    AxpStage,
    AxpStateKey<number>,
    AxpTap,
    IAuthOptions,
    IAxpCacheEntry,
    IAxpCacheStore,
    IAxpCacheSnapshot,
    MaybePromise<number>,
    IAxpFailure,
    IAxpResponse,
    IAxpResponseFactory,
    IAxpResponseOptions<IAxpResponse>,
    ICacheApi,
    ICacheOptions,
    ICacheRequestOptions,
    IEnvOptions,
    IEnvRule,
    IEnvsOptions,
    IFilterOptions,
    IKeyOptions,
    ILoadingOptions,
    IMockOptions,
    IMockRequestOptions,
    INotifyOptions,
    IRepathOptions,
    IRetryOptions,
    ISharedOptions,
    ISharedRequestOptions,
    ITokenManager,
    TAuthFunc<void>,
    TCloneStrategy,
    TLoadingFunc,
    TMockFallback,
    TPredicate,
    TRetryDelay,
    TRetryJitter,
    TShouldRetry,
    SharePolicy,
    WithData<IAxpResponse, string>,
    WithNative<IAxpResponse>,
  ];
  expectTypeOf<Surface>().not.toBeNever();
  expectTypeOf<entry.AuthFailureAction>().toEqualTypeOf<"refresh" | "replay" | "deny" | "expired" | "others">();
  expectTypeOf(entry.AuthFailureAction.Refresh).toEqualTypeOf<"refresh">();
});
