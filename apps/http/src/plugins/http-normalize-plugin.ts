import { AxiosError } from "axios";
import HttpResponse from "../objects/HttpResponse";
import type { HttpPlugin } from "../types";

export interface HttpNormalizeResponseOptions {}

/** HTTP 响应标准化插件 */
export default function httpNormalizerPlugin(
  _options: HttpNormalizeResponseOptions = {},
): HttpPlugin {
  let id = -1;
  return {
    id: "http-normalize",
    install(http) {
      id = http.interceptors.response.use(
        function $normalize(response) {
          console.log("normalize");

          response.data = HttpResponse.fromResponse(response);
          return response;
        },
        function $normalize(error: AxiosError) {
          console.log("normalize");
          error.response ||= {
            data: null,
            status: error.status || 0,
            statusText: error.message,
            headers: error.config?.headers || {},
            config: error.config || ({} as any),
            request: error.request,
          };

          error.response.data = HttpResponse.fromResponse(error.response);
          return Promise.reject(error);
        },
      );

      return () => http.interceptors.response.eject(id);
    },
  };
}
