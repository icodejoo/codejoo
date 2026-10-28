import { AxiosHeaders } from "axios";
import { expect, it, vi } from "vitest";
import { AxpContext, mergePatch, requestContext } from "../../src/context";
import axpFilter, { $filter, defaultPredicate } from "../../src/plugins/filter";
import axpLoading from "../../src/plugins/loading";
import axpRepath from "../../src/plugins/repath";
import type { AxpResponse } from "../../src/response";
import type { AxpPlugin, AxpRequestConfig } from "../../src/types";
import { cloneAxiosDefaults, effectiveHeaders } from "../../src/utils";
import { requestKey } from "../../src/key";
import { requestKey as referenceRequestKey } from "../helpers/key-reference";
import { testContext } from "../helpers/context";
import { preparedClient } from "../helpers/prepare";
import { wireClient } from "../helpers/wire";

/** 默认头和路径检查共用的地址。 */
const TEST_URL = "/simplify";
/** 顶层默认头的名称。 */
const TOP_HEADER = "X-Top";
/** 运行期新增的默认头。 */
const LATE_HEADER = "X-Late";
/** 查询与请求体共用的路径字段。 */
const PATH_FIELD = "id";

it("[core.req.patch] 补丁只记录触及字段，删除和重复派生共享记录", /** 重放使用当前视图而非上一次补丁的值。 */ () => {
  const root = testContext({ /** 原始地址。 */ url: TEST_URL, /** 原始超时。 */ timeout: 10 });
  const copy = new AxpContext(root);
  expect(copy.request).toBe(root.request);
  expect(copy.touchedFields).toBeUndefined();
  const patch = { /** 删除字段同样记录。 */ timeout: undefined };
  const inner = requestContext(copy, mergePatch(copy.request, patch), patch);
  expect(inner.request).not.toHaveProperty("timeout");
  expect(root.touchedFields).toEqual(new Set(["timeout"]));
  expect(root.request.timeout).toBe(10);
  expect(requestContext(root, root.request, {}).touchedFields).toBe(inner.touchedFields);
});

it("[core.fn.cloneAxiosDefaults] 空配置不产生额外键，显式 undefined 保留键名", /** 防止写回清空未提供的默认配置。 */ () => {
  expect(cloneAxiosDefaults({})).toEqual({});
  const source = {
    /** 显式清除超时。 */ timeout: undefined,
    /** 显式清除请求转换器。 */ transformRequest: undefined,
    /** 显式清除响应转换器。 */ transformResponse: undefined,
  };
  expect(Object.keys(cloneAxiosDefaults(source))).toEqual(Object.keys(source));
  expect(effectiveHeaders({}).toJSON()).toEqual({});
});

it("[core.req.headers] 顶层默认头按当前 defaults 掩码，已有头保留且不缓存", /** 用户可在两次请求之间修改默认头。 */ async () => {
  const patch: AxpPlugin<AxpResponse> = {
    /** 删除顶层默认头的测试插件。 */ name: "top-header",
    /** 不影响未删除的另一个默认头。 */ handle: (_ctx, next) =>
      next({
        /** 不区分大小写地删除默认头。 */ headers: { "x-top": undefined, "x-late": undefined },
      }),
  };
  const h = wireClient(
    { /** 顶层默认头参与展平。 */ headers: { [TOP_HEADER]: "old", "X-Keep": "keep" } },
    [patch],
  );
  delete (h.axios.defaults.headers as Record<string, unknown>).get;
  await h.api.get(TEST_URL)();
  h.axios.defaults.headers[LATE_HEADER] = "new";
  await h.api.get(TEST_URL)();
  expect(h.calls[0]!.config.headers.get(TOP_HEADER)).toBe(false);
  expect(h.calls[1]!.config.headers.get(LATE_HEADER)).toBe(false);
  expect(h.calls[1]!.config.headers.get("X-Keep")).toBe("keep");
  expect(h.axios.defaults.headers[LATE_HEADER]).toBe("new");
  h.api.dispose();
});

it("[filter.fn.$filter] 默认谓词直接判断值且仍生成新对象", /** 无删除也不能返回来源对象。 */ () => {
  const source = { /** 有效值保留。 */ keep: 1, /** 默认空值剥离。 */ empty: null };
  const options = { /** 使用内置空字段规则。 */ predicate: defaultPredicate };
  expect($filter(source, options)).toEqual({ keep: 1 });
  const kept = { /** 只包含有效字段。 */ keep: 1 };
  expect($filter(kept, options)).toEqual(kept);
  expect($filter(kept, options)).not.toBe(kept);
});

it("[core.method.key] 浅空预检继续读取继承的可枚举属性并保留异常", /** 删除预检会跳过旧实现可观察的 getter。 */ () => {
  const bug = new Error("inherited getter");
  const prototype = Object.defineProperty({}, PATH_FIELD, {
    /** 旧预检会枚举继承字段。 */ enumerable: true,
    /** 原样透传程序异常。 */ get() {
      throw bug;
    },
  });
  const request = {
    /** 自有空字段使旧预检继续检查继承字段。 */ params: Object.assign(Object.create(prototype), {
      empty: null,
    }),
  };
  expect(/** 参照实现读取继承字段。 */ () => referenceRequestKey(request)).toThrow(bug);
  expect(/** 精简后仍保持相同异常。 */ () => requestKey(request)).toThrow(bug);
});

it("[filter.opt.snapshot] 装配配置快照不受原选项和豁免数组后续修改影响", /** 对象覆盖也应继承同一份配置。 */ async () => {
  const options = { /** 原始豁免列表。 */ ignoreKeys: [PATH_FIELD] };
  const { api } = preparedClient([axpFilter<AxpResponse>(options)]);
  options.ignoreKeys.length = 0;
  const response = await api.request({
    /** 固定地址。 */ url: TEST_URL,
    /** id 在装配时已经豁免。 */ params: { id: null },
    /** 触发对象级覆盖。 */ filter: {},
    /** 保留响应供检查。 */ throws: false,
  });
  expect(response.request.params).toEqual({ id: null });
  api.dispose();
});

it("[loading.req.loading] 无默认回调时只解析请求提供的回调，非法简写沿用配置", /** 快速路径仍支持请求级对象回调。 */ async () => {
  const loading = vi.fn();
  const h = wireClient({}, [axpLoading()]);
  await h.api.request({ /** 地址。 */ url: TEST_URL, /** 无回调对象直接透传。 */ loading: {} });
  await h.api.request({
    /** 地址。 */ url: TEST_URL,
    /** 对象回调可开启显示。 */ loading: { loading },
  });
  h.api.eject("axp:loading");
  h.api.use(axpLoading({ loading }));
  await h.api.request({
    /** 地址。 */ url: TEST_URL,
    /** 非声明值按省略处理。 */ loading: "invalid" as AxpRequestConfig["loading"],
  });
  expect(loading.mock.calls).toEqual([[true], [false], [true], [false]]);
  h.api.dispose();
});

it("[repath.opt.pattern] 默认无变量路径直接透传，请求级正则使用私有克隆", /** 只处理 pathname，原正则游标保持不变。 */ async () => {
  const untouched: AxpPlugin<AxpResponse> = {
    /** 检查无变量路径未派生视图。 */ name: "path-observer",
    /** prepare 后观察触及字段。 */ stage: "prepare",
    /** 请求没有任何补丁字段。 */ handle(ctx, next) {
      expect(ctx.touchedFields).toBeUndefined();
      return next();
    },
  };
  const { api } = preparedClient([axpRepath<AxpResponse>(), untouched]);
  const plain = TEST_URL + "?query={id}";
  expect(
    (await api.request({ /** 变量只在查询中。 */ url: plain, /** 不抛出。 */ throws: false }))
      .request.url,
  ).toBe(plain);
  api.eject(untouched.name);
  const pattern = /\$([^/]+)/g;
  pattern.lastIndex = 2;
  const response = await api.request({
    /** 自定义路径模板。 */ url: "/$id",
    /** 提供替换值。 */ params: { id: 7 },
    /** 本次覆盖匹配模式。 */ repath: { pattern },
    /** 保留响应。 */ throws: false,
  });
  expect(response.request.url).toBe("/7");
  expect(pattern.lastIndex).toBe(2);
  expect((response.request.headers as AxiosHeaders).has("accept")).toBe(true);
  api.dispose();
});
