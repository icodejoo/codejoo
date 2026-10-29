import type { AxiosResponse } from "axios";
import type { IAxpResponse } from "../../src/response";

/** 测试中读取显式 raw 副本，不提前引入 B2 返回类型。
 * @param response 已经开启 raw 的响应。
 * @returns 运行时附加的原生字段。
 * @example `expect(nativeFields(response).raw).toBe(raw)`
 */
export function nativeFields(response: IAxpResponse<unknown, string | number>): { /** 原生响应。 */ raw: AxiosResponse | undefined; /** 原生异常。 */ error: unknown } {
  const raw: AxiosResponse | undefined = Reflect.get(response, "raw");
  return { raw, error: Reflect.get(response, "error") };
}
