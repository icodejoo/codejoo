import type { AxiosRequestConfig } from "axios";
import { expect, expectTypeOf, it } from "vitest";
import { createAxp } from "../../src/client";
import type { AxpPlugin, AxpRequestOptions } from "../../src/types";
import axpLoading from "../../src/plugins/loading";
import axpNotify from "../../src/plugins/notify";
import axpRepath from "../../src/plugins/repath";
import axpFilter from "../../src/plugins/filter";
import axpEnvs from "../../src/plugins/envs";
import type { ILoadingOptions, TLoadingFunc, INotifyOptions, IRepathOptions, IFilterOptions, TPredicate, IEnvRule, IEnvsOptions } from "../../src/index";
import { customResponse, TestResponse } from "../helpers/client";

it("[loading.type.options][notify.type.response][repath.type.options][filter.type.options][envs.type.options] 旧入口类型名保留，插件透传自定义 R，请求扩展不污染 axios", /** 仅编译的公开契约。 */ () => {
  /** 不执行真实网络的用法样例。 */
  function contracts() {
    const api = createAxp<unknown, TestResponse>({
      response: customResponse(),
      plugins: [
        axpLoading({ loading: /** UI 通知回调。 */ (_visible) => {} }),
        axpNotify({
          notify: /** 上下文推断保留扩展字段。 */ (_message, response) => {
            expectTypeOf(response).toEqualTypeOf<TestResponse>();
            return response.traceId;
          },
          stringify: /** 格式化同样收到 R。 */ (r, ctx) => {
            expectTypeOf(r).toEqualTypeOf<TestResponse>();
            expectTypeOf(ctx.client).toEqualTypeOf<typeof api>();
            return r.traceId;
          },
        }),
        axpRepath(),
        axpFilter(),
        axpEnvs({ enable: true, rules: [] }),
      ],
    });
    const loading: TLoadingFunc = /** 将显式回调绑定到这个客户端的通知环境。 */ () => {
      void api.pending();
    };
    const options: AxpRequestOptions = {
      loading: { loading, delay: null, delayClose: undefined },
      filter: { predicate: null, ignoreKeys: [] },
      repath: false,
      notify: false,
    };
    api.request({ ...options });
    api.request({ loading, filter: true, repath: null, notify: true });
    // @ts-expect-error filter 不接受旧函数写法。
    api.request({ filter: () => true });
    // @ts-expect-error loading 不接受数字简写。
    api.request({ loading: 1 });
    // @ts-expect-error repath 不接受动态函数。
    api.request({ repath: () => true });
    // @ts-expect-error notify 只提供开关，不接受替换回调。
    api.request({ notify: () => "message" });
    // @ts-expect-error axios 原生配置不再扩展 loading。
    const axiosLoading: AxiosRequestConfig = { loading: true };
    // @ts-expect-error axios 原生配置不再扩展 filter。
    const axiosFilter: AxiosRequestConfig = { filter: true };
    void axiosLoading;
    void axiosFilter;
    expectTypeOf(axpLoading<TestResponse>()).toEqualTypeOf<AxpPlugin<TestResponse>>();
    expectTypeOf<ILoadingOptions>().toExtend<{ /** 回调类型。 */ loading?: TLoadingFunc }>();
    expectTypeOf<INotifyOptions<TestResponse>["notify"]>().parameters.toEqualTypeOf<[string, TestResponse]>();
    expectTypeOf<IRepathOptions>().toExtend<{ /** 插件开关。 */ enable?: boolean }>();
    expectTypeOf<IFilterOptions>().toExtend<{ /** 判定回调。 */ predicate?: TPredicate }>();
    const rule: IEnvRule = { rule: /** 规则示例。 */ () => true, config: {} };
    const rules: IEnvsOptions = [rule];
    axpEnvs<TestResponse>(rules);
  }
  expect(contracts).toBeTypeOf("function");
});
