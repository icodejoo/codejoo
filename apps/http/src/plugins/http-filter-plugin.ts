import { utils } from "..";
import type { HttpPlugin } from "../types";

export interface HttpResolverOptions {
  /** 是否开启调试模式，开启后会在过滤掉参数时输出日志 */
  debug?: boolean;
  /** 是否默认启用过滤功能 */
  filterable?: boolean;
  /** 自定义过滤函数 */
  filter?: (value: unknown) => boolean;
}

/**
 * 请求参数过滤条件，默认过滤掉falsy值但保留0和false
 * 该插件用于请求参数的过滤，减少每次请求都需要手动过滤参数的麻烦
 * 例如：{ name: "John", age: null } 通过该插件可以自动过滤掉 age 字段
 * 结果为：{ name: "John" }
 * 也可以自定义过滤函数
 */
export default function ({
  filterable = true,
  filter = defaultFilter,
  debug = false,
}: HttpResolverOptions = {}): HttpPlugin {
  let id = -1;
  return {
    id: "http-filter",
    install(http) {
      id = http.interceptors.request.use(
        function $filter(config) {
          if (config.params) {
            run(config.params, filter, debug, config.url + "?params");
          }
          if (config.data && utils.Typeof.isObject(config.data)) {
            run(config.data, filter, debug, config.url + "?data");
          }
          return config;
        },
        null,
        {
          runWhen: (c) => c.filterable ?? filterable,
        },
      );

      return () => http.interceptors.request.eject(id);
    },
  };
}

function defaultFilter(value: unknown): boolean {
  return !(!value && value !== 0 && value !== false);
}

function run(
  data: Record<string, unknown>,
  predicate: (value: unknown) => boolean,
  debug: boolean,
  name: string,
): any {
  for (const [key, value] of Object.entries(data)) {
    if (!predicate(value)) {
      delete data[key];
      if (debug) {
        console.warn(
          `[http-fileter-plugin]:filtered out [${key}] with value:`,
          JSON.stringify(value),
          "in",
          name,
        );
      }
    }
  }
}
