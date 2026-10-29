/** 包名，消费方 import 时使用。 */
const PKG_NAME = "@codejoo/axp";

/** 单文件压缩版的子路径。 */
export const MIN_SUBPATH = "./min";

/** 消费方 TypeScript 程序：只经包名导入；`@ts-expect-error` 的行必须真的报错，否则 tsgo 报“未使用的指令”。 */
export const CONSUMER_SOURCE = `
import axios from "axios";
import { createAxp, isAxpResponse, failureOf, isAxpCancel, AxpResponse, axpResponse, AXP_FAILURE, AXP_FAILURES, axpAuth, axpCache, axpEnvs, axpFilter, axpLoading, axpMock, axpNotify, axpRepath, axpRetry, axpShare } from "@codejoo/axp";
import type { AxpRequestConfig, IAxpResponse, AxpResponseInit, IAxpFailure, AxpFailureType, WithData } from "@codejoo/axp";
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
  const failure: IAxpFailure | undefined = failureOf(caught);
  const ok: boolean = caught.ok;
  const base: IAxpResponse = caught;
}
if (api.isResponse(caught)) {
  const status: number = caught.status;
}

// ── 新响应契约与扩展初始化 ──
const minimal: IAxpResponse<null, string> = { ok: false, status: 0, code: "CUSTOM", data: null };
/** 消费方自定义响应。 */
class Custom extends AxpResponse<unknown, string | number> { /** 追踪字段。 */ traceId = ""; }
const customInit: AxpResponseInit<Custom> = { traceId: "trace", failure: "auth" };
const customFactory = axpResponse<Custom>({ type: Custom });
const customApi = createAxp<unknown, Custom>({ response: customFactory });
const cancellation: boolean = isAxpCancel(caught) || customApi.isCancel(caught);
const failureType: AxpFailureType = AXP_FAILURES.NETWORK;
// @ts-expect-error 自定义响应必须指定构造路径。
axpResponse<Custom>({});
// @ts-expect-error 扩展字段仍限制值类型。
const wrongInit: AxpResponseInit<Custom> = { traceId: 1 };
// @ts-expect-error 已删除的工厂选项。
axpResponse({ envelope: false });
// @ts-expect-error 使用者响应不提供 kind。
minimal.kind;
// ── 压缩版入口的类型与根入口一致 ──
createMinAxp().get("/x")({}, { retry: 2, cache: true });
const minNarrows: boolean = isMinResponse(caught);

export { config, sameAuth, sameCache, sameEnvs, sameFilter, sameLoading, sameMock, sameNotify, sameRepath, sameRetry, sameShare, petIsTyped, wrappedIsTyped, minNarrows };
`;

/** 运行时探针：在消费方目录里用真正的 Node 解析 exports 并导入，把观察结果以 JSON 打印。参数 argv[2] 是 { importable, blocked }。 */
export const PROBE_SOURCE = `
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
const aborted = new AbortController();
aborted.abort();
const rootCancel = await rootApi.request({ signal: aborted.signal, throws: false });
const minCancel = await minApi.request({ signal: aborted.signal, throws: false });
result.mixed = {
  brandShared: root.AXP_RESPONSE === min.AXP_RESPONSE,
  rootSeesMin: [root.isAxpResponse(minOk), root.isAxpResponse(minFail)],
  minSeesRoot: [min.isAxpResponse(rootOk), min.isAxpResponse(rootFail)],
  clientSeesOther: [rootApi.isResponse(minFail), minApi.isResponse(rootFail)],
  rejectsNonResponses: [root.isAxpResponse({}), min.isAxpResponse(new Error("x")), root.isAxpResponse(null)],
  failures: [root.failureOf(rootOk)?.type ?? null, root.failureOf(minFail)?.type ?? null, min.failureOf(minOk)?.type ?? null, min.failureOf(rootFail)?.type ?? null],
  failureShared: root.AXP_FAILURE === min.AXP_FAILURE,
  cancels: [root.isAxpCancel(minCancel), min.isAxpCancel(rootCancel), rootApi.isCancel(minCancel), minApi.isCancel(rootCancel)],
};
console.log(JSON.stringify(result));
`;
