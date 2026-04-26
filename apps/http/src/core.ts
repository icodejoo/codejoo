import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type CreateAxiosDefaults,
  type Method,
} from "axios";
import type { HttpPlugin } from "./types";

export default class Http {
  declare private http: AxiosInstance;
  private plugins = new Map<string, () => void>();
  constructor(baseOptions: CreateAxiosDefaults) {
    this.http = axios.create(baseOptions);
  }

  plugin(plugin: HttpPlugin): this {
    if (this.plugins.has(plugin.id)) return this;
    this.plugins.set(plugin.id, plugin.install(this.http));
    return this;
  }

  unplugin(plugin: HttpPlugin): this {
    const uninstall = this.plugins.get(plugin.id);
    if (uninstall) {
      uninstall();
      this.plugins.delete(plugin.id);
    }
    return this;
  }

  get<R = any, Q = any>(path: string, options?: AxiosRequestConfig) {
    return this.#dispatch<R, Q>("get", "params", path, options);
  }

  post<R = any, Q = any>(path: string, options?: AxiosRequestConfig) {
    return this.#dispatch<R, Q>("post", "data", path, options);
  }

  put<R = any, Q = any>(path: string, options?: AxiosRequestConfig) {
    return this.#dispatch<R, Q>("put", "data", path, options);
  }

  delete<R = any, Q = any>(path: string, options?: AxiosRequestConfig) {
    return this.#dispatch<R, Q>("delete", "params", path, options);
  }

  #dispatch<R, Q>(method: Method, feild: string, path: string, options?: AxiosRequestConfig) {
    const _this = this;
    return function dispatch(payload?: Q, config?: AxiosRequestConfig) {
      return _this.http.request({
        method,
        url: path,
        [feild]: payload,
        ...options,
        ...config,
      }) as Promise<R>;
    };
  }
}
