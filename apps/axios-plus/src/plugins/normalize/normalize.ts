import axios from "axios";
import type {
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import type { Plugin } from "../../plugin/types";
import { __DEV__, Type, isEmpty, lockName } from "../../helper";
import ApiResponse, { ERR_CODES } from "../../objects/ApiResponse";
import type {
  IBizTriple,
  INormalizeOptions,
  INormalizeRequestOptions,
  TBizField,
  TSuccess,
} from "./types";

export const name = "normalize";

/**
 * 网络错误 code 别名（向后兼容）。推荐用 `ERR_CODES.NETWORK`。
 */
export const NETWORK_ERR_CODE = ERR_CODES.NETWORK;

/**
 * 全链路归一化插件 —— 把 axios 的多种 settle 形态（成功 / HTTP 错误 / 网络 / 超时 / cancel）
 * **统一成一种 onFulfilled 形态**。下游插件与业务代码不再需要处理 onRejected。
 *
 *   - **必须最先 use 装载 adapter**（虽然不再有全局强校验，但 `requirePlugin('normalize')` 由
 *     retry / rethrow / notification / auth 各自调用）
 *   - **失败也走 onFulfilled**：合成 synthetic AxiosResponse，把 response.data 替换为
 *     `ApiResponse(success=false, code, message, data)` 然后 **resolve**（不 reject）
 *   - **cancel 也归一化**：`code = 'CANCEL'`，`status = 0`；用户用 `apiResp.code === 'CANCEL'` 区分
 *   - **请求级 `config.normalize = false` 旁路**
 *
 * **成功裁决**：先组装 `ApiResponse(success=false)`，然后 `apiResp.success = cfg.success(apiResp)`。
 * `success` 仅支持函数形态，**插件配置必传**；请求级可选。
 *
 * @example
 *   api.use([
 *     normalize({
 *       success: (apiResp) => apiResp.code === '0000',
 *     }),
 *     // ...其他插件
 *   ]);
 */
export default function normalize(opts: INormalizeOptions): Plugin {
  const cfg = $resolveConfig(opts);
  return {
    name,
    install(ctx) {
      if (__DEV__) ctx.logger.log(name);

      ctx.response(
        // ─── onFulfilled ───
        (response: AxiosResponse) => {
          const runtime = $mergeRequest(cfg, response.config);
          if (!runtime) return response; // config.normalize === false
          $applyEnvelope(response, undefined, runtime);
          return response;
        },
        // ─── onRejected → 合成 synthetic response 后 RESOLVE ───
        (error: unknown) => {
          const e = error as AxiosError;
          const runtime = $mergeRequest(cfg, e?.config);
          if (!runtime) return Promise.reject(error); // 用户显式 normalize:false 时仍按原 reject

          const synth: AxiosResponse =
            e?.response ?? $synthFromError(e, runtime.cfg);
          $applyEnvelope(synth, e, runtime);
          return synth; // ← resolve，不 reject
        },
      );
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
//  resolveConfig：插件级 options → 内部归一化配置
// ───────────────────────────────────────────────────────────────────────────

/** 内部归一化配置（含默认值兜底）@internal */
export interface INormalizeConfig {
  code: TBizField;
  message: TBizField;
  data: TBizField;
  /** 当前生效的成功裁决函数（插件级；请求级覆盖后由 [$mergeRequest] 在 `IResolvedRuntime.cfg` 上替换） */
  success: TSuccess;
  httpErrorCode: string;
  networkErrorCode: string;
  timeoutErrorCode: string;
  cancelCode: string;
}

/**
 * 经请求级合并后的运行期数据 —— 给 [$applyEnvelope] 用。
 *
 * 拆出 `cfg` 之外的几个字段是因为它们的语义跟"裁决流程"绑死，不属于"配置"：
 *   - `reqHadSuccess`：请求级是否提供了 `success` 函数；提供时 `nullable` / `emptyable` 都不参与
 *   - `reqNullable` / `reqEmptyable`：请求级 nullable / emptyable，二次裁决用
 *
 * @internal
 */
export interface IResolvedRuntime {
  cfg: INormalizeConfig;
  reqHadSuccess: boolean;
  reqNullable?: boolean;
  reqEmptyable?: boolean;
}

/** @internal exported for unit tests */
export function $resolveConfig(opts: INormalizeOptions): INormalizeConfig {
  if (!Type.isFunction(opts.success)) {
    throw new TypeError(
      `[${name}] options.success must be a function (apiResp) => boolean`,
    );
  }
  return {
    code: opts.codeKeyPath ?? "code",
    message: opts.messageKeyPath ?? "message",
    data: opts.dataKeyPath ?? "data",
    success: opts.success,
    httpErrorCode: opts.httpErrorCode ?? ERR_CODES.HTTP,
    networkErrorCode: opts.networkErrorCode ?? ERR_CODES.NETWORK,
    timeoutErrorCode: opts.timeoutErrorCode ?? ERR_CODES.TIMEOUT,
    cancelCode: opts.cancelCode ?? ERR_CODES.CANCEL,
  };
}

/**
 * 与请求级 `config.normalize` 浅合并 + 提取请求级 nullable / emptyable。
 *
 *   - `config.normalize === false` ⇒ 返回 `null`，本请求跳过 normalize
 *   - 对象形态 ⇒ 字段级覆盖；如带 `success` 函数，标记 `reqHadSuccess=true`
 *     （此时请求级 nullable / emptyable 不参与，由 `success` 函数全权裁决）
 *   - 顶层 `config.nullable` / `config.emptyable` 优先级高于 `config.normalize.{nullable,emptyable}`
 *
 * 99% 请求不带任何覆盖，走零分配快路径。
 *
 * @internal exported for unit tests
 */
export function $mergeRequest(
  cfg: INormalizeConfig,
  config: AxiosRequestConfig | undefined,
): IResolvedRuntime | null {
  const v = config?.normalize;
  if (v === false) return null;

  // 顶层 config.nullable / config.emptyable
  const topNullable = config?.nullable;
  const topEmptyable = config?.emptyable;

  if (v == null && topNullable === undefined && topEmptyable === undefined) {
    // 完全无覆盖 —— 复用插件级 cfg
    return { cfg, reqHadSuccess: false };
  }

  let merged: INormalizeConfig = cfg;
  let reqHadSuccess = false;
  let nestedNullable: boolean | undefined;
  let nestedEmptyable: boolean | undefined;

  if (v && Type.isObject(v)) {
    const ro = v as INormalizeRequestOptions;
    merged = { ...cfg };
    if (Type.isFunction(ro.success)) {
      merged.success = ro.success as TSuccess;
      reqHadSuccess = true;
    }
    merged.code = ro.codeKeyPath ?? merged.code;
    merged.message = ro.messageKeyPath ?? merged.message;
    merged.data = ro.dataKeyPath ?? merged.data;
    merged.httpErrorCode = ro.httpErrorCode ?? merged.httpErrorCode;
    merged.networkErrorCode = ro.networkErrorCode ?? merged.networkErrorCode;
    merged.timeoutErrorCode = ro.timeoutErrorCode ?? merged.timeoutErrorCode;
    merged.cancelCode = ro.cancelCode ?? merged.cancelCode;
    if (typeof (ro as { nullable?: unknown }).nullable === "boolean") {
      nestedNullable = (ro as { nullable: boolean }).nullable;
    }
    if (typeof (ro as { emptyable?: unknown }).emptyable === "boolean") {
      nestedEmptyable = (ro as { emptyable: boolean }).emptyable;
    }
  }

  // 顶层覆盖优先于 normalize 嵌套形态
  const reqNullable = typeof topNullable === "boolean" ? topNullable : nestedNullable;
  const reqEmptyable = typeof topEmptyable === "boolean" ? topEmptyable : nestedEmptyable;

  return { cfg: merged, reqHadSuccess, reqNullable, reqEmptyable };
}

// ───────────────────────────────────────────────────────────────────────────
//  路径访问 & 字段抽取
// ───────────────────────────────────────────────────────────────────────────

/**
 * 按 `.` 路径读取嵌套字段。中途遇到原始类型（string / number / boolean 等）即视为不可继续下钻，
 * 返回 `undefined`，避免误读到 `String.prototype.length` / `Number.prototype.toString` 之类原型属性。
 * @internal
 */
export function $get(obj: unknown, path: string | undefined): unknown {
  if (obj == null || !path) return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    const t = typeof cur;
    if (t !== "object" && t !== "function") return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * 把 TBizField 解开成具体值。字符串路径相对 `response.data` 解析。
 * @internal
 */
function $extractField(
  response: AxiosResponse | undefined,
  error: AxiosError | undefined,
  field: TBizField,
): unknown {
  if (Type.isFunction(field)) return (field as Exclude<TBizField, string>)(response, error);
  return $get(response?.data, field as string);
}

// ───────────────────────────────────────────────────────────────────────────
//  错误响应合成
// ───────────────────────────────────────────────────────────────────────────

/**
 * 当 `error.response` 不存在时（network / timeout / cancel），合成一个最小化的 AxiosResponse。
 * @internal
 */
function $synthFromError(
  error: AxiosError,
  cfg: INormalizeConfig,
): AxiosResponse {
  const code = $errorCode(error, cfg);
  return {
    data: { code, message: error?.message ?? null, data: null },
    status: 0,
    statusText: error?.message ?? "",
    headers: (error?.config?.headers as any) ?? {},
    config:
      (error?.config as InternalAxiosRequestConfig) ??
      ({} as InternalAxiosRequestConfig),
    request: (error as any)?.request,
  };
}

/** 根据 axios error 推断错误类型 → 占位 code @internal */
function $errorCode(error: AxiosError, cfg: INormalizeConfig): string {
  if (axios.isCancel(error)) return cfg.cancelCode;
  const c = error?.code;
  if (c === "ETIMEDOUT" || c === "ECONNABORTED") return cfg.timeoutErrorCode;
  return cfg.networkErrorCode;
}

// ───────────────────────────────────────────────────────────────────────────
//  envelope —— 替换 response.data 为 ApiResponse 实例
// ───────────────────────────────────────────────────────────────────────────

/**
 * 把 envelope 抽取出来，写回 response.data 为 ApiResponse 实例。
 *
 * **流程**：
 *   1. 抽 envelope 三元组（code / message / data），构造 `ApiResponse(success=false)`
 *   2. error 路径：保持 `success=false` 直接返回
 *   3. 否则调 `cfg.success(apiResp)`（已合并请求级覆盖）写回 `apiResp.success`
 *   4. **如果请求级未传 success** 且传了 `nullable` / `emptyable`：
 *      - data 是 null/undefined ⇒ 用 `reqNullable` 强制覆盖 `apiResp.success`
 *      - data 是空容器（`{}` / `[]` / `''`）⇒ 用 `reqEmptyable` 强制覆盖
 *
 * @internal exported for unit tests
 */
export function $applyEnvelope(
  response: AxiosResponse,
  error: AxiosError | undefined,
  runtime: IResolvedRuntime,
): void {
  const cfg = runtime.cfg;
  const biz = $extractBiz(response, error, cfg);

  // step 1：构造 success=false 起步的 ApiResponse
  const apiResp = new ApiResponse(
    response.status,
    (biz.code ?? "") as string | number,
    biz.data ?? null,
    biz.message != null ? String(biz.message) : null,
    false,
  );

  // step 2：error 路径保持 false
  if (!error) {
    // step 3：让用户的 success 函数裁决
    apiResp.success = cfg.success(apiResp);

    // step 4：请求级 nullable/emptyable 仅在未提供请求级 success 时参与
    if (!runtime.reqHadSuccess) {
      const data = apiResp.data;
      if (
        runtime.reqNullable !== undefined &&
        (data === null || data === undefined)
      ) {
        apiResp.success = runtime.reqNullable;
      } else if (
        runtime.reqEmptyable !== undefined &&
        data != null &&
        isEmpty(data)
      ) {
        apiResp.success = runtime.reqEmptyable;
      }
    }
  }

  response.data = apiResp;
}

/** 从 response/error 抽出 envelope 三元组（code / message / data）@internal */
export function $extractBiz(
  response: AxiosResponse,
  error: AxiosError | undefined,
  cfg: INormalizeConfig,
): IBizTriple {
  let code = $extractField(response, error, cfg.code);
  const message = $extractField(response, error, cfg.message);
  const data = $extractField(response, error, cfg.data);

  // error 路径但 envelope 没给 code：用占位
  if (code == null && error) {
    if (response.status >= 400) {
      code = cfg.httpErrorCode;
    } else {
      code = $errorCode(error, cfg);
    }
  }
  return { code, message, data };
}


// 防打包混淆 —— 锁住函数 .name，让 `core.eject(normalize)` 在 minify 后仍能识别
lockName(normalize, name);
