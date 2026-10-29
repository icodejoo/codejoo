import { resolveOption, resolveRequestOption, type AxpOption, type IPluginSwitch } from "../options";
import { failureOf, AXP_FAILURES, type AxpResponse, type IAxpResponse } from "../response";
import type { AxpPlugin, AxpRequestPatch } from "../types";
import { ORIGIN_PREFIX } from "../utils";

/** 内置 mock 插件名称。 */
const NAME = "axp:mock";
/** mock 服务器上没有这条接口时的 HTTP 状态。 */
const NOT_FOUND = 404;
/** 开启了 mock 却没有 mockUrl 时的调试提示。 */
const SKIPPED_MESSAGE = `[${NAME}] 已跳过：没有 mockUrl，直接请求真实接口`;
/** 探测结果需要回落时的调试提示前缀。 */
const FALLBACK_MESSAGE = `[${NAME}] 回落真实接口：`;

/** 判断 mock 探测结果是否应回落真实接口，返回真值即回落；抛错按程序 bug 处理。 */
export type TMockFallback<R extends IAxpResponse<unknown, string | number> = IAxpResponse> = (response: R) => boolean;

/** mock 插件的装配配置。 */
export interface IMockOptions<R extends IAxpResponse<unknown, string | number> = IAxpResponse> extends IPluginSwitch {
  /** 插件总开关；默认 false，通常写 import.meta.env.DEV。 */
  enable?: boolean;
  /** 是否让全部请求走 mock；请求级 false 可退出，默认 false。 */
  mock?: boolean;
  /** mock 服务器基址；缺失时跳过 mock 直接请求真实接口。 */
  mockUrl?: string;
  /** 回落判定，默认 404 或网络不可达。 */
  fallbackWhen?: TMockFallback<R>;
}

/** 请求级 mock 对象写法；开关只认 enable，不再有 mock 字段。 */
export interface IMockRequestOptions extends IPluginSwitch {
  /** 本次请求专用的 mock 服务器基址。 */
  mockUrl?: string;
  /** 本次请求专用的回落判定。 */
  fallbackWhen?: TMockFallback;
}

/** 内置默认：mock 不存在时才回落。 */
const DEFAULTS = {
  /** 默认回落判定。 */
  fallbackWhen: $shouldFallback,
};

/** 默认回落判定：mock 服务器没有这条接口（404）或根本连不上（network）。
 * @internal
 * @param response 探测请求的归一化响应。
 * @returns 是否应改打真实接口；取消、其它状态一律不回落。
 * @example `$shouldFallback(r) // r.status === 404 时为 true`
 */
export function $shouldFallback(response: IAxpResponse<unknown, string | number>): boolean {
  return response.status === NOT_FOUND || failureOf(response)?.type === AXP_FAILURES.NETWORK;
}

/** 拼接基址与非空的相对路径，保证中间只有一个斜杠。 */
function joinUrl(base: string, relative: string): string {
  return `${base.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
}

/** 把请求地址改写到 mock 服务器，保留 query 与 hash。
 * @internal
 * @param url 原请求地址，可为相对、绝对或缺省。
 * @param mockUrl mock 服务器基址。
 * @returns 只含被改写字段的请求补丁；缺省地址改写 baseURL，其余改写 url。
 * @example `$rewriteUrl('/pet?id=1', 'http://m') // { url: 'http://m/pet?id=1' }`
 */
export function $rewriteUrl(url: string | undefined, mockUrl: string): AxpRequestPatch {
  if (!url) return { baseURL: mockUrl };
  if (!ORIGIN_PREFIX.test(url)) return { url: joinUrl(mockUrl, url) };
  try {
    const parsed = new URL(url);
    return { url: joinUrl(mockUrl, parsed.pathname + parsed.search + parsed.hash) };
  } catch {
    return { url: joinUrl(mockUrl, url) };
  }
}

/** 先探测 mock 服务器，mock 不存在时回落真实接口。
 * 探测请求关闭 cache 与 share，探测结果不写缓存、不占共享条目。
 * @param options 总开关、全局 mock 开关、mock 基址与回落判定。
 * @returns source 阶段内置次序 1 的插件；enable 默认 false。
 * @example `axpMock({ enable: import.meta.env.DEV, mockUrl: 'http://localhost:4523' })`
 */
export default function axpMock<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: IMockOptions<R> = {}): AxpPlugin<R> {
  const base = resolveOption<IMockOptions<R>, typeof DEFAULTS>(undefined, options, DEFAULTS);
  // 请求省略或写了不认得的值时只看插件级 mock：未全局开启则不走 mock。
  const optIn = !base.mock;
  return {
    name: NAME,
    enable: options.enable ?? false,
    stage: "source",
    /** 探测命中直接返回；需要回落时再走一次真实请求。 */
    async handle(ctx, next) {
      const resolved = resolveRequestOption(ctx.request.mock, base, DEFAULTS, undefined, optIn);
      if (!resolved) return next();
      const mockUrl = resolved.mockUrl;
      if (!mockUrl) {
        ctx.log.warn(SKIPPED_MESSAGE);
        return next();
      }
      // 探测与回落会把同一请求体发两次，标记可重放让每次发送都转换独立副本
      ctx.markReplayable();
      const probe = await next({
        ...$rewriteUrl(ctx.request.url, mockUrl),
        cache: false,
        share: false,
      });
      if (!resolved.fallbackWhen(probe)) return probe;
      if (!ctx.canReplay()) return probe;
      ctx.log.log(`${FALLBACK_MESSAGE}${failureOf(probe)?.type} ${probe.status}`);
      return next();
    },
  };
}

declare module "../types" {
  interface AxpRequestOptions {
    /** false 关闭；true 沿用插件配置；对象覆盖 mockUrl、fallbackWhen，enable:false 等同 false。 */
    mock?: AxpOption<IMockRequestOptions>;
  }
}
