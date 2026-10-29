import { AxiosHeaders, mergeConfig, type InternalAxiosRequestConfig } from "axios";
import { expect, it, vi } from "vitest";
import axpFilter from "../../src/plugins/filter";
import axpRepath from "../../src/plugins/repath";
import type { AxpResponse } from "../../src/response";
import { AXP_STAGES } from "../../src/pipeline";
import type { AxpPlugin } from "../../src/types";
import { wireClient } from "../helpers/wire";

/** 集成检查固定访问地址。 */
const REQUEST_URL = "/effective";
/** 默认环境服务地址。 */
const BASE_URL = "https://example.test";
/** 默认查询值，删除后不允许二次合并恢复。 */
const OLD_QUERY = "old";
/** 用于验证请求头大小写合并的默认凭证。 */
const OLD_AUTH = "default-token";
/** 显式覆盖后的凭证。 */
const NEW_AUTH = "request-token";
/** 请求头的公开名称。 */
const AUTH_HEADER = "Authorization";
/** 默认禁止发送的布尔头。 */
const FALSE_HEADER = "X-False";
/** 默认禁止发送的空值头。 */
const NULL_HEADER = "X-Null";
/** 用于检查方法优先级的默认头。 */
const METHOD_HEADER = "X-Method";
/** 默认值和显式参数中的不同租户。 */
const TENANTS = ["tenant-a", "tenant-b"];
/** 参数被全部删除后的传输墓碑。 */
const EMPTY_PARAMS = { q: null, keep: null };

it("[core.req.defaults] 使用公开 mergeConfig，所有阶段看到有效 defaults 且请求值优先", /** 默认值在 outer 之前完成合并。 */ async () => {
  expect(typeof mergeConfig).toBe("function");
  const stages: string[] = [];
  const observer: AxpPlugin<AxpResponse> = {
    name: "defaults-observer",
    taps: AXP_STAGES.map(
      /** 每个阶段独立检查同一组有效字段。 */ (stage) => ({
        stage,
        onRequest: /** 合并的 params、超时、基址和头都对插件可见。 */ (ctx) => {
          stages.push(stage);
          expect(ctx.request).toMatchObject({
            baseURL: BASE_URL,
            timeout: 20,
            params: { q: OLD_QUERY, keep: 2 },
          });
          expect((ctx.request.headers as AxiosHeaders).get(AUTH_HEADER)).toBe(NEW_AUTH);
        },
      }),
    ),
  };
  const h = wireClient(
    {
      baseURL: BASE_URL,
      timeout: 10,
      params: { q: OLD_QUERY, keep: 1 },
      headers: { common: { Authorization: OLD_AUTH } },
    },
    [observer],
  );
  await h.api.request({
    url: REQUEST_URL,
    timeout: 20,
    params: { keep: 2 },
    headers: { authorization: NEW_AUTH },
  });
  expect(stages).toEqual(AXP_STAGES);
  expect(h.calls[0].url).toBe(BASE_URL + REQUEST_URL + "?q=old&keep=2");
  expect(h.axios.defaults.params).toEqual({ q: OLD_QUERY, keep: 1 });
  h.api.dispose();
});

it("[filter.req.defaults] 请求空值覆盖 defaults 后被过滤，adapter URL 不再含 q", /** 防止过滤结果被第二次合并覆盖。 */ async () => {
  const h = wireClient({ params: { q: OLD_QUERY, keep: 1 } }, [axpFilter()]);
  await h.api.request({ url: REQUEST_URL, params: { q: "" } });
  expect(h.calls[0].config.params).toEqual({ q: null, keep: 1 });
  expect(h.calls[0].url).toBe(REQUEST_URL + "?keep=1");
  expect(h.axios.defaults.params.q).toBe(OLD_QUERY);
  h.api.dispose();
});
it.each([
  { q: "", keep: null },
  { q: undefined, keep: NaN },
])(
  "[filter.req.defaults] 只有 defaults 空字段 %j 时发送 URL 没有查询串",
  /** 没有请求级 params 时也执行过滤。 */ async (params) => {
    const h = wireClient({ params }, [axpFilter()]);
    await h.api.get(REQUEST_URL)();
    expect(h.calls[0].config.params).toEqual(EMPTY_PARAMS);
    expect(h.calls[0].url).toBe(REQUEST_URL);
    h.api.dispose();
  },
);
it("[repath.req.defaults] 从 defaults.params 取路径变量，消费后不出现在查询串", /** 替换和删除都在真实 adapter 边界检查。 */ async () => {
  const h = wireClient({ params: { id: "a/b", keep: 1 } }, [axpRepath()]);
  await h.api.request({ url: "/users/:id" });
  expect(h.calls[0].config.url).toBe("/users/a%2Fb");
  expect(h.calls[0].config.params).toEqual({ id: null, keep: 1 });
  expect(h.calls[0].url).toBe("/users/a%2Fb?keep=1");
  expect(h.axios.defaults.params.id).toBe("a/b");
  h.api.dispose();
});
it("[core.req.defaults][core.method.key] defaults.params.tenant 修改前后 key 不同，客户端间也不同", /** key 在合并默认租户后计算。 */ async () => {
  const keys: (string | null)[] = [];
  const keyReader: AxpPlugin<AxpResponse> = {
    name: "tenant-key",
    stage: "source",
    /** 记录每个请求的有效指纹。 */ async handle(ctx, next) {
      keys.push(ctx.key());
      return next();
    },
  };
  const first = wireClient({ params: { tenant: TENANTS[0] } }, [keyReader]);
  const second = wireClient({ params: { tenant: TENANTS[1] } }, [keyReader]);
  await first.api.get(REQUEST_URL)();
  first.axios.defaults.params.tenant = TENANTS[1];
  await first.api.get(REQUEST_URL)();
  await second.api.get(REQUEST_URL)();
  expect(keys[0]).not.toBeNull();
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys[1]).toBe(keys[2]);
  first.api.dispose();
  second.api.dispose();
});
it("[core.req.defaults][core.req.transforms] 二次合并不恢复默认 data，转换器替换且不叠加", /** axios 的 data 和转换器合并规则保持不变。 */ async () => {
  const defaultRequest = vi.fn(/** 默认请求转换不改变值。 */ (data: unknown) => data);
  const defaultResponse = vi.fn(/** 默认响应转换不改变值。 */ (data: unknown) => data);
  const requestTransform = vi.fn(/** 请求级转换覆盖默认数组。 */ (data: unknown) => data);
  const responseTransform = vi.fn(/** 请求级响应转换覆盖默认数组。 */ (data: unknown) => data);
  const h = wireClient({
    data: "unused defaults data",
    transformRequest: [defaultRequest],
    transformResponse: [defaultResponse],
  });
  await h.api.get(REQUEST_URL)();
  expect(h.calls[0].config.data).toBeUndefined();
  expect(defaultRequest).toHaveBeenCalledTimes(1);
  expect(defaultResponse).toHaveBeenCalledTimes(1);
  await h.api.post(REQUEST_URL)({ value: 1 }, { transformRequest: [requestTransform], transformResponse: [responseTransform] });
  expect(defaultRequest).toHaveBeenCalledTimes(1);
  expect(defaultResponse).toHaveBeenCalledTimes(1);
  expect(requestTransform).toHaveBeenCalledTimes(1);
  expect(responseTransform).toHaveBeenCalledTimes(1);
  expect(h.calls[1].config.data).toEqual({ value: 1 });
  h.api.dispose();
});
it("[core.req.interceptors] 每次 next 尝试经过用户实例拦截器一次且转换器一次", /** 重放仍调用用户原实例，入口合并不执行拦截器。 */ async () => {
  const replay: AxpPlugin<AxpResponse> = {
    name: "two-attempts",
    /** 仅用于检查每次内层尝试的传输装配。 */ async handle(ctx, next) {
      ctx.markReplayable();
      await next();
      return next();
    },
  };
  const transform = vi.fn(/** 转换器按实际尝试计数。 */ (data: unknown) => data);
  const h = wireClient({ transformRequest: [transform] }, [replay]);
  const interceptor = vi.fn(
    /** 用户拦截器增加最终发送头。 */ (config: InternalAxiosRequestConfig) => {
      config.headers.set("X-User", "yes");
      return config;
    },
  );
  h.axios.interceptors.request.use(interceptor);
  expect(h.api.axios).toBe(h.axios);
  await h.api.get(REQUEST_URL)();
  expect(h.calls).toHaveLength(2);
  expect(interceptor).toHaveBeenCalledTimes(2);
  expect(transform).toHaveBeenCalledTimes(2);
  expect(h.calls[1].config.headers.get("X-User")).toBe("yes");
  h.api.dispose();
});
it.each([undefined, null, new URLSearchParams("only=1")])(
  "[core.req.params] patch 删除整个参数或换特殊容器 %s 时不恢复默认查询",
  /** undefined 代表内层删除，null 和特殊参数遵从 axios 原生覆盖。 */ async (params) => {
    const patch: AxpPlugin<AxpResponse> = {
      name: "remove-params",
      /** 覆盖本次内层 params。 */ handle: (_ctx, next) => next({ params }),
    };
    const h = wireClient({ params: { q: OLD_QUERY, keep: 1 } }, [patch]);
    await h.api.get(REQUEST_URL)();
    expect(h.calls[0].config.params).toEqual(params === undefined ? EMPTY_PARAMS : params);
    expect(h.calls[0].url).toBe(REQUEST_URL + (params instanceof URLSearchParams ? "?only=1" : ""));
    h.api.dispose();
  },
);
it("[core.req.params] 嵌套默认参数的删除同样通过 null 阻止复活", /** 默认深合并也不能恢复已删除子字段。 */ async () => {
  const patch: AxpPlugin<AxpResponse> = {
    name: "nested-params",
    /** 删除嵌套 q。 */ handle: (_ctx, next) => next({ params: { nested: { keep: 1 } } }),
  };
  const h = wireClient({ params: { nested: { q: OLD_QUERY, keep: 1 } } }, [patch]);
  await h.api.get(REQUEST_URL)();
  expect(h.calls[0].config.params).toEqual({ nested: { q: null, keep: 1 } });
  expect(h.calls[0].url).not.toContain("old");
  h.api.dispose();
});
it("[core.req.headers] 默认通用头、方法头和请求头按优先级展平，删除默认头后不发送", /** header 删除忽略大小写，使用公开 false 禁用标记。 */ async () => {
  const patch: AxpPlugin<AxpResponse> = {
    name: "remove-header",
    /** 检查根视图有效头后删除凭证和方法头。 */ handle(ctx, next) {
      expect((ctx.request.headers as AxiosHeaders).get(AUTH_HEADER)).toBe(NEW_AUTH);
      return next({ headers: { authorization: undefined, "x-method": undefined } });
    },
  };
  const h = wireClient({ headers: { common: { Authorization: OLD_AUTH }, get: { "X-Method": "default-get" } } }, [patch]);
  await h.api.get(REQUEST_URL)(undefined, { headers: { Authorization: NEW_AUTH } });
  const headers = h.calls[0].config.headers;
  expect(headers.get(AUTH_HEADER)).toBe(false);
  expect(headers.get("X-Method")).toBe(false);
  expect(headers.toJSON()).not.toHaveProperty(AUTH_HEADER);
  expect(headers.toJSON()).not.toHaveProperty("X-Method");
  expect(h.axios.defaults.headers.common.Authorization).toBe(OLD_AUTH);
  h.api.dispose();
});
it.each([false, null])(
  "[core.req.headers] 请求显式禁用 header=%s 时不发送，二次合并不恢复",
  /** 文档化的两种禁用值均保留到发送边界。 */ async (value) => {
    const h = wireClient({ headers: { common: { Authorization: OLD_AUTH } } });
    await h.api.get(REQUEST_URL)(undefined, { headers: { Authorization: value } });
    expect(h.calls[0].config.headers.get(AUTH_HEADER)).toBe(value);
    expect(h.calls[0].config.headers.toJSON()).not.toHaveProperty(AUTH_HEADER);
    h.api.dispose();
  },
);

it.each(["get", "post"])(
  "[core.req.headers] %s 分组和 AxiosHeaders 默认头的禁用值、大小写与删除掩码保持一致",
  /** 在逻辑视图和真实 adapter 两端同时验证默认头，默认容器不被修改。 */ async (method) => {
    for (const flat of [false, true]) {
      /** 验证当前分组及禁用值后再删除默认凭证。 */
      const patch: AxpPlugin<AxpResponse> = {
        /** 本次验证插件名。 */ name: "disabled-default-headers",
        /** 用 patch 删除凭证，保留两个禁止发送的默认头。 */ handle(ctx, next) {
          /** 管线实际收到的平面头。 */
          const headers = ctx.request.headers as AxiosHeaders;
          expect(headers.get(AUTH_HEADER)).toBe(NEW_AUTH);
          expect(headers.get(FALSE_HEADER)).toBe(false);
          expect(headers.get(NULL_HEADER)).toBeNull();
          expect(headers.get(METHOD_HEADER)).toBe(flat ? undefined : method);
          return next({ headers: { authorization: undefined } });
        },
      };
      /** 真实传输边界夹具。 */
      const h = wireClient({}, [patch]);
      /** 禁用值须从对象字段保留，不能经过会丢标记的 toJSON。 */
      const common = { [AUTH_HEADER]: OLD_AUTH, [FALSE_HEADER]: false, [NULL_HEADER]: null };
      Object.assign(h.axios.defaults, {
        /** 两种实例默认头容器遵循相同的请求覆盖和删除语义。 */
        headers: flat ? new AxiosHeaders(common) : { common, get: { [METHOD_HEADER]: "get" }, post: { [METHOD_HEADER]: "post" } },
      });
      /** 请求前的默认值快照。 */
      const before = JSON.stringify(h.axios.defaults.headers);
      // oxlint-disable-next-line no-await-in-loop -- 每个容器必须独立核对实际发送结果。
      await h.api.request({ url: REQUEST_URL, method, headers: { authorization: NEW_AUTH } });
      /** axios 二次合并后的发送头。 */
      const headers = h.calls[0].config.headers;
      expect(headers.get(AUTH_HEADER)).toBe(false);
      expect(headers.get(FALSE_HEADER)).toBe(false);
      expect(headers.get(NULL_HEADER)).toBeNull();
      expect(headers.toJSON()).not.toHaveProperty(AUTH_HEADER);
      expect(headers.toJSON()).not.toHaveProperty(FALSE_HEADER);
      expect(headers.toJSON()).not.toHaveProperty(NULL_HEADER);
      expect(JSON.stringify(h.axios.defaults.headers)).toBe(before);
      h.api.dispose();
    }
  },
);
it("[core.req.defaults][core.req.signal] defaults.signal 参与逻辑取消并在落定后注销监听", /** 有效取消信号不能留到 transport 才读取。 */ async () => {
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  controller.abort("default abort");
  const h = wireClient({ signal: controller.signal });
  const response = await h.api.request({ url: REQUEST_URL, throws: false });
  expect(response.kind).toBe("cancel");
  expect(h.calls).toHaveLength(0);
  expect(add).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(h.api.pending()).toBe(0);
  h.api.dispose();
});

it.each([undefined, "PuT"])(
  "[core.req.defaults] method=%s 时采用有效默认方法并统一小写，方法头与实际传输一致",
  /** mergeConfig 不继承 method，管线入口补齐 axios 原生发送方法。 */ async (method) => {
    const expected = method === undefined ? "post" : "put";
    const observer: AxpPlugin<AxpResponse> = {
      name: "method-observer",
      /** 每层应看到 adapter 最终使用的方法和方法头。 */ handle(ctx, next) {
        expect(ctx.request.method).toBe(expected);
        expect((ctx.request.headers as AxiosHeaders).get("X-Method")).toBe(expected);
        return next();
      },
    };
    const h = wireClient({ method: "post", headers: { post: { "X-Method": "post" }, put: { "X-Method": "put" } } }, [observer]);
    await h.api.request({ url: REQUEST_URL, method });
    expect(h.calls[0].config.method).toBe(expected);
    expect(h.calls[0].config.headers.get("X-Method")).toBe(expected);
    h.api.dispose();
  },
);
