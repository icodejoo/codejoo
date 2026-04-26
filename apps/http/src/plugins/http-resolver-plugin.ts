import type { HttpPlugin } from "../types";

export interface HttpResolverOptions {
  nullable?: boolean;
}

/**
 * 返回值解析器 * 该插件用于返回值指定的数据层级
 * 减少每次请求都需要手动解析数据的麻烦
 * 例如：response.data.data
 * 通过该插件可以直接获取到 response.data.data 中的 data 部分
 */
export default function (_options: HttpResolverOptions = {}): HttpPlugin {
  let id = -1;
  return {
    id: "http-resolver",
    install(http) {
      id = http.interceptors.response.use(function $resolveResponse(response) {
        const data = response.data.data;

        if (response.config.nullable === false && data == null) {
          return Promise.reject(response.data);
        }

        if (response.config.debug) {
          console.debug("-----服务器响应", response.config.url, "-----");
          console.debug(response.data);
        }
        return data;
      });

      return () => http.interceptors.response.eject(id);
    },
  };
}
